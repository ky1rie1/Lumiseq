use super::develop::{base_tone_pixel, NativeDevelopSettings};
use super::types::{PixelFormat, RawError};
use super::{haze, wavelet};
use crate::assets::global_asset_registry;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct RawSpatialAnalysis {
    pub version: u8,
    pub source_width: usize,
    pub source_height: usize,
    pub haze: haze::HazeAnalysis,
    pub noise: [f32; 3],
}

pub(super) fn base_matrix(s: &NativeDevelopSettings) -> Result<[f32; 9], RawError> {
    if !(-8.0..=8.0).contains(&s.exposure)
        || !(-100..=100).contains(&s.contrast)
        || [s.highlights, s.shadows, s.whites, s.blacks]
            .iter()
            .any(|v| !(-100.0..=100.0).contains(v))
        || s.tint.is_some_and(|v| !(-150..=150).contains(&v))
    {
        return Err(RawError::DecodeFailed(
            "Invalid RAW base-tone analysis settings".into(),
        ));
    }
    match s.white_balance_mode.as_str() {
        "as-shot" => Ok([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]),
        "custom" => {
            let kelvin = s.temperature.unwrap_or(5500);
            if !(2000..=12000).contains(&kelvin) {
                return Err(RawError::DecodeFailed(
                    "Invalid RAW analysis white balance".into(),
                ));
            }
            Ok(super::develop::relative_white_balance_matrix(
                kelvin as f32,
                s.tint.unwrap_or(0) as f32,
            ))
        }
        "auto" => s
            .white_balance_matrix
            .filter(|m| {
                m.iter().enumerate().all(|(i, v)| {
                    v.is_finite()
                        && if i % 4 == 0 {
                            (0.6..=1.67).contains(v)
                        } else {
                            *v == 0.0
                        }
                })
            })
            .ok_or_else(|| {
                RawError::DecodeFailed("Unresolved automatic white balance for RAW analysis".into())
            }),
        _ => Err(RawError::DecodeFailed(
            "Invalid RAW analysis white balance mode".into(),
        )),
    }
}

struct Lease<'a>(&'a str);
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        global_asset_registry().release(self.0);
    }
}

/// Noise uses contiguous native pixels independently of the resized atmosphere grid.
pub fn analyze_raw_spatial(
    asset_id: &str,
    s: &NativeDevelopSettings,
) -> Result<RawSpatialAnalysis, RawError> {
    let matrix = base_matrix(s)?;
    let gain = 2.0f32.powf(s.exposure);
    if !global_asset_registry().retain(asset_id) {
        return Err(RawError::DecodeFailed(
            "RAW analysis source unavailable".into(),
        ));
    }
    let _lease = Lease(asset_id);
    let (width, height, gw, gh, grid, patches) = global_asset_registry()
        .with_asset(asset_id, |asset| {
            let width = asset.width;
            let height = asset.height;
            if width == 0
                || height == 0
                || asset.pixel_format != PixelFormat::RGBA16
                || width.checked_mul(height).is_none_or(|n| n > 150_000_000)
                || width.checked_mul(height).and_then(|n| n.checked_mul(8))
                    != Some(asset.buffer.len())
            {
                return Err(RawError::DecodeFailed(
                    "Invalid RGBA16 RAW analysis source".into(),
                ));
            }
            let scale = (256.0 / width.max(height) as f32).min(1.0);
            let gw = (width as f32 * scale).round().max(1.0) as usize;
            let gh = (height as f32 * scale).round().max(1.0) as usize;
            let mut grid = Vec::with_capacity(gw * gh);
            // 4x4 deterministic stratified samples avoid copying a full float image.
            for row in 0..gh {
                for column in 0..gw {
                    let mut sum = [0.0; 3];
                    for sy in 0..4 {
                        for sx in 0..4 {
                            let x = ((column * 8 + sx * 2 + 1) * width / (gw * 8)).min(width - 1);
                            let y = ((row * 8 + sy * 2 + 1) * height / (gh * 8)).min(height - 1);
                            let v = base_tone_pixel(&asset.buffer, y * width + x, s, matrix, gain);
                            for c in 0..3 {
                                sum[c] += v[c] / 16.0;
                            }
                        }
                    }
                    grid.push(sum);
                }
            }
            let pw = width.min(32);
            let ph = height.min(32);
            let mut patches = Vec::with_capacity(49);
            for row in 0..7 {
                for column in 0..7 {
                    let x0 = column * (width - pw) / 6;
                    let y0 = row * (height - ph) / 6;
                    let mut patch = Vec::with_capacity(pw * ph);
                    for y in y0..y0 + ph {
                        for x in x0..x0 + pw {
                            patch.push(base_tone_pixel(
                                &asset.buffer,
                                y * width + x,
                                s,
                                matrix,
                                gain,
                            ));
                        }
                    }
                    patches.push((pw, ph, patch));
                }
            }
            Ok((width, height, gw, gh, grid, patches))
        })
        .ok_or_else(|| RawError::DecodeFailed("RAW analysis source unavailable".into()))??;
    let mut estimates: [Vec<f32>; 3] = std::array::from_fn(|_| Vec::with_capacity(49));
    for (pw, ph, patch) in patches {
        let sigma = wavelet::estimate_noise(&patch, pw, ph);
        for c in 0..3 {
            estimates[c].push(sigma[c]);
        }
    }
    let noise = std::array::from_fn(|c| {
        estimates[c].sort_by(f32::total_cmp);
        estimates[c][estimates[c].len() / 2]
    });
    Ok(RawSpatialAnalysis {
        version: 1,
        source_width: width,
        source_height: height,
        haze: haze::analyze(&grid, gw, gh),
        noise,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::{global_asset_registry, NativeImageAsset};
    use crate::raw::types::PixelFormat;
    #[test]
    fn analysis_rejects_missing_and_corrupt_assets() {
        let settings: NativeDevelopSettings = serde_json::from_value(serde_json::json!({
            "exposure":0,"contrast":0,"saturation":0,"highlights":0,"shadows":0,
            "white_balance_mode":"as-shot","temperature":null,"tint":null
        }))
        .unwrap();
        assert!(analyze_raw_spatial("quality_missing", &settings).is_err());
        global_asset_registry().register(NativeImageAsset {
            id: "quality_corrupt".into(),
            width: 10,
            height: 10,
            pixel_format: PixelFormat::RGBA16,
            buffer: vec![0; 10],
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        assert!(analyze_raw_spatial("quality_corrupt", &settings).is_err());
        global_asset_registry().release("quality_corrupt");
    }
    #[test]
    fn analysis_uses_native_noise_patches_and_bounded_whole_scene() {
        let mut buffer = Vec::new();
        for y in 0..270usize {
            for x in 0..360usize {
                let noise = (((x * 13 + y * 17) % 19) as i32 - 9) * 230;
                for c in 0..3 {
                    let base = 20000 + c * 7000;
                    buffer.extend_from_slice(&((base + noise) as u16).to_le_bytes());
                }
                buffer.extend_from_slice(&65535u16.to_le_bytes());
            }
        }
        global_asset_registry().register(NativeImageAsset {
            id: "quality_noise".into(),
            width: 360,
            height: 270,
            pixel_format: PixelFormat::RGBA16,
            buffer,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        let settings: NativeDevelopSettings = serde_json::from_value(serde_json::json!({
            "exposure":0,"contrast":0,"saturation":0,"highlights":0,"shadows":0,
            "white_balance_mode":"as-shot","temperature":null,"tint":null
        }))
        .unwrap();
        let analysis = analyze_raw_spatial("quality_noise", &settings).unwrap();
        assert_eq!((analysis.source_width, analysis.source_height), (360, 270));
        assert_eq!(analysis.haze.width, 256);
        assert_eq!(
            analysis.haze.coefficients.len(),
            analysis.haze.width * analysis.haze.height * 2
        );
        assert!(analysis.noise[0] > 0.002);
        assert!(analysis.noise.iter().all(|v| v.is_finite() && *v >= 0.0));
        let mut invalid = settings;
        invalid.exposure = f32::NAN;
        assert!(analyze_raw_spatial("quality_noise", &invalid).is_err());
        global_asset_registry().release("quality_noise");
    }
}
