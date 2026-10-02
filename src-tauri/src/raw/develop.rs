use crate::assets::global_asset_registry;
use crate::color::transform::{linear_to_srgb, srgb_to_linear};
use crate::raw::spatial::{self, SpatialSettings};
use crate::raw::types::RawError;
use serde::{Deserialize, Serialize};
use std::io::Cursor;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeDevelopSettings {
    pub exposure: f32,   // EV
    pub contrast: i32,   // -100 to 100
    pub saturation: i32, // -100 to 100
    pub highlights: f32,
    pub shadows: f32,
    #[serde(default)]
    pub whites: f32,
    #[serde(default)]
    pub blacks: f32,
    #[serde(default)]
    pub vibrance: f32,
    #[serde(default)]
    pub curve_lut: Vec<f32>,
    #[serde(default)]
    pub hsl: Vec<[f32; 3]>,
    #[serde(default)]
    pub vignette_amount: f32,
    #[serde(default = "default_vignette_midpoint")]
    pub vignette_midpoint: f32,
    #[serde(default)]
    pub texture: f32,
    #[serde(default)]
    pub clarity: f32,
    #[serde(default)]
    pub dehaze: f32,
    #[serde(default)]
    pub sharpen_amount: f32,
    #[serde(default = "default_sharpen_radius")]
    pub sharpen_radius: f32,
    #[serde(default)]
    pub sharpen_threshold: f32,
    #[serde(default)]
    pub luma_denoise: f32,
    #[serde(default)]
    pub chroma_denoise: f32,
    pub white_balance_mode: String,
    #[serde(default)]
    pub white_balance_matrix: Option<[f32; 9]>, // persisted postdecode automatic correction
    pub temperature: Option<u32>,
    pub tint: Option<i32>,
    #[serde(default)]
    pub masks: Vec<NativeDevelopMask>,
}

fn default_vignette_midpoint() -> f32 {
    50.0
}
fn default_sharpen_radius() -> f32 {
    1.0
}

// Keep the source alive if its document closes during a background export.
struct ExportAssetLease<'a>(&'a str);
impl Drop for ExportAssetLease<'_> {
    fn drop(&mut self) {
        global_asset_registry().release(self.0);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeDevelopMask {
    pub width: usize,
    pub height: usize,
    pub bytes: Vec<u8>,
    pub inverted: bool,
    pub opacity: f32,
    #[serde(default)]
    pub exposure: f32,
    #[serde(default)]
    pub contrast: f32,
    #[serde(default)]
    pub highlights: f32,
    #[serde(default)]
    pub shadows: f32,
    #[serde(default)]
    pub temperature: f32,
    #[serde(default)]
    pub saturation: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeExportOptions {
    #[serde(default)]
    pub output_profile: super::output_profile::OutputProfile,
    pub format: String,       // jpeg, png, tiff; tiff-f32 for linear diagnostic output
    pub quality: Option<f32>, // 0.0 - 1.0
    pub width: Option<u32>,
    pub height: Option<u32>,
}

fn luminance(rgb: [f32; 3]) -> f32 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

// Relative display correction, shared contract with engine/developColorMath.ts.
// Kang 2002 Planckian xy, bounded CIE 1960 uv tint, Bradford adaptation.
fn color_matrix(m: [f32; 9], v: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|r| m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])
}
fn multiply_color_matrices(a: [f32; 9], b: [f32; 9]) -> [f32; 9] {
    std::array::from_fn(|i| (0..3).map(|k| a[(i / 3) * 3 + k] * b[k * 3 + i % 3]).sum())
}
fn white_xyz(temperature: f32, tint: f32) -> [f32; 3] {
    let t = temperature.clamp(2000.0, 12000.0);
    let x = if t <= 4000.0 {
        -0.2661239e9 / t.powi(3) - 0.2343589e6 / t.powi(2) + 0.8776956e3 / t + 0.179910
    } else {
        -3.0258469e9 / t.powi(3) + 2.1070379e6 / t.powi(2) + 0.2226347e3 / t + 0.24039
    };
    let y = if t <= 2222.0 {
        -1.1063814 * x.powi(3) - 1.3481102 * x * x + 2.18555832 * x - 0.20219683
    } else if t <= 4000.0 {
        -0.9549476 * x.powi(3) - 1.37418593 * x * x + 2.09137015 * x - 0.16748867
    } else {
        3.081758 * x.powi(3) - 5.8733867 * x * x + 3.75112997 * x - 0.37001483
    };
    let denominator = -2.0 * x + 12.0 * y + 3.0;
    let u = 4.0 * x / denominator;
    let v = 6.0 * y / denominator + tint.clamp(-150.0, 150.0) * 0.0001;
    let d = 2.0 * u - 8.0 * v + 4.0;
    let tx = 3.0 * u / d;
    let ty = 2.0 * v / d;
    [tx / ty, 1.0, (1.0 - tx - ty) / ty]
}
pub(super) fn relative_white_balance_matrix(temperature: f32, tint: f32) -> [f32; 9] {
    if temperature == 5500.0 && tint == 0.0 {
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    }
    let bradford = [
        0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296,
    ];
    let inverse = [
        0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428,
        0.9684867,
    ];
    let to_xyz = [
        0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192,
        0.9503041,
    ];
    let to_rgb = [
        3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259,
        1.0572252,
    ];
    let source = color_matrix(bradford, white_xyz(temperature, tint));
    let target = color_matrix(bradford, white_xyz(5500.0, 0.0));
    let scale = [
        target[0] / source[0],
        0.0,
        0.0,
        0.0,
        target[1] / source[1],
        0.0,
        0.0,
        0.0,
        target[2] / source[2],
    ];
    multiply_color_matrices(
        to_rgb,
        multiply_color_matrices(
            inverse,
            multiply_color_matrices(scale, multiply_color_matrices(bradford, to_xyz)),
        ),
    )
}
fn apply_white_balance(rgb: &mut [f32; 3], matrix: [f32; 9]) {
    let before = luminance(*rgb);
    let mut adjusted = color_matrix(matrix, *rgb);
    let after = luminance(adjusted);
    if after > 1e-8 {
        for v in &mut adjusted {
            *v *= before / after;
        }
    }
    *rgb = adjusted;
}
fn apply_contrast(rgb: &mut [f32; 3], contrast: f32) {
    let y = luminance(*rgb);
    if contrast != 0.0 && y > 1e-8 {
        let target = 0.18 * (y / 0.18).powf(2.0f32.powf(contrast / 100.0));
        for channel in rgb {
            *channel *= target / y;
        }
    }
}

fn apply_tone(rgb: &mut [f32; 3], shadows: f32, highlights: f32) {
    let luma = luminance(*rgb);
    let shadow_weight = 1.0 / (1.0 + ((luma - 0.25) * 12.0).exp());
    let highlight_weight = 1.0 / (1.0 + (-(luma - 0.55) * 10.0).exp());
    let gain = (1.0 + (shadows / 100.0) * shadow_weight * 0.75)
        * (1.0 + (highlights / 100.0) * highlight_weight * 0.75);
    for channel in rgb {
        *channel *= gain;
    }
}

fn apply_endpoints(rgb: &mut [f32; 3], luma: f32, whites: f32, blacks: f32) {
    let bounded = luma.clamp(0.0, 1.0);
    let white_gain = 1.0 + whites / 100.0 * bounded * bounded * 0.6;
    let black_gain = 2.0f32.powf(blacks / 100.0 * (1.0 - bounded).powi(2));
    for channel in rgb {
        *channel *= white_gain * black_gain;
    }
}

fn sample_curve(value: f32, lut: &[f32], channel: usize) -> f32 {
    let position = value.clamp(0.0, 1.0) * 1023.0;
    let lo = position.floor() as usize;
    let hi = (lo + 1).min(1023);
    let fraction = position - lo as f32;
    lut[lo * 4 + channel] * (1.0 - fraction)
        + lut[hi * 4 + channel] * fraction
        + (value - 1.0).max(0.0)
        + value.min(0.0)
}

fn rgb_to_hsv(rgb: [f32; 3]) -> [f32; 3] {
    let max = rgb[0].max(rgb[1]).max(rgb[2]);
    let min = rgb[0].min(rgb[1]).min(rgb[2]);
    let delta = max - min;
    let hue = if delta <= 1e-10 {
        0.0
    } else if max == rgb[0] {
        ((rgb[1] - rgb[2]) / delta).rem_euclid(6.0) / 6.0
    } else if max == rgb[1] {
        ((rgb[2] - rgb[0]) / delta + 2.0) / 6.0
    } else {
        ((rgb[0] - rgb[1]) / delta + 4.0) / 6.0
    };
    [hue, delta / (max + 1e-10), max]
}

fn hsv_to_rgb(hsv: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|channel| {
        let offset = [1.0, 2.0 / 3.0, 1.0 / 3.0][channel];
        let p = ((hsv[0] + offset).fract() * 6.0 - 3.0).abs();
        hsv[2] * (1.0 - hsv[1] + hsv[1] * (p - 1.0).clamp(0.0, 1.0))
    })
}

fn apply_color(rgb: &mut [f32; 3], settings: &NativeDevelopSettings) {
    if settings.curve_lut.is_empty()
        && settings.hsl.is_empty()
        && settings.vibrance == 0.0
        && settings.saturation == 0
    {
        return;
    }
    if !settings.curve_lut.is_empty() {
        for (channel, value) in rgb.iter_mut().enumerate() {
            *value = srgb_to_linear(sample_curve(
                linear_to_srgb(*value),
                &settings.curve_lut,
                channel,
            ));
        }
    }
    let mut hsv = if !settings.hsl.is_empty() || settings.vibrance != 0.0 {
        rgb_to_hsv(rgb.map(linear_to_srgb))
    } else {
        [0.0; 3]
    };
    if !settings.hsl.is_empty() {
        const CENTERS: [f32; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 285.0, 325.0];
        const WIDTHS: [f32; 8] = [45.0, 35.0, 40.0, 60.0, 50.0, 50.0, 45.0, 45.0];
        let mut weighted = [0.0; 3];
        let mut total = 0.0;
        for channel in 0..8 {
            let distance = ((hsv[0] * 360.0 - CENTERS[channel]).abs())
                .min(360.0 - (hsv[0] * 360.0 - CENTERS[channel]).abs());
            if distance >= WIDTHS[channel] {
                continue;
            }
            let weight = 0.5 * (1.0 + (std::f32::consts::PI * distance / WIDTHS[channel]).cos());
            total += weight;
            for component in 0..3 {
                weighted[component] += weight * settings.hsl[channel][component];
            }
        }
        if total > 1e-4 {
            hsv[0] = (hsv[0] + weighted[0] / total / 360.0).rem_euclid(1.0);
            hsv[1] = (hsv[1] * weighted[1] / total).clamp(0.0, 1.0);
            hsv[2] = (hsv[2] * (1.0 + weighted[2] / total)).max(0.0);
            *rgb = hsv_to_rgb(hsv).map(srgb_to_linear);
        }
    }
    if settings.vibrance != 0.0 {
        let max = rgb[0].max(rgb[1]).max(rgb[2]);
        let min = rgb[0].min(rgb[1]).min(rgb[2]);
        let saturation = (max - min) / max.max(1e-4);
        let skin_factor = if (0.02..0.12).contains(&hsv[0]) {
            0.45
        } else {
            1.0
        };
        let factor =
            (1.0 + (1.0 - saturation) * settings.vibrance / 100.0 * skin_factor).clamp(0.0, 2.5);
        apply_saturation(rgb, factor);
    }
    if settings.saturation != 0 {
        apply_saturation(rgb, (1.0 + settings.saturation as f32 / 100.0).max(0.0));
    }
}

fn apply_vignette(
    rgb: &mut [f32; 3],
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    amount: f32,
    midpoint: f32,
) {
    if amount == 0.0 {
        return;
    }
    let dx = (x as f32 + 0.5) / width as f32 - 0.5;
    let dy = (y as f32 + 0.5) / height as f32 - 0.5;
    let radius = (dx * dx + dy * dy).sqrt() * std::f32::consts::SQRT_2;
    let midpoint = (midpoint / 100.0).clamp(0.05, 0.95);
    let t = ((radius - midpoint * 0.5) / midpoint).clamp(0.0, 1.0);
    let mask = t * t * (3.0 - 2.0 * t);
    let factor = amount / 100.0;
    for channel in rgb {
        *channel = if factor < 0.0 {
            *channel * (1.0 + factor * mask)
        } else {
            *channel + (1.0 - *channel) * factor * mask * 0.6
        };
    }
}

fn apply_saturation(rgb: &mut [f32; 3], factor: f32) {
    let luma = luminance(*rgb);
    for channel in rgb {
        *channel = luma + (*channel - luma) * factor;
    }
}

fn sample_mask(mask: &NativeDevelopMask, x: usize, y: usize, width: usize, height: usize) -> f32 {
    let mx = ((x as f32 + 0.5) * mask.width as f32 / width as f32 - 0.5)
        .clamp(0.0, (mask.width - 1) as f32);
    let my = ((y as f32 + 0.5) * mask.height as f32 / height as f32 - 0.5)
        .clamp(0.0, (mask.height - 1) as f32);
    let x0 = mx.floor() as usize;
    let y0 = my.floor() as usize;
    let x1 = (x0 + 1).min(mask.width - 1);
    let y1 = (y0 + 1).min(mask.height - 1);
    let fx = mx - x0 as f32;
    let fy = my - y0 as f32;
    let top = mask.bytes[y0 * mask.width + x0] as f32 * (1.0 - fx)
        + mask.bytes[y0 * mask.width + x1] as f32 * fx;
    let bottom = mask.bytes[y1 * mask.width + x0] as f32 * (1.0 - fx)
        + mask.bytes[y1 * mask.width + x1] as f32 * fx;
    (top * (1.0 - fy) + bottom * fy) / 255.0
}

pub(super) fn base_tone_pixel(
    source: &super::linear_source::LinearSource<'_>,
    index: usize,
    settings: &NativeDevelopSettings,
    white_balance: [f32; 9],
    exposure_gain: f32,
) -> Result<[f32; 3], RawError> {
    let pixel=source.pixel(index)?;
    let mut rgb = [pixel[0],pixel[1],pixel[2]];
    apply_white_balance(&mut rgb, white_balance);
    for channel in &mut rgb {
        *channel *= exposure_gain;
    }
    let base_luma = luminance(rgb);
    apply_tone(&mut rgb, settings.shadows, settings.highlights);
    apply_endpoints(&mut rgb, base_luma, settings.whites, settings.blacks);
    apply_contrast(&mut rgb, settings.contrast as f32);
    Ok(rgb)
}

pub fn export_raw_develop(
    asset_id: &str,
    settings: NativeDevelopSettings,
    options: NativeExportOptions,
    output_path: &str,
) -> Result<String, RawError> {
    super::quality::base_matrix(&settings)?;
    let format_lower = options.format.to_lowercase();
    if !matches!(format_lower.as_str(), "png" | "jpeg" | "jpg" | "tiff" | "tif" | "tiff-f32") {
        return Err(RawError::DecodeFailed(format!(
            "Unsupported RAW export format '{}'",
            options.format
        )));
    }
    if options
        .quality
        .is_some_and(|quality| !(0.0..=1.0).contains(&quality))
    {
        return Err(RawError::DecodeFailed(
            "JPEG quality must be between 0 and 1".to_string(),
        ));
    }
    if options.width.is_some() != options.height.is_some()
        || options.width.is_some_and(|width| width == 0)
        || options.height.is_some_and(|height| height == 0)
        || options
            .width
            .zip(options.height)
            .is_some_and(|(width, height)| width as u64 * height as u64 > 150_000_000)
    {
        return Err(RawError::DecodeFailed(
            "Invalid RAW delivery dimensions".to_string(),
        ));
    }
    if settings.white_balance_mode != "as-shot"
        && settings.white_balance_mode != "custom"
        && settings.white_balance_mode != "auto"
    {
        return Err(RawError::DecodeFailed(format!(
            "Unsupported white balance mode '{}' for native RAW export",
            settings.white_balance_mode
        )));
    }
    if settings.white_balance_mode == "auto"
        && settings.white_balance_matrix.is_none_or(|matrix| {
            matrix.iter().enumerate().any(|(i, value)| {
                !value.is_finite()
                    || if i % 4 == 0 {
                        !(0.6..=1.67).contains(value)
                    } else {
                        *value != 0.0
                    }
            })
        })
    {
        return Err(RawError::DecodeFailed(
            "Unresolved auto white balance requires a valid correction matrix".to_string(),
        ));
    }
    if settings.white_balance_mode == "custom"
        && settings
            .temperature
            .is_some_and(|kelvin| !(2000..=12000).contains(&kelvin))
    {
        return Err(RawError::DecodeFailed(
            "Custom white balance temperature must be 2000–12000 K".to_string(),
        ));
    }
    if !settings.whites.is_finite()
        || !settings.blacks.is_finite()
        || !settings.vibrance.is_finite()
        || !settings.vignette_amount.is_finite()
        || !settings.vignette_midpoint.is_finite()
        || !(settings.curve_lut.is_empty() || settings.curve_lut.len() == 4096)
        || settings
            .curve_lut
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
        || !(settings.hsl.is_empty() || settings.hsl.len() == 8)
        || settings
            .hsl
            .iter()
            .flatten()
            .any(|value| !value.is_finite())
        || !(-100.0..=100.0).contains(&settings.texture)
        || !(-100.0..=100.0).contains(&settings.clarity)
        || !(-100.0..=100.0).contains(&settings.dehaze)
        || !(0.0..=150.0).contains(&settings.sharpen_amount)
        || !(0.5..=3.0).contains(&settings.sharpen_radius)
        || !(0.0..=25.0).contains(&settings.sharpen_threshold)
        || !(0.0..=100.0).contains(&settings.luma_denoise)
        || !(0.0..=100.0).contains(&settings.chroma_denoise)
    {
        return Err(RawError::DecodeFailed(
            "Invalid native RAW color adjustment payload".to_string(),
        ));
    }
    for mask in &settings.masks {
        if mask.width == 0
            || mask.height == 0
            || mask.width.checked_mul(mask.height) != Some(mask.bytes.len())
            || !mask.opacity.is_finite()
            || mask.opacity < 0.0
            || mask.opacity > 1.0
        {
            return Err(RawError::DecodeFailed(
                "Invalid local develop mask bitmap or opacity".to_string(),
            ));
        }
    }

    if !global_asset_registry().retain(asset_id) {
        return Err(RawError::DecodeFailed(format!(
            "Asset ID '{}' not found in registry",
            asset_id
        )));
    }
    let source_lease = ExportAssetLease(asset_id);
    let (width, height) = global_asset_registry()
        .with_asset(asset_id, |asset| {
            let width = asset.width;
            let height = asset.height;
            super::linear_source::LinearSource::new(asset)?;
            Ok((width, height))
        })
        .ok_or_else(|| RawError::DecodeFailed("RAW export source is unavailable".to_string()))??;
    let pixel_count = width * height; // validated checked multiplication above

    // Keep precision through the last encode; PNG retains 16-bit channels.
    let mut out_rgba = Vec::new();
    let floating_output=format_lower=="tiff-f32";
    if floating_output && (options.width.is_some_and(|w|w as usize!=width) || options.height.is_some_and(|h|h as usize!=height)) {
        return Err(RawError::DecodeFailed("Linear float diagnostic export requires original dimensions".into()));
    }
    if !floating_output {out_rgba
        .try_reserve_exact(pixel_count * 4)
        .map_err(|_| RawError::OutOfMemory)?;}
    if !floating_output {out_rgba.resize(pixel_count * 4, 0u16);}
    let mut out_float=Vec::new();
    if floating_output {
        out_float.try_reserve_exact(pixel_count*4).map_err(|_|RawError::OutOfMemory)?;
        out_float.resize(pixel_count*4,0f32);
    }

    // Compute exposure multiplier: 2^EV (Photographic scale)
    let exposure_gain = 2.0f32.powf(settings.exposure);
    let custom_wb = if settings.white_balance_mode == "custom" {
        relative_white_balance_matrix(
            settings.temperature.unwrap_or(5500) as f32,
            settings.tint.unwrap_or(0) as f32,
        )
    } else if settings.white_balance_mode == "auto" {
        settings
            .white_balance_matrix
            .expect("validated resolved auto matrix")
    } else {
        [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    };
    let analysis =
        if settings.dehaze != 0.0 || settings.luma_denoise != 0.0 || settings.chroma_denoise != 0.0
        {
            Some(super::quality::analyze_raw_spatial(asset_id, &settings)?)
        } else {
            None
        };
    let spatial = SpatialSettings {
        texture: settings.texture,
        clarity: settings.clarity,
        sharpen_amount: settings.sharpen_amount,
        sharpen_radius: settings.sharpen_radius,
        sharpen_threshold: settings.sharpen_threshold,
        scale: (width as f32 / 1920.0).max(height as f32 / 1080.0).max(1.0),
    };
    let halo = spatial.halo()
        + if settings.luma_denoise != 0.0 || settings.chroma_denoise != 0.0 {
            super::wavelet::NATIVE_HALO
        } else {
            0
        };

    // Bound the floating-point working set to a stripe plus its read-only halo.
    // The halo is recomputed at stripe boundaries, avoiding seams without a
    // full-image f32 copy alongside the original and the output buffer.
    for stripe_start in (0..height).step_by(128) {
        let stripe_end = (stripe_start + 128).min(height);
        let top = stripe_start.saturating_sub(halo);
        let bottom = (stripe_end + halo).min(height);
        // Borrow only while reading this stripe, allowing registry writes between
        // stripes and while the more expensive spatial/color processing runs.
        let base = global_asset_registry()
            .with_asset(asset_id, |asset| {
                let source=super::linear_source::LinearSource::new(asset)?;
                let mut base = Vec::new();
                base.try_reserve_exact((bottom - top) * width)
                    .map_err(|_| {
                        RawError::DecodeFailed(
                            "Insufficient memory for RAW filter stripe".to_string(),
                        )
                    })?;
                for y in top..bottom {
                    for x in 0..width {
                        base.push(base_tone_pixel(
                            &source,
                            y * width + x,
                            &settings,
                            custom_wb,
                            exposure_gain,
                        )?);
                    }
                }
                Ok::<_, RawError>(base)
            })
            .ok_or_else(|| {
                RawError::DecodeFailed("RAW export source is unavailable".to_string())
            })??;
        let filtered = if let Some(profile) = &analysis {
            super::wavelet::denoise(
                &base,
                width,
                bottom - top,
                settings.luma_denoise,
                settings.chroma_denoise,
                profile.noise,
            )
        } else {
            base
        };
        for y in stripe_start..stripe_end {
            for x in 0..width {
                let i = y * width + x;
                let mut rgb = spatial::apply(&filtered, width, height, top, x, y, spatial);
                if let Some(profile) = &analysis {
                    rgb = super::haze::apply(
                        rgb,
                        &profile.haze,
                        (x as f32 + 0.5) / width as f32,
                        (y as f32 + 0.5) / height as f32,
                        settings.dehaze,
                    );
                }
                apply_color(&mut rgb, &settings);
                for mask in &settings.masks {
                    let sampled = sample_mask(mask, x, y, width, height);
                    let weight = (if mask.inverted {
                        1.0 - sampled
                    } else {
                        sampled
                    }) * mask.opacity;
                    if weight <= 0.0 {
                        continue;
                    }
                    let before = rgb;
                    let mut adjusted = rgb;
                    let gain = 2.0f32.powf(mask.exposure);
                    let temp_shift = (mask.temperature / 100.0).clamp(-1.0, 1.0) * 0.35;
                    adjusted[0] *= gain * (1.0 + temp_shift);
                    adjusted[1] *= gain;
                    adjusted[2] *= gain * (1.0 - temp_shift);
                    apply_tone(&mut adjusted, mask.shadows, mask.highlights);
                    apply_contrast(&mut adjusted, mask.contrast);
                    apply_saturation(&mut adjusted, (1.0 + mask.saturation / 100.0).max(0.0));
                    for channel in 0..3 {
                        rgb[channel] =
                            before[channel] + (adjusted[channel] - before[channel]) * weight;
                    }
                }
                apply_vignette(
                    &mut rgb,
                    x,
                    y,
                    width,
                    height,
                    settings.vignette_amount,
                    settings.vignette_midpoint,
                );

                let out_idx = i * 4;
                let rgb=options.output_profile.convert(rgb);
                for channel in 0..3 {
                    if floating_output {out_float[out_idx+channel]=rgb[channel];}
                    else {out_rgba[out_idx + channel] = (linear_to_srgb(rgb[channel]) * 65535.0)
                        .round()
                        .clamp(0.0, 65535.0)
                        as u16;}
                }
                if floating_output {out_float[out_idx+3]=1.0;} else {out_rgba[out_idx + 3] = 65535;}
            }
        }
    }

    drop(source_lease);

    if floating_output {
        if options.width.is_some_and(|w|w as usize!=width) || options.height.is_some_and(|h|h as usize!=height) {
            return Err(RawError::DecodeFailed("Linear float diagnostic export requires original dimensions".into()));
        }
        use image::ImageEncoder;
        let mut writer=Cursor::new(Vec::new());
        let mut encoder=image::codecs::tiff::TiffEncoder::new(&mut writer);
        encoder.set_icc_profile(options.output_profile.icc(true)).map_err(|e|RawError::DecodeFailed(e.to_string()))?;
        let bytes:Vec<u8>=out_float.into_iter().flat_map(f32::to_ne_bytes).collect();
        encoder.write_image(&bytes,width as u32,height as u32,image::ExtendedColorType::Rgba32F).map_err(|e|RawError::DecodeFailed(e.to_string()))?;
        crate::filesystem::atomic_write(std::path::Path::new(output_path),writer.get_ref()).map_err(RawError::PermissionDenied)?;
        return Ok(output_path.into());
    }

    // Encode to target format and write to output_path
    let img = image::ImageBuffer::<image::Rgba<u16>, Vec<u16>>::from_raw(
        width as u32,
        height as u32,
        out_rgba,
    )
    .ok_or_else(|| {
        RawError::DecodeFailed("Failed to construct image buffer for export".to_string())
    })?;
    let img = match (options.width, options.height) {
        (Some(target_width), Some(target_height))
            if target_width != width as u32 || target_height != height as u32 =>
        {
            image::imageops::resize(
                &img,
                target_width,
                target_height,
                image::imageops::FilterType::Lanczos3,
            )
        }
        _ => img,
    };

    let mut writer = Cursor::new(Vec::new());

    if format_lower == "png" {
        let mut info=png::Info::with_size(img.width(),img.height());
        info.icc_profile=Some(std::borrow::Cow::Owned(options.output_profile.icc(false)));
        let mut encoder = png::Encoder::with_info(&mut writer,info).map_err(|e|RawError::DecodeFailed(e.to_string()))?;
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Sixteen);
        encoder.set_source_gamma(png::ScaledFloat::from_scaled(45455));
        let (red,green,blue)=if matches!(options.output_profile,super::output_profile::OutputProfile::DisplayP3) {
            ((0.68,0.32),(0.265,0.69),(0.15,0.06))
        } else {((0.64,0.33),(0.30,0.60),(0.15,0.06))};
        encoder.set_source_chromaticities(png::SourceChromaticities::new(
            (0.3127, 0.3290),
            red,green,blue,
        ));
        let mut png_writer = encoder
            .write_header()
            .map_err(|e| RawError::DecodeFailed(format!("PNG header failed: {e}")))?;
        let bytes: Vec<u8> = img
            .as_raw()
            .iter()
            .flat_map(|sample| sample.to_be_bytes())
            .collect();
        png_writer
            .write_image_data(&bytes)
            .map_err(|e| RawError::DecodeFailed(format!("PNG encode failed: {e}")))?;
        png_writer
            .finish()
            .map_err(|e| RawError::DecodeFailed(format!("PNG finish failed: {e}")))?;
    } else if matches!(format_lower.as_str(),"tiff"|"tif") {
        use image::ImageEncoder;
        let mut encoder=image::codecs::tiff::TiffEncoder::new(&mut writer);
        encoder.set_icc_profile(options.output_profile.icc(false)).map_err(|e|RawError::DecodeFailed(e.to_string()))?;
        let bytes:Vec<u8>=img.as_raw().iter().flat_map(|v|v.to_ne_bytes()).collect();
        encoder.write_image(&bytes,img.width(),img.height(),image::ExtendedColorType::Rgba16).map_err(|e|RawError::DecodeFailed(e.to_string()))?;
    } else {
        let rgb_img = image::DynamicImage::ImageRgba16(img).to_rgb8();
        let quality = options
            .quality
            .map(|value| (value * 100.0).round().clamp(1.0, 100.0) as u8)
            .unwrap_or(75);
        use image::ImageEncoder;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, quality);
        encoder
            .set_icc_profile(options.output_profile.icc(false))
            .map_err(|e| RawError::DecodeFailed(format!("JPEG color profile failed: {e}")))?;
        encoder
            .encode_image(&rgb_img)
            .map_err(|e| RawError::DecodeFailed(format!("JPEG encode failed: {}", e)))?;
    }

    crate::filesystem::atomic_write(std::path::Path::new(output_path), writer.get_ref())
        .map_err(RawError::PermissionDenied)?;
    Ok(output_path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::NativeImageAsset;
    use crate::raw::types::PixelFormat;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn diagnostic_tiff_retains_signed_linear_values_and_headroom() {
        let id="diagnostic_float_raw";
        let pixel=[-0.125f32,1.5,0.000001,1.0];
        global_asset_registry().register(NativeImageAsset {id:id.into(),width:1,height:1,pixel_format:PixelFormat::RGBA32F,
            buffer:pixel.into_iter().flat_map(f32::to_le_bytes).collect(),metadata:None,ref_count:1,created_at:0});
        let path=std::env::temp_dir().join("lumiseq_diagnostic_float.tif");
        let options=serde_json::from_value(serde_json::json!({"format":"tiff-f32","quality":null,"width":null,"height":null})).unwrap();
        export_raw_develop(id,settings(),options,path.to_str().unwrap()).unwrap();
        let decoded=image::open(&path).unwrap().to_rgba32f();
        assert_eq!(decoded.get_pixel(0,0).0,pixel);
        global_asset_registry().release(id);
    }

    #[test]
    fn profile_aware_png_and_tiff_preserve_16bit_p3_delivery() {
        let id="profile_aware_raw".to_string();
        global_asset_registry().register(NativeImageAsset {id:id.clone(),width:1,height:1,pixel_format:PixelFormat::RGBA16,
            buffer:[32768u16,16384,8192,65535].into_iter().flat_map(u16::to_le_bytes).collect(),metadata:None,ref_count:1,created_at:0});
        for format in ["png","tiff"] {
            let path=std::env::temp_dir().join(format!("lumiseq_p3_{}.{format}",NEXT_TEST_ID.fetch_add(1,Ordering::Relaxed)));
            let options:NativeExportOptions=serde_json::from_value(serde_json::json!({"format":format,"quality":null,"width":null,"height":null,"output_profile":"display-p3"})).unwrap();
            export_raw_develop(&id,settings(),options,path.to_str().unwrap()).unwrap();
            let image=image::open(&path).unwrap().to_rgba16();
            assert_eq!(image.dimensions(),(1,1));
            // Independent IEC/P3 primary conversion of [0.5,0.25,0.125].
            let expected=[46227i32,35730,26910];
            for c in 0..3 {assert!((image.get_pixel(0,0).0[c] as i32-expected[c]).abs()<8,"{format} channel {c}");}
            use image::ImageDecoder;
            let profile=if format=="tiff" {
                let mut tiff=tiff::decoder::Decoder::new(std::io::BufReader::new(std::fs::File::open(&path).unwrap())).unwrap();
                tiff.get_tag_u8_vec(tiff::tags::Tag::IccProfile).unwrap()
            } else {
                let mut decoder=image::ImageReader::open(&path).unwrap().with_guessed_format().unwrap().into_decoder().unwrap();
                decoder.icc_profile().unwrap().unwrap_or_else(||panic!("Missing ICC in {format}"))
            };
            assert!(profile.windows(18).any(|v|v==b"Lumiseq Display P3"));
        }
        global_asset_registry().release(&id);
    }

    /// Opt-in camera regression: private images/output stay outside tracked source.
    #[test]
    #[ignore = "requires LUMISEQ_RAW_VALIDATION and LUMISEQ_RAW_REPORT_DIR"]
    fn real_camera_raw_spatial_export_validation() {
        use crate::raw::types::DemosaicQuality;
        let path = std::env::var("LUMISEQ_RAW_VALIDATION").expect("RAW source path");
        let output = std::path::PathBuf::from(
            std::env::var("LUMISEQ_RAW_REPORT_DIR").expect("output directory"),
        );
        std::fs::create_dir_all(&output).unwrap();
        let started = std::time::Instant::now();
        let decoder = crate::raw::ffi::SafeRawDecoder::new(&path);
        let (width, height, pixel_format, buffer, metadata) =
            decoder.decode(DemosaicQuality::High).unwrap();
        assert_eq!(pixel_format, PixelFormat::RGBA16);
        let decode_ms = started.elapsed().as_millis();
        let id = format!("real_raw_{}", NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed));
        global_asset_registry().register(NativeImageAsset {
            id: id.clone(),
            width,
            height,
            pixel_format,
            buffer,
            metadata: Some(metadata.clone()),
            ref_count: 1,
            created_at: 0,
        });
        let samples = crate::raw::auto_white_balance::sample_raw_linear_rgb(&id).unwrap();
        std::fs::write(
            output.join("samples.json"),
            serde_json::to_vec(&samples).unwrap(),
        )
        .unwrap();
        if let Ok(thumbnail) = decoder.extract_thumbnail() {
            std::fs::write(output.join("camera-preview.jpg"), thumbnail).unwrap();
        }
        let mut cases = Vec::new();
        let crop_width = 800.min(width);
        let crop_height = 600.min(height);
        let crop_x = (width - crop_width) / 2;
        let crop_y = (height - crop_height) / 2;
        let tile = crate::raw::detail::render_raw_display_tile(
            &id,
            crop_x,
            crop_y,
            crop_width,
            crop_height,
        )
        .unwrap();
        std::fs::write(output.join("detail-source.png"), tile).unwrap();
        for name in [
            "neutral", "texture", "clarity", "dehaze", "sharpen", "luma", "chroma", "combined",
            "auto",
        ] {
            let auto_file = std::env::var("LUMISEQ_RAW_AUTO_RESULT").ok();
            if let Ok(selected) = std::env::var("LUMISEQ_RAW_CASES") {
                if !selected.split(',').any(|case| case == name) {
                    continue;
                }
            }
            if auto_file.is_some() != (name == "auto") {
                continue;
            }
            let mut develop = settings();
            match name {
                "texture" => develop.texture = 35.0,
                "clarity" => develop.clarity = 40.0,
                "dehaze" => develop.dehaze = 30.0,
                "sharpen" => {
                    develop.sharpen_amount = 45.0;
                    develop.sharpen_radius = 1.7;
                    develop.sharpen_threshold = 3.0;
                }
                "luma" => develop.luma_denoise = 40.0,
                "chroma" => develop.chroma_denoise = 45.0,
                "combined" => {
                    develop.texture = 35.0;
                    develop.clarity = 40.0;
                    develop.dehaze = 30.0;
                    develop.sharpen_amount = 45.0;
                    develop.sharpen_radius = 1.7;
                    develop.sharpen_threshold = 3.0;
                    develop.luma_denoise = 40.0;
                    develop.chroma_denoise = 45.0;
                }
                "auto" => {
                    let resolved: serde_json::Value =
                        serde_json::from_slice(&std::fs::read(auto_file.unwrap()).unwrap())
                            .unwrap();
                    develop.white_balance_mode = "auto".to_string();
                    develop.white_balance_matrix =
                        Some(serde_json::from_value(resolved["matrix"].clone()).unwrap());
                }
                _ => {}
            }
            let file = output.join(format!("{name}-full.png"));
            if name == "neutral"
                || name == "combined"
                || name == "dehaze"
                || name == "luma"
                || name == "chroma"
            {
                let analysis = super::super::quality::analyze_raw_spatial(&id, &develop).unwrap();
                std::fs::write(
                    output.join(format!("{name}-analysis.json")),
                    serde_json::to_vec(&analysis).unwrap(),
                )
                .unwrap();
            }
            let started = std::time::Instant::now();
            export_raw_develop(
                &id,
                develop.clone(),
                NativeExportOptions { output_profile: Default::default(),
                    format: "png".into(),
                    quality: None,
                    width: None,
                    height: None,
                },
                file.to_str().unwrap(),
            )
            .unwrap();
            let export_ms = started.elapsed().as_millis();
            let image = image::open(&file).unwrap();
            assert_eq!(
                (image.width(), image.height()),
                (width as u32, height as u32)
            );
            assert_eq!(image.color(), image::ColorType::Rgba16);
            image
                .crop_imm(
                    crop_x as u32,
                    crop_y as u32,
                    crop_width as u32,
                    crop_height as u32,
                )
                .to_rgb8()
                .save(output.join(format!("{name}-detail.png")))
                .unwrap();
            image
                .thumbnail(1280, 960)
                .to_rgb8()
                .save(output.join(format!("{name}-overview.png")))
                .unwrap();
            if name == "auto" {
                let jpeg = output.join("auto-full.jpg");
                export_raw_develop(
                    &id,
                    develop,
                    NativeExportOptions { output_profile: Default::default(),
                        format: "jpeg".into(),
                        quality: Some(0.95),
                        width: None,
                        height: None,
                    },
                    jpeg.to_str().unwrap(),
                )
                .unwrap();
                let jpeg = image::open(jpeg).unwrap();
                assert_eq!((jpeg.width(), jpeg.height()), (width as u32, height as u32));
                assert_eq!(jpeg.color(), image::ColorType::Rgb8);
            }
            cases.push(serde_json::json!({"name":name,"export_ms":export_ms,"bytes":std::fs::metadata(&file).unwrap().len(),"depth":16}));
        }
        global_asset_registry().release(&id);
        let report = serde_json::json!({"camera":metadata.camera_model,"width":width,"height":height,
            "decode_ms":decode_ms,"crop":{"x":crop_x,"y":crop_y,"width":crop_width,"height":crop_height},"cases":cases});
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        let report_name = if std::env::var("LUMISEQ_RAW_AUTO_RESULT").is_ok() {
            "auto-report.json"
        } else {
            "report.json"
        };
        std::fs::write(
            output.join(report_name),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn relative_bradford_white_balance_matches_preview_reference() {
        let mut rgb = [0.3; 3];
        apply_white_balance(&mut rgb, relative_white_balance_matrix(9500.0, 100.0));
        for (actual, expected) in rgb.into_iter().zip([0.376311, 0.28533526, 0.22056096]) {
            assert!((actual - expected).abs() < 0.00001, "{rgb:?}");
        }
        let mut neutral = [0.4, 0.2, 0.1];
        apply_white_balance(&mut neutral, relative_white_balance_matrix(5500.0, 0.0));
        assert_eq!(neutral, [0.4, 0.2, 0.1]);
    }

    #[test]
    fn contrast_preserves_linear_color_ratios() {
        let mut rgb = [0.4, 0.2, 0.1];
        apply_contrast(&mut rgb, 50.0);
        assert!((rgb[0] / rgb[1] - 2.0).abs() < 0.00001);
        assert!((rgb[2] / rgb[1] - 0.5).abs() < 0.00001);
    }

    fn settings() -> NativeDevelopSettings {
        NativeDevelopSettings {
            exposure: 0.0,
            contrast: 0,
            saturation: 0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            vibrance: 0.0,
            dehaze: 0.0,
            luma_denoise: 0.0,
            chroma_denoise: 0.0,
            curve_lut: Vec::new(),
            hsl: Vec::new(),
            vignette_amount: 0.0,
            vignette_midpoint: 50.0,
            texture: 0.0,
            clarity: 0.0,
            sharpen_amount: 0.0,
            sharpen_radius: 1.0,
            sharpen_threshold: 0.0,
            white_balance_mode: "as-shot".to_string(),
            white_balance_matrix: None,
            temperature: None,
            tint: None,
            masks: Vec::new(),
        }
    }

    #[test]
    fn float_source_headroom_is_reduced_before_delivery_quantization() {
        let id="raw_float_headroom_export";
        global_asset_registry().register(NativeImageAsset {
            id:id.into(),width:1,height:1,pixel_format:PixelFormat::RGBA32F,
            buffer:[1.5f32,0.5,0.000001,1.0].into_iter().flat_map(f32::to_le_bytes).collect(),
            metadata:None,ref_count:1,created_at:0,
        });
        let path=std::env::temp_dir().join("lumiseq_float_headroom.png");
        let mut s=settings();s.exposure=-1.0;
        export_raw_develop(id,s,NativeExportOptions{output_profile:Default::default(),format:"png".into(),quality:None,width:None,height:None},path.to_str().unwrap()).unwrap();
        let decoded=image::open(&path).unwrap().to_rgba16().get_pixel(0,0).0;
        assert!((decoded[0] as f32/65535.0-linear_to_srgb(0.75)).abs()<2.0/65535.0);
        assert_ne!(decoded[0],65535);
        global_asset_registry().release(id);
        std::fs::remove_file(path).unwrap();
    }

    fn export_pixel(linear_rgb: [f32; 3], settings: NativeDevelopSettings) -> [u8; 3] {
        export_pixels(&[linear_rgb], settings)[0]
    }

    fn export_pixels(linear_rgb: &[[f32; 3]], settings: NativeDevelopSettings) -> Vec<[u8; 3]> {
        let test_id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        let asset_id = format!("raw_develop_test_{test_id}");
        let mut buffer = Vec::with_capacity(linear_rgb.len() * 8);
        for pixel in linear_rgb {
            for channel in pixel {
                buffer.extend_from_slice(&((channel * 65535.0).round() as u16).to_le_bytes());
            }
            buffer.extend_from_slice(&u16::MAX.to_le_bytes());
        }

        global_asset_registry().register(NativeImageAsset {
            id: asset_id.clone(),
            width: linear_rgb.len(),
            height: 1,
            pixel_format: PixelFormat::RGBA16,
            buffer,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });

        let path = std::env::temp_dir().join(format!("raw_develop_test_{test_id}.png"));
        export_raw_develop(
            &asset_id,
            settings,
            NativeExportOptions { output_profile: Default::default(),
                format: "png".to_string(),
                quality: None,
                width: None,
                height: None,
            },
            path.to_str().unwrap(),
        )
        .unwrap();
        let image = image::open(&path).unwrap().to_rgb8();
        let pixels: Vec<[u8; 3]> = (0..linear_rgb.len())
            .map(|x| image.get_pixel(x as u32, 0).0)
            .collect();
        std::fs::remove_file(path).unwrap();
        global_asset_registry().release(&asset_id);
        pixels
    }

    fn with_mask(mask: serde_json::Value) -> NativeDevelopSettings {
        let mut value = serde_json::to_value(settings()).unwrap();
        value["masks"] = serde_json::json!([mask]);
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn native_texture_and_clarity_change_local_detail() {
        let source = vec![[0.4; 3]; 17];
        let mut source = source;
        source[8] = [0.62; 3];
        let baseline = export_pixels(&source, settings());
        for control in ["texture", "clarity"] {
            let mut value = serde_json::to_value(settings()).unwrap();
            value[control] = serde_json::json!(80.0);
            let adjusted = export_pixels(&source, serde_json::from_value(value).unwrap());
            assert!(
                adjusted[8][0] > baseline[8][0],
                "{control} should increase isolated detail"
            );
        }
    }

    #[test]
    fn native_sharpen_increases_edge_acutance_after_tone() {
        let source = [[0.25; 3], [0.25; 3], [0.7; 3], [0.7; 3], [0.7; 3]];
        let baseline = export_pixels(&source, settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        value["sharpen_amount"] = serde_json::json!(100.0);
        let adjusted = export_pixels(&source, serde_json::from_value(value).unwrap());
        assert!(adjusted[2][0] > baseline[2][0]);
    }

    #[test]
    fn native_denoise_reduces_small_isolated_noise() {
        let source = [[0.5; 3], [0.5; 3], [0.57; 3], [0.5; 3], [0.5; 3]];
        let baseline = export_pixels(&source, settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        value["luma_denoise"] = serde_json::json!(100.0);
        let adjusted = export_pixels(&source, serde_json::from_value(value).unwrap());
        assert!(adjusted[2][0] < baseline[2][0]);
    }

    #[test]
    fn native_dehaze_recovers_contrast_without_changing_clear_black() {
        // A four-pixel row fits entirely inside dark-channel support. Use
        // separate clear foreground, hazy object and measured colored airlight.
        let source: Vec<[f32; 3]> = (0..64)
            .map(|x| {
                if x < 12 {
                    [0.0; 3]
                } else if x < 48 {
                    [0.36, 0.42, 0.5]
                } else {
                    [0.64, 0.78, 0.9]
                }
            })
            .collect();
        let baseline = export_pixels(&source, settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        value["dehaze"] = serde_json::json!(50.0);
        let adjusted = export_pixels(&source, serde_json::from_value(value).unwrap());
        assert_eq!(adjusted[0], baseline[0]);
        assert!(adjusted[32][0] < baseline[32][0]);
        assert!(adjusted[32][2] > adjusted[32][0]);
    }

    #[test]
    fn native_deliveries_declare_srgb_color_metadata() {
        use image::ImageDecoder;
        let test_id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        let asset_id = format!("raw_color_tags_{test_id}");
        let buffer = [10000u16, 20000, 30000, 65535]
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect();
        global_asset_registry().register(NativeImageAsset {
            id: asset_id.clone(),
            width: 1,
            height: 1,
            pixel_format: PixelFormat::RGBA16,
            buffer,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        for format in ["png", "jpeg"] {
            let path = std::env::temp_dir().join(format!("raw_color_tags_{test_id}.{format}"));
            export_raw_develop(
                &asset_id,
                settings(),
                NativeExportOptions { output_profile: Default::default(),
                    format: format.to_string(),
                    quality: Some(0.95),
                    width: None,
                    height: None,
                },
                path.to_str().unwrap(),
            )
            .unwrap();
            let bytes = std::fs::read(&path).unwrap();
            std::fs::remove_file(path).unwrap();
            if format == "png" {
                let mut offset = 8;
                let mut tags = Vec::new();
                while offset < bytes.len() {
                    let length =
                        u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
                    let name = &bytes[offset + 4..offset + 8];
                    let body = &bytes[offset + 8..offset + 8 + length];
                    if name == b"sRGB" {
                        assert_eq!(body, &[1]);
                        tags.push("sRGB");
                    }
                    if name == b"gAMA" {
                        assert_eq!(body, &45455u32.to_be_bytes());
                        tags.push("gAMA");
                    }
                    if name == b"cHRM" {
                        let expected: Vec<_> =
                            [31270u32, 32900, 64000, 33000, 30000, 60000, 15000, 6000]
                                .into_iter()
                                .flat_map(u32::to_be_bytes)
                                .collect();
                        assert_eq!(body, expected);
                        tags.push("cHRM");
                    }
                    assert_ne!(name,b"sRGB","ICC-tagged PNG must not declare a conflicting sRGB chunk");
                    if name==b"iCCP" {tags.push("iCCP");}
                    if name == b"IDAT" {
                        break;
                    }
                    offset += length + 12;
                }
                assert_eq!(
                    tags.len(),
                    3,
                    "Missing iCCP/gAMA/cHRM delivery metadata: {tags:?}"
                );
            } else {
                let mut decoder =
                    image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).unwrap();
                let profile = decoder
                    .icc_profile()
                    .unwrap()
                    .expect("JPEG must embed an sRGB ICC profile");
                assert_eq!(&profile[36..40], b"acsp");
                assert_eq!(&profile[16..20], b"RGB ");
                assert_eq!(&profile[20..24], b"XYZ ");
                assert_eq!(
                    u32::from_be_bytes(profile[..4].try_into().unwrap()) as usize,
                    profile.len()
                );
                // Decode ICC tags independently: the profile must describe the
                // actual piecewise sRGB pixels, not a nominal gamma 2.2 curve.
                let count = u32::from_be_bytes(profile[128..132].try_into().unwrap()) as usize;
                let tag = |signature: &[u8]| {
                    let record = (0..count)
                        .map(|i| &profile[132 + i * 12..144 + i * 12])
                        .find(|entry| &entry[..4] == signature)
                        .expect("required ICC tag");
                    let start = u32::from_be_bytes(record[4..8].try_into().unwrap()) as usize;
                    let length = u32::from_be_bytes(record[8..12].try_into().unwrap()) as usize;
                    &profile[start..start + length]
                };
                let curve = tag(b"rTRC");
                assert_eq!(curve, tag(b"gTRC"));
                assert_eq!(curve, tag(b"bTRC"));
                assert_eq!(&curve[..4], b"curv");
                let samples = u32::from_be_bytes(curve[8..12].try_into().unwrap()) as usize;
                for code in [0u32, 1, 10, 11, 32, 64, 128, 192, 254, 255] {
                    let x = code as f64 / 255.0;
                    let position = x * (samples - 1) as f64;
                    let lo = position.floor() as usize;
                    let hi = (lo + 1).min(samples - 1);
                    let sample = |i| {
                        u16::from_be_bytes(curve[12 + i * 2..14 + i * 2].try_into().unwrap()) as f64
                            / 65535.0
                    };
                    let actual = sample(lo) + (sample(hi) - sample(lo)) * (position - lo as f64);
                    let expected = if code <= 10 {
                        x / 12.92
                    } else {
                        ((x + 0.055) / 1.055).powf(2.4)
                    };
                    assert!(
                        (actual - expected).abs() < 0.00001,
                        "ICC TRC mismatch at code {code}: {actual} vs {expected}"
                    );
                }
                let xyz = |signature: &[u8]| {
                    let data = tag(signature);
                    assert_eq!(&data[..4], b"XYZ ");
                    std::array::from_fn::<_, 3, _>(|i| {
                        i32::from_be_bytes(data[8 + i * 4..12 + i * 4].try_into().unwrap()) as f64
                            / 65536.0
                    })
                };
                let primaries = [xyz(b"rXYZ"), xyz(b"gXYZ"), xyz(b"bXYZ")];
                let white = xyz(b"wtpt");
                for i in 0..3 {
                    assert!(
                        (primaries.iter().map(|p| p[i]).sum::<f64>() - white[i]).abs() < 0.00005
                    );
                }
            }
        }
        global_asset_registry().release(&asset_id);
    }

    #[test]
    fn png_export_preserves_16_bit_display_precision() {
        let test_id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        let asset_id = format!("raw_png_depth_{test_id}");
        let mut buffer = Vec::new();
        for channel in [10000u16, 20000, 30000, 65535] {
            buffer.extend_from_slice(&channel.to_le_bytes());
        }
        global_asset_registry().register(NativeImageAsset {
            id: asset_id.clone(),
            width: 1,
            height: 1,
            pixel_format: PixelFormat::RGBA16,
            buffer,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        let path = std::env::temp_dir().join(format!("raw_png_depth_{test_id}.png"));
        export_raw_develop(
            &asset_id,
            settings(),
            NativeExportOptions { output_profile: Default::default(),
                format: "png".to_string(),
                quality: None,
                width: None,
                height: None,
            },
            path.to_str().unwrap(),
        )
        .unwrap();
        let image = image::open(&path).unwrap();
        assert_eq!(image.color(), image::ColorType::Rgba16);
        let output = image.to_rgba16().get_pixel(0, 0).0;
        assert!(
            output[0] % 257 != 0,
            "PNG was rounded to 8-bit levels: {output:?}"
        );
        std::fs::remove_file(path).unwrap();
        global_asset_registry().release(&asset_id);
    }

    #[test]
    fn exported_highlights_reduce_bright_pixels() {
        let baseline = export_pixel([0.8, 0.8, 0.8], settings());
        let mut adjusted = settings();
        adjusted.highlights = -100.0;
        let output = export_pixel([0.8, 0.8, 0.8], adjusted);
        assert!(output[0] < baseline[0] - 10, "{output:?} vs {baseline:?}");
    }

    #[test]
    fn exported_shadows_lift_dark_pixels() {
        let baseline = export_pixel([0.05, 0.05, 0.05], settings());
        let mut adjusted = settings();
        adjusted.shadows = 100.0;
        let output = export_pixel([0.05, 0.05, 0.05], adjusted);
        assert!(output[0] > baseline[0] + 10, "{output:?} vs {baseline:?}");
    }

    #[test]
    fn exported_whites_and_blacks_follow_bright_and_dark_tones() {
        let bright = export_pixel([0.7; 3], settings());
        let dark = export_pixel([0.08; 3], settings());
        let mut whites = serde_json::to_value(settings()).unwrap();
        whites["whites"] = serde_json::json!(80.0);
        let mut blacks = serde_json::to_value(settings()).unwrap();
        blacks["blacks"] = serde_json::json!(-80.0);
        assert!(
            export_pixel([0.7; 3], serde_json::from_value(whites).unwrap())[0] > bright[0] + 10
        );
        assert!(export_pixel([0.08; 3], serde_json::from_value(blacks).unwrap())[0] < dark[0] - 5);
    }

    #[test]
    fn exported_curve_changes_selected_channel_only() {
        let baseline = export_pixel([0.25, 0.25, 0.25], settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        let mut lut = Vec::with_capacity(4096);
        for i in 0..1024 {
            let x = i as f32 / 1023.0;
            lut.extend([x * 0.5, x, x, 1.0]);
        }
        value["curve_lut"] = serde_json::json!(lut);
        let output = export_pixel([0.25, 0.25, 0.25], serde_json::from_value(value).unwrap());
        assert!(output[0] < baseline[0] - 20, "{output:?} vs {baseline:?}");
        assert!((output[1] as i16 - baseline[1] as i16).abs() <= 1);
    }

    #[test]
    fn exported_hsl_hue_rotates_red_toward_orange() {
        let baseline = export_pixel([0.7, 0.08, 0.08], settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        let mut hsl = vec![[0.0, 1.0, 0.0]; 8];
        hsl[0][0] = 30.0;
        value["hsl"] = serde_json::json!(hsl);
        let output = export_pixel([0.7, 0.08, 0.08], serde_json::from_value(value).unwrap());
        assert!(output[1] > baseline[1] + 25, "{output:?} vs {baseline:?}");
        assert!(output[0] >= baseline[0] - 2);
    }

    #[test]
    fn exported_vibrance_boosts_muted_blue() {
        let baseline = export_pixel([0.25, 0.3, 0.4], settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        value["vibrance"] = serde_json::json!(80.0);
        let output = export_pixel([0.25, 0.3, 0.4], serde_json::from_value(value).unwrap());
        assert!(output[2] - output[0] > baseline[2] - baseline[0] + 10);
    }

    #[test]
    fn exported_vignette_darkens_edges_but_preserves_center() {
        let baseline = export_pixels(&[[0.5; 3]; 5], settings());
        let mut value = serde_json::to_value(settings()).unwrap();
        value["vignette_amount"] = serde_json::json!(-80.0);
        value["vignette_midpoint"] = serde_json::json!(50.0);
        let output = export_pixels(&[[0.5; 3]; 5], serde_json::from_value(value).unwrap());
        assert!(
            output[0][0] < baseline[0][0] - 20,
            "{output:?} vs {baseline:?}"
        );
        assert_eq!(output[2], baseline[2]);
    }

    #[test]
    fn exported_custom_white_balance_changes_temperature_and_tint() {
        let baseline = export_pixel([0.3, 0.3, 0.3], settings());
        let mut adjusted = settings();
        adjusted.white_balance_mode = "custom".to_string();
        adjusted.temperature = Some(9500);
        adjusted.tint = Some(100);
        let output = export_pixel([0.3, 0.3, 0.3], adjusted);
        assert!(
            output[0] > baseline[0] + 10,
            "red: {output:?} vs {baseline:?}"
        );
        assert!(output[1] < baseline[1], "green: {output:?} vs {baseline:?}");
        assert!(output[2] < baseline[2], "blue: {output:?} vs {baseline:?}");
    }

    #[test]
    fn exported_local_mask_changes_only_covered_pixels() {
        let baseline = settings();
        let adjusted = with_mask(serde_json::json!({
            "width": 2, "height": 1, "bytes": [255, 0],
            "inverted": false, "opacity": 1.0, "exposure": 1.0
        }));
        let base = export_pixels(&[[0.2, 0.2, 0.2], [0.2, 0.2, 0.2]], baseline);
        let output = export_pixels(&[[0.2, 0.2, 0.2], [0.2, 0.2, 0.2]], adjusted);
        assert!(output[0][0] > base[0][0] + 20, "{output:?} vs {base:?}");
        assert_eq!(output[1], base[1], "uncovered pixel changed");
    }

    #[test]
    fn exported_local_mask_bilinear_sampling_and_inversion() {
        let adjusted = with_mask(serde_json::json!({
            "width": 2, "height": 1, "bytes": [255, 0],
            "inverted": true, "opacity": 1.0, "exposure": 1.0
        }));
        let output = export_pixels(&[[0.2; 3]; 4], adjusted);
        assert!(output[0][0] < output[1][0]);
        assert!(output[1][0] < output[2][0]);
        assert!(output[2][0] < output[3][0]);
    }

    #[test]
    fn exported_local_mask_opacity_blends_adjustment() {
        let baseline = export_pixel([0.2; 3], settings());
        let half = export_pixel(
            [0.2; 3],
            with_mask(serde_json::json!({
                "width": 1, "height": 1, "bytes": [255],
                "inverted": false, "opacity": 0.5, "exposure": 1.0
            })),
        );
        let full = export_pixel(
            [0.2; 3],
            with_mask(serde_json::json!({
                "width": 1, "height": 1, "bytes": [255],
                "inverted": false, "opacity": 1.0, "exposure": 1.0
            })),
        );
        assert!(baseline[0] < half[0] && half[0] < full[0]);
    }

    #[test]
    fn native_export_rejects_unresolved_auto_white_balance() {
        let mut adjusted = settings();
        adjusted.white_balance_mode = "auto".to_string();
        let result = export_raw_develop(
            "unused",
            adjusted,
            NativeExportOptions { output_profile: Default::default(),
                format: "png".to_string(),
                quality: None,
                width: None,
                height: None,
            },
            "unused.png",
        );
        assert!(matches!(result, Err(RawError::DecodeFailed(message)) if message.contains("auto")));
    }

    #[test]
    fn native_export_rejects_malformed_color_payload_before_asset_lookup() {
        let mut invalid_lut = settings();
        invalid_lut.curve_lut = vec![0.5; 3];
        let mut invalid_hsl = settings();
        invalid_hsl.hsl = vec![[0.0, 1.0, 0.0]; 2];
        let mut non_finite = settings();
        non_finite.vibrance = f32::NAN;
        for invalid in [invalid_lut, invalid_hsl, non_finite] {
            let result = export_raw_develop(
                "unused",
                invalid,
                NativeExportOptions { output_profile: Default::default(),
                    format: "png".to_string(),
                    quality: None,
                    width: None,
                    height: None,
                },
                "unused.png",
            );
            assert!(
                matches!(result, Err(RawError::DecodeFailed(message)) if message.contains("color adjustment payload"))
            );
        }
    }

    #[test]
    fn jpeg_quality_changes_encoded_output_size() {
        let test_id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        let asset_id = format!("raw_develop_jpeg_quality_{test_id}");
        let mut buffer = Vec::with_capacity(32 * 32 * 8);
        for y in 0..32 {
            for x in 0..32 {
                for channel in 0..3 {
                    let value = ((x * 73 + y * 37 + channel * 97) % 256) as u16 * 257;
                    buffer.extend_from_slice(&value.to_le_bytes());
                }
                buffer.extend_from_slice(&u16::MAX.to_le_bytes());
            }
        }
        global_asset_registry().register(NativeImageAsset {
            id: asset_id.clone(),
            width: 32,
            height: 32,
            pixel_format: PixelFormat::RGBA16,
            buffer,
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        let low_path = std::env::temp_dir().join(format!("raw_quality_low_{test_id}.jpg"));
        let high_path = std::env::temp_dir().join(format!("raw_quality_high_{test_id}.jpg"));
        for (path, quality) in [(&low_path, 0.2), (&high_path, 0.95)] {
            export_raw_develop(
                &asset_id,
                settings(),
                NativeExportOptions { output_profile: Default::default(),
                    format: "jpeg".to_string(),
                    quality: Some(quality),
                    width: None,
                    height: None,
                },
                path.to_str().unwrap(),
            )
            .unwrap();
        }
        let low_size = std::fs::metadata(&low_path).unwrap().len();
        let high_size = std::fs::metadata(&high_path).unwrap().len();
        std::fs::remove_file(low_path).unwrap();
        std::fs::remove_file(high_path).unwrap();
        global_asset_registry().release(&asset_id);
        assert!(
            high_size > low_size + 100,
            "low: {low_size}, high: {high_size}"
        );
    }

    #[test]
    fn native_export_resizes_to_requested_delivery_dimensions() {
        let test_id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        let asset_id = format!("raw_develop_resize_{test_id}");
        global_asset_registry().register(NativeImageAsset {
            id: asset_id.clone(),
            width: 4,
            height: 2,
            pixel_format: PixelFormat::RGBA16,
            buffer: vec![255; 4 * 2 * 8],
            metadata: None,
            ref_count: 1,
            created_at: 0,
        });
        let path = std::env::temp_dir().join(format!("raw_resize_{test_id}.png"));
        export_raw_develop(
            &asset_id,
            settings(),
            NativeExportOptions { output_profile: Default::default(),
                format: "png".to_string(),
                quality: None,
                width: Some(2),
                height: Some(1),
            },
            path.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(image::image_dimensions(&path).unwrap(), (2, 1));
        std::fs::remove_file(path).unwrap();
        global_asset_registry().release(&asset_id);
    }

    #[test]
    fn native_export_rejects_unknown_format_before_creating_file() {
        let result = export_raw_develop(
            "unused",
            settings(),
            NativeExportOptions { output_profile: Default::default(),
                format: "bmp".to_string(),
                quality: None,
                width: None,
                height: None,
            },
            "unused.bmp",
        );
        assert!(matches!(result, Err(RawError::DecodeFailed(message)) if message.contains("bmp")));
    }

    #[test]
    fn resolved_auto_white_balance_uses_shared_matrix() {
        let mut payload = serde_json::to_value(settings()).unwrap();
        payload["white_balance_mode"] = serde_json::json!("auto");
        payload["white_balance_matrix"] = serde_json::json!([
            0.8333333333333334,
            0.,
            0.,
            0.,
            1.,
            0.,
            0.,
            0.,
            1.1764705882352942
        ]);
        let resolved: NativeDevelopSettings = serde_json::from_value(payload).unwrap();
        let output = export_pixel([0.24, 0.2, 0.17], resolved);
        assert!(
            (output[0] as i32 - output[1] as i32).abs() <= 1,
            "{output:?}"
        );
        assert!(
            (output[2] as i32 - output[1] as i32).abs() <= 1,
            "{output:?}"
        );
    }

    #[test]
    fn exported_local_temperature_and_saturation_affect_masked_color() {
        let baseline = export_pixel([0.4, 0.2, 0.2], settings());
        let adjusted = with_mask(serde_json::json!({
            "width": 1, "height": 1, "bytes": [255],
            "inverted": false, "opacity": 1.0,
            "temperature": 100.0, "saturation": 100.0
        }));
        let output = export_pixel([0.4, 0.2, 0.2], adjusted);
        assert!(output[0] > baseline[0], "red: {output:?} vs {baseline:?}");
        assert!(output[2] < baseline[2], "blue: {output:?} vs {baseline:?}");
    }

    #[test]
    fn exported_local_highlights_shadows_and_contrast_affect_masked_tones() {
        let bright = [0.7; 3];
        let dark = [0.05; 3];
        let high = with_mask(serde_json::json!({
            "width": 1, "height": 1, "bytes": [255],
            "inverted": false, "opacity": 1.0, "highlights": -100.0
        }));
        let shadow = with_mask(serde_json::json!({
            "width": 1, "height": 1, "bytes": [255],
            "inverted": false, "opacity": 1.0, "shadows": 100.0
        }));
        let contrast = with_mask(serde_json::json!({
            "width": 1, "height": 1, "bytes": [255],
            "inverted": false, "opacity": 1.0, "contrast": 50.0
        }));
        assert!(export_pixel(bright, high)[0] < export_pixel(bright, settings())[0]);
        assert!(export_pixel(dark, shadow)[0] > export_pixel(dark, settings())[0]);
        assert!(export_pixel(bright, contrast)[0] > export_pixel(bright, settings())[0]);
    }
}
