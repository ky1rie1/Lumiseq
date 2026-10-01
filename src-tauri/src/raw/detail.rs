use crate::assets::global_asset_registry;
use crate::color::transform::linear_to_srgb;
use crate::raw::types::{PixelFormat, RawError};
use std::io::Cursor;

/// Encode only the requested display region; the registered RGBA16 RAW remains untouched.
pub fn render_raw_display_tile(asset_id: &str, x: usize, y: usize, width: usize, height: usize) -> Result<Vec<u8>, RawError> {
    if width == 0 || height == 0 || width > 4096 || height > 4096
        || width.checked_mul(height).is_none_or(|pixels| pixels > 6_000_000)
    {
        return Err(RawError::DecodeFailed("Invalid detail region size".to_string()));
    }
    let rgba = global_asset_registry().with_asset(asset_id, |asset| {
        if asset.pixel_format != PixelFormat::RGBA16
            || x.checked_add(width).is_none_or(|end| end > asset.width)
            || y.checked_add(height).is_none_or(|end| end > asset.height)
            || asset.width.checked_mul(asset.height).and_then(|pixels| pixels.checked_mul(8)) != Some(asset.buffer.len())
        {
            return Err(RawError::DecodeFailed("Detail region is outside the decoded RAW image".to_string()));
        }
        let mut rgba = vec![0u8; width * height * 4];
        for row in 0..height {
            for col in 0..width {
                let source = ((y + row) * asset.width + x + col) * 8;
                let target = (row * width + col) * 4;
                for channel in 0..3 {
                    let value = u16::from_le_bytes([asset.buffer[source + channel * 2], asset.buffer[source + channel * 2 + 1]]);
                    rgba[target + channel] = (linear_to_srgb(value as f32 / 65535.0).clamp(0.0, 1.0) * 255.0) as u8;
                }
                let alpha = u16::from_le_bytes([asset.buffer[source + 6], asset.buffer[source + 7]]);
                rgba[target + 3] = (alpha as f32 / 257.0) as u8;
            }
        }
        Ok(rgba)
    }).ok_or_else(|| RawError::DecodeFailed("Decoded RAW is no longer available".to_string()))??;
    let image = image::RgbaImage::from_raw(width as u32, height as u32, rgba)
        .ok_or_else(|| RawError::DecodeFailed("Could not create RAW detail image".to_string()))?;
    let mut encoded = Vec::new();
    image::DynamicImage::ImageRgba8(image).write_to(&mut Cursor::new(&mut encoded), image::ImageFormat::Png)
        .map_err(|error| RawError::DecodeFailed(format!("Could not encode RAW detail: {error}")))?;
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::render_raw_display_tile;
    use crate::assets::{global_asset_registry, NativeImageAsset};
    use crate::raw::types::PixelFormat;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_asset() -> String {
        let id = format!("detail_test_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());
        let mut buffer = Vec::new();
        for y in 0..3 {
            for x in 0..4 {
                for channel in [x * 10000, y * 16000, 0, 65535] {
                    buffer.extend_from_slice(&(channel as u16).to_le_bytes());
                }
            }
        }
        global_asset_registry().register(NativeImageAsset {
            id: id.clone(), width: 4, height: 3, pixel_format: PixelFormat::RGBA16,
            buffer, metadata: None, ref_count: 1, created_at: 0,
        });
        id
    }

    #[test]
    fn region_png_is_exact_size_and_uses_original_source_pixels() {
        let id = sample_asset();
        let encoded = render_raw_display_tile(&id, 1, 1, 2, 2).unwrap();
        let image = image::load_from_memory(&encoded).unwrap().to_rgba8();
        assert_eq!((image.width(), image.height()), (2, 2));
        assert_eq!(image.get_pixel(0, 0).0[3], 255);
        assert!(image.get_pixel(1, 0).0[0] > image.get_pixel(0, 0).0[0]);
        assert!(image.get_pixel(0, 1).0[1] > image.get_pixel(0, 0).0[1]);
        global_asset_registry().release(&id);
    }

    #[test]
    fn rejects_out_of_bounds_and_unbounded_requests() {
        let id = sample_asset();
        assert!(render_raw_display_tile(&id, 3, 2, 2, 1).is_err());
        assert!(render_raw_display_tile(&id, 0, 0, 0, 1).is_err());
        assert!(render_raw_display_tile(&id, 0, 0, 5000, 5000).is_err());
        global_asset_registry().release(&id);
    }
}
