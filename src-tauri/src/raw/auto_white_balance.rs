use crate::assets::global_asset_registry;
use crate::raw::types::RawError;

/// Deterministic source-spanning grid; no image clone, resampling, gamma encoding or edits.
pub fn sample_raw_linear_rgb(asset_id: &str) -> Result<Vec<[f32; 3]>, RawError> {
    global_asset_registry()
        .with_asset(asset_id, |asset| {
            let source = super::linear_source::LinearSource::new(asset)?;
            let columns = asset.width.min(128);
            let rows = asset.height.min(128);
            let mut samples = Vec::with_capacity(columns * rows);
            for row in 0..rows {
                for column in 0..columns {
                    let y = (2 * row + 1) * asset.height / (2 * rows);
                    let x = (2 * column + 1) * asset.width / (2 * columns);
                    let pixel = source.pixel(y * asset.width + x)?;
                    if pixel[3] < 0.98 {
                        continue;
                    }
                    samples.push([pixel[0], pixel[1], pixel[2]]);
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
    #[test]
    fn tone_sampling_retains_float_extrema_and_sparse_out_of_grid_headroom() {
        let (width, height) = (300, 300);
        let mut pixels = vec![[0.02f32, 0.03, 0.04, 1.0]; width * height];
        pixels[0] = [-0.125, 4.21, 0.000001, 1.0];
        pixels[1] = [0.5, 0.5, 0.5, 0.0];
        global_asset_registry().register(NativeImageAsset {
            id: "tone_float".into(),
            width,
            height,
            buffer: pixels
                .iter()
                .flatten()
                .flat_map(|v| v.to_le_bytes())
                .collect(),
            pixel_format: PixelFormat::RGBA32F,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        let result = super::sample_raw_tone_rgb("tone_float").unwrap();
        assert_eq!(result.sample_format, "float32");
        assert_eq!(result.source_pixels, width * height - 1);
        assert_eq!(result.headroom_pixels, 1);
        assert_eq!(result.negative_pixels, 1);
        assert_eq!(result.peak, 4.21);
        assert!(result.samples.len() + result.tail_samples.len() <= 65536);
        assert!(result.tail_samples.contains(&[-0.125, 4.21, 0.000001]));
        assert_eq!(result.tail_positions[0], [0.5 / 300.0, 0.5 / 300.0]);
        assert_eq!(
            result.samples,
            super::sample_raw_tone_rgb("tone_float").unwrap().samples
        );
        global_asset_registry().release("tone_float");
    }
}

#[derive(serde::Serialize)]
pub struct RawToneSamples {
    pub samples: Vec<[f32; 3]>,
    pub positions: Vec<[f32; 2]>,
    #[serde(rename = "tailSamples")]
    pub tail_samples: Vec<[f32; 3]>,
    #[serde(rename = "tailPositions")]
    pub tail_positions: Vec<[f32; 2]>,
    #[serde(rename = "sourcePixels")]
    pub source_pixels: usize,
    pub peak: f32,
    #[serde(rename = "headroomPixels")]
    pub headroom_pixels: usize,
    #[serde(rename = "negativePixels")]
    pub negative_pixels: usize,
    #[serde(rename = "sampleFormat")]
    pub sample_format: &'static str,
}

/// Float source statistics and bounded spatial/highlight strata; no quantization or edits.
pub fn sample_raw_tone_rgb(asset_id: &str) -> Result<RawToneSamples, RawError> {
    let unavailable = || RawError::DecodeFailed("RAW tone sample source unavailable".into());
    if !global_asset_registry().retain(asset_id) {
        return Err(unavailable());
    }
    struct Lease<'a>(&'a str);
    impl Drop for Lease<'_> {
        fn drop(&mut self) {
            global_asset_registry().release(self.0);
        }
    }
    let _lease = Lease(asset_id);
    let (width, height, float) = global_asset_registry()
        .with_asset(asset_id, |asset| {
            let source = super::linear_source::LinearSource::new(asset)?;
            Ok::<_, RawError>((asset.width, asset.height, source.is_float()))
        })
        .ok_or_else(unavailable)??;
    let position = |i: usize| {
        [
            ((i % width) as f32 + 0.5) / width as f32,
            ((i / width) as f32 + 0.5) / height as f32,
        ]
    };
    let columns = width.min(254);
    let rows = height.min(256);
    let mut result = RawToneSamples {
        samples: Vec::with_capacity(columns * rows),
        positions: Vec::with_capacity(columns * rows),
        tail_samples: Vec::new(),
        tail_positions: Vec::new(),
        source_pixels: 0,
        peak: f32::NEG_INFINITY,
        headroom_pixels: 0,
        negative_pixels: 0,
        sample_format: if float { "float32" } else { "uint16" },
    };
    // Short registry borrows let unrelated source releases proceed during a large scan.
    const CHUNK: usize = 16384;
    for start in (0..columns * rows).step_by(CHUNK) {
        global_asset_registry()
            .with_asset(asset_id, |asset| {
                let source = super::linear_source::LinearSource::new(asset)?;
                for i in start..(start + CHUNK).min(columns * rows) {
                    let y = (2 * (i / columns) + 1) * height / (2 * rows);
                    let x = (2 * (i % columns) + 1) * width / (2 * columns);
                    let p = source.pixel(y * width + x)?;
                    if p[3] < 0.98 {
                        continue;
                    }
                    result.samples.push([p[0], p[1], p[2]]);
                    result.positions.push(position(y * width + x));
                }
                Ok::<_, RawError>(())
            })
            .ok_or_else(unavailable)??;
    }
    let count = width * height;
    let mut tails: Vec<Option<(usize, f32, [f32; 3])>> = vec![None; 512.min(count)];
    for start in (0..count).step_by(CHUNK) {
        global_asset_registry()
            .with_asset(asset_id, |asset| {
                let source = super::linear_source::LinearSource::new(asset)?;
                for i in start..(start + CHUNK).min(count) {
                    let p = source.pixel(i)?;
                    if p[3] < 0.98 {
                        continue;
                    }
                    let peak = p[0].max(p[1]).max(p[2]);
                    let bucket = i * tails.len() / count;
                    result.source_pixels += 1;
                    result.peak = result.peak.max(peak);
                    if peak > 1.0 {
                        result.headroom_pixels += 1;
                    }
                    if p[..3].iter().any(|v| *v < 0.0) {
                        result.negative_pixels += 1;
                    }
                    if tails[bucket].is_none_or(|(_, v, _)| peak > v) {
                        tails[bucket] = Some((i, peak, [p[0], p[1], p[2]]));
                    }
                }
                Ok::<_, RawError>(())
            })
            .ok_or_else(unavailable)??;
    }
    for (i, _, rgb) in tails.into_iter().flatten() {
        result.tail_samples.push(rgb);
        result.tail_positions.push(position(i));
    }
    if result.source_pixels == 0 {
        result.peak = 0.0;
    }
    Ok(result)
}
