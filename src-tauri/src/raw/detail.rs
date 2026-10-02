use crate::assets::global_asset_registry;
use crate::color::transform::linear_to_srgb;
use crate::raw::types::RawError;
use std::io::Cursor;

fn linear_header(width: usize, height: usize, floating: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(12 + width * height * if floating {16} else {8});
    bytes.extend_from_slice(if floating {b"LF32"} else {b"LR16"});
    bytes.extend_from_slice(&(width as u32).to_le_bytes());
    bytes.extend_from_slice(&(height as u32).to_le_bytes());
    bytes
}

/// Exact native working pixels. Binary IPC avoids PNG/browser quantization and JSON arrays.
pub fn render_raw_linear_tile(asset_id: &str, x: usize, y: usize, width: usize, height: usize) -> Result<Vec<u8>, RawError> {
    if width == 0 || height == 0 || width > 4096 || height > 4096
        || width.checked_mul(height).is_none_or(|n| n > 6_000_000) {
        return Err(RawError::DecodeFailed("Invalid RAW linear tile size".into()));
    }
    global_asset_registry().with_asset(asset_id, |asset| {
        let source=super::linear_source::LinearSource::new(asset)?;
        if x.checked_add(width).is_none_or(|end| end > asset.width)
            || y.checked_add(height).is_none_or(|end| end > asset.height) {
            return Err(RawError::DecodeFailed("RAW linear tile is outside source".into()));
        }
        let mut bytes = linear_header(width, height, source.is_float());
        for row in y..y+height {
            let start = (row * asset.width + x) * source.stride();
            if source.is_float() {for col in x..x+width {source.pixel(row*asset.width+col)?;}}
            bytes.extend_from_slice(&source.bytes()[start..start+width*source.stride()]);
        }
        Ok(bytes)
    }).ok_or_else(|| RawError::DecodeFailed("Decoded RAW is no longer available".into()))?
}

/// Area average of typed linear pixels, bounded to the PNG overview dimensions.
pub fn render_raw_linear_preview(asset_id: &str) -> Result<Vec<u8>, RawError> {
    global_asset_registry().with_asset(asset_id, linear_preview_for_asset)
        .ok_or_else(|| RawError::DecodeFailed("Decoded RAW is no longer available".into()))?
}

pub(super) fn linear_preview_for_asset(asset: &crate::assets::NativeImageAsset) -> Result<Vec<u8>, RawError> {
        let source=super::linear_source::LinearSource::new(asset)?;
        let ratio = (2048.0 / asset.width.max(asset.height) as f32).min(1.0);
        let width = ((asset.width as f32 * ratio) as usize).max(1);
        let height = ((asset.height as f32 * ratio) as usize).max(1);
        let mut bytes = linear_header(width, height, source.is_float());
        for y in 0..height {
            let y0 = y * asset.height / height;
            let y1 = (y+1) * asset.height / height;
            for x in 0..width {
                let x0 = x * asset.width / width;
                let x1 = (x+1) * asset.width / width;
                let mut sums = [0f64;4];
                for sy in y0..y1 { for sx in x0..x1 {
                    let pixel=source.pixel(sy*asset.width+sx)?;
                    for c in 0..4 { sums[c] += pixel[c] as f64; }
                }}
                let count = ((x1-x0)*(y1-y0)) as f64;
                for sum in sums {
                    if source.is_float() {bytes.extend_from_slice(&((sum/count) as f32).to_le_bytes());}
                    else {bytes.extend_from_slice(&((sum/count*65535.0).round() as u16).to_le_bytes());}
                }
            }
        }
        Ok(bytes)
}

pub(super) fn display_preview_for_asset(asset: &crate::assets::NativeImageAsset) -> Result<Vec<u8>,RawError> {
    let packet=linear_preview_for_asset(asset)?;
    let width=u32::from_le_bytes(packet[4..8].try_into().unwrap()) as usize;
    let height=u32::from_le_bytes(packet[8..12].try_into().unwrap()) as usize;
    let floating=asset.pixel_format==super::types::PixelFormat::RGBA32F;
    let rgba:Vec<u8>=packet[12..].chunks_exact(if floating {4} else {2}).enumerate().map(|(index,bytes)| {
        let value=if floating {f32::from_le_bytes(bytes.try_into().unwrap())}
            else {u16::from_le_bytes(bytes.try_into().unwrap()) as f32/65535.0};
        let display=if index%4==3 {value} else {linear_to_srgb(value)};
        (display.clamp(0.0,1.0)*255.0).round() as u8
    }).collect();
    let image=image::RgbaImage::from_raw(width as u32,height as u32,rgba)
        .ok_or_else(||RawError::DecodeFailed("Invalid RAW overview".into()))?;
    let mut bytes=Vec::new();
    image::DynamicImage::ImageRgba8(image).write_to(&mut Cursor::new(&mut bytes),image::ImageFormat::Png)
        .map_err(|e|RawError::DecodeFailed(e.to_string()))?;
    Ok(bytes)
}

/// Encode only the requested display region; the registered RGBA16 RAW remains untouched.
pub fn render_raw_display_tile(asset_id: &str, x: usize, y: usize, width: usize, height: usize) -> Result<Vec<u8>, RawError> {
    if width == 0 || height == 0 || width > 4096 || height > 4096
        || width.checked_mul(height).is_none_or(|pixels| pixels > 6_000_000)
    {
        return Err(RawError::DecodeFailed("Invalid detail region size".to_string()));
    }
    let rgba = global_asset_registry().with_asset(asset_id, |asset| {
        let source=super::linear_source::LinearSource::new(asset)?;
        if x.checked_add(width).is_none_or(|end| end > asset.width)
            || y.checked_add(height).is_none_or(|end| end > asset.height)
        {
            return Err(RawError::DecodeFailed("Detail region is outside the decoded RAW image".to_string()));
        }
        let mut rgba = vec![0u8; width * height * 4];
        for row in 0..height {
            for col in 0..width {
                let pixel = source.pixel((y+row)*asset.width+x+col)?;
                let target = (row * width + col) * 4;
                for channel in 0..3 {
                    rgba[target + channel] = (linear_to_srgb(pixel[channel]).clamp(0.0, 1.0) * 255.0) as u8;
                }
                rgba[target + 3] = (pixel[3] *255.0) as u8;
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

    #[test]
    fn linear_tile_preserves_source_coordinates_and_rejects_overflow() {
        let id = sample_asset();
        let bytes = super::render_raw_linear_tile(&id, 1, 1, 2, 1).unwrap();
        assert_eq!(&bytes[..4], b"LR16");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(bytes[12..14].try_into().unwrap()), 10000);
        assert_eq!(u16::from_le_bytes(bytes[20..22].try_into().unwrap()), 20000);
        assert!(super::render_raw_linear_tile(&id, usize::MAX, 0, 1, 1).is_err());
        global_asset_registry().release(&id);
    }

    #[test]
    fn linear_overview_preserves_signal_below_one_display_code() {
        let id = format!("dark_linear_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());
        let buffer: Vec<u8> = (0..12).flat_map(|_| [1u16,1,1,65535]).flat_map(u16::to_le_bytes).collect();
        global_asset_registry().register(NativeImageAsset {
            id: id.clone(), width: 4, height: 3, pixel_format: PixelFormat::RGBA16,
            buffer, metadata: None, ref_count: 1, created_at: 0,
        });
        let bytes = super::render_raw_linear_preview(&id).unwrap();
        assert_eq!(bytes.len(), 12 + 4*3*8);
        assert_eq!(u16::from_le_bytes(bytes[12..14].try_into().unwrap()), 1);
        global_asset_registry().release(&id);
    }

    #[test]
    fn scene_float_transport_preserves_signed_headroom_and_small_values() {
        let id="scene_float_transport";
        let pixel=[-0.125f32,1.5,0.000001,1.0];
        global_asset_registry().register(NativeImageAsset {
            id:id.into(),width:1,height:1,pixel_format:PixelFormat::RGBA32F,
            buffer:pixel.into_iter().flat_map(f32::to_le_bytes).collect(),
            metadata:None,ref_count:1,created_at:0,
        });
        let tile=super::render_raw_linear_tile(id,0,0,1,1).unwrap();
        assert_eq!(&tile[..4],b"LF32");
        assert_eq!(tile.len(),28);
        for c in 0..4 {assert_eq!(f32::from_le_bytes(tile[12+c*4..16+c*4].try_into().unwrap()),pixel[c]);}
        let overview=super::render_raw_linear_preview(id).unwrap();
        assert_eq!(overview,tile);
        let samples=crate::raw::auto_white_balance::sample_raw_linear_rgb(id).unwrap();
        assert_eq!(samples[0],[-0.125,1.5,0.000001]);
        global_asset_registry().release(id);
    }
}
