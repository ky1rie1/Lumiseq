use crate::assets::global_asset_registry;
use crate::raw::types::{PixelFormat, RawError};

/// Deterministic source-spanning grid; no image clone, resampling, gamma encoding or edits.
pub fn sample_raw_linear_rgb(asset_id: &str) -> Result<Vec<[f32; 3]>, RawError> {
    global_asset_registry()
        .with_asset(asset_id, |asset| {
            let pixels = asset.width.checked_mul(asset.height);
            if asset.pixel_format != PixelFormat::RGBA16
                || asset.width == 0
                || asset.height == 0
                || pixels.is_none_or(|n| n > 150_000_000)
                || pixels.and_then(|n| n.checked_mul(8)) != Some(asset.buffer.len())
            {
                return Err(RawError::DecodeFailed(
                    "Invalid RAW RGBA16 source for automatic white balance".to_string(),
                ));
            }
            let columns = asset.width.min(128);
            let rows = asset.height.min(128);
            let mut samples = Vec::with_capacity(columns * rows);
            for row in 0..rows {
                for column in 0..columns {
                    let y = (2 * row + 1) * asset.height / (2 * rows);
                    let x = (2 * column + 1) * asset.width / (2 * columns);
                    let offset = (y * asset.width + x) * 8;
                    let read = |c: usize| {
                        u16::from_le_bytes([
                            asset.buffer[offset + c * 2],
                            asset.buffer[offset + c * 2 + 1],
                        ])
                    };
                    if read(3) < 64224 {
                        continue;
                    }
                    samples.push([
                        read(0) as f32 / 65535.0,
                        read(1) as f32 / 65535.0,
                        read(2) as f32 / 65535.0,
                    ]);
                }
            }
            Ok(samples)
        })
        .ok_or_else(|| {
            RawError::DecodeFailed("Decoded RAW source is no longer available".to_string())
        })?
}

#[cfg(test)]
mod tests {
    use super::sample_raw_linear_rgb;
    use crate::assets::{global_asset_registry, NativeImageAsset};
    use crate::raw::types::PixelFormat;

    fn register(id: &str, width: usize, height: usize, buffer: Vec<u8>) {
        global_asset_registry().register(NativeImageAsset {
            id: id.to_string(),
            width,
            height,
            buffer,
            pixel_format: PixelFormat::RGBA16,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
    }

    #[test]
    fn sample_preserves_unedited_linear_16bit_channels_and_skips_transparency() {
        let mut buffer = Vec::new();
        for value in [10000u16, 20000, 30000, 65535, 40000, 50000, 60000, 0] {
            buffer.extend_from_slice(&value.to_le_bytes());
        }
        register("awb_precision", 2, 1, buffer);
        let sample = sample_raw_linear_rgb("awb_precision").unwrap();
        assert_eq!(sample.len(), 1);
        assert!((sample[0][0] - 10000.0 / 65535.0).abs() < 1e-7);
        assert!((sample[0][1] - 20000.0 / 65535.0).abs() < 1e-7);
        assert!((sample[0][2] - 30000.0 / 65535.0).abs() < 1e-7);
        global_asset_registry().release("awb_precision");
    }

    #[test]
    fn grid_is_deterministic_bounded_and_spans_original_dimensions() {
        let mut buffer = Vec::new();
        for y in 0..129 {
            for x in 0..129 {
                for value in [x as u16 * 256, y as u16 * 256, 32768, 65535] {
                    buffer.extend_from_slice(&value.to_le_bytes());
                }
            }
        }
        register("awb_grid", 129, 129, buffer);
        let sample = sample_raw_linear_rgb("awb_grid").unwrap();
        assert_eq!(sample.len(), 16384);
        assert_eq!(sample, sample_raw_linear_rgb("awb_grid").unwrap());
        assert_eq!(sample[0][0], 0.0);
        assert!((sample.last().unwrap()[0] - 32768.0 / 65535.0).abs() < 1e-7);
        global_asset_registry().release("awb_grid");
    }

    #[test]
    fn rejects_missing_corrupt_and_overflowing_source_assets() {
        assert!(sample_raw_linear_rgb("awb_missing").is_err());
        register("awb_invalid", 2, 1, vec![0; 8]);
        assert!(sample_raw_linear_rgb("awb_invalid").is_err());
        register("awb_overflow", usize::MAX, usize::MAX, vec![]);
        assert!(sample_raw_linear_rgb("awb_overflow").is_err());
        global_asset_registry().release("awb_invalid");
        global_asset_registry().release("awb_overflow");
    }
}
