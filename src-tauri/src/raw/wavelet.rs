//! Original MIT wavelet kernel. The algorithmic reference is darktable's denoise (profiled) manual.
//! Native RGB stripes require a 14-pixel halo, discarded by the caller.

pub const NATIVE_HALO: usize = 14;
pub const NOISE_FACTORS: [f32; 3] = [1.0, 0.22526345103699957, 0.0959899628755893];
const TAPS: [f32; 5] = [1.0 / 16.0, 4.0 / 16.0, 6.0 / 16.0, 4.0 / 16.0, 1.0 / 16.0];
const NORMAL_MAD: f32 = 0.6744897501960817;

fn validate_shape(pixels: &[[f32; 3]], width: usize, height: usize) {
    assert!(
        width.checked_mul(height) == Some(pixels.len()),
        "Wavelet input must contain exactly width * height RGB pixels"
    );
}

fn nonnegative(value: f32) -> f32 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn signed_sqrt(value:f32)->f32 {
    if value.is_finite() {value.signum()*value.abs().sqrt()} else {0.0}
}
fn amount(value: f32) -> f32 {
    nonnegative(value).min(100.0) / 100.0
}

fn to_opponent(pixels: &[[f32; 3]]) -> Vec<[f32; 3]> {
    pixels
        .iter()
        .map(|p| {
            let r = signed_sqrt(p[0]);
            let g = signed_sqrt(p[1]);
            let b = signed_sqrt(p[2]);
            [0.25 * r + 0.5 * g + 0.25 * b, r - g, b - g]
        })
        .collect()
}

fn blur(
    source: &[[f32; 3]],
    horizontal: &mut [[f32; 3]],
    target: &mut [[f32; 3]],
    width: usize,
    height: usize,
    dilation: usize,
) {
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0.0; 3];
            for (k, weight) in TAPS.iter().enumerate() {
                let sx = (x as isize + (k as isize - 2) * dilation as isize)
                    .clamp(0, (width - 1) as isize) as usize;
                let p = source[y * width + sx];
                for c in 0..3 {
                    sum[c] += p[c] * weight;
                }
            }
            horizontal[y * width + x] = sum;
        }
    }
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0.0; 3];
            for (k, weight) in TAPS.iter().enumerate() {
                let sy = (y as isize + (k as isize - 2) * dilation as isize)
                    .clamp(0, (height - 1) as isize) as usize;
                let p = horizontal[sy * width + x];
                for c in 0..3 {
                    sum[c] += p[c] * weight;
                }
            }
            target[y * width + x] = sum;
        }
    }
}

fn median_sorted(values: &[f32]) -> f32 {
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        values[middle]
    } else {
        (values[middle - 1] + values[middle]) * 0.5
    }
}

/// Finest-band MAD on the entire provided adjacent native-resolution patch.
pub fn estimate_noise(pixels: &[[f32; 3]], width: usize, height: usize) -> [f32; 3] {
    validate_shape(pixels, width, height);
    if pixels.is_empty() {
        return [0.0; 3];
    }
    let opponent = to_opponent(pixels);
    let mut horizontal = vec![[0.0; 3]; pixels.len()];
    let mut low = vec![[0.0; 3]; pixels.len()];
    blur(&opponent, &mut horizontal, &mut low, width, height, 1);
    let mut coefficients = vec![0.0; pixels.len()];
    let mut sigma = [0.0; 3];
    for c in 0..3 {
        for i in 0..pixels.len() {
            coefficients[i] = opponent[i][c] - low[i][c];
        }
        coefficients.sort_unstable_by(f32::total_cmp);
        let center = median_sorted(&coefficients);
        for value in &mut coefficients {
            *value = (*value - center).abs();
        }
        coefficients.sort_unstable_by(f32::total_cmp);
        sigma[c] = median_sorted(&coefficients) / NORMAL_MAD;
    }
    sigma
}

/// Three-level undecimated B3 spline opponent-domain soft threshold reconstruction.
pub fn denoise(
    pixels: &[[f32; 3]],
    width: usize,
    height: usize,
    luma_amount: f32,
    chroma_amount: f32,
    sigma: [f32; 3],
) -> Vec<[f32; 3]> {
    validate_shape(pixels, width, height);
    let luma = amount(luma_amount);
    let chroma = amount(chroma_amount);
    let thresholds = [
        nonnegative(sigma[0]) * luma,
        nonnegative(sigma[1]) * chroma,
        nonnegative(sigma[2]) * chroma,
    ];
    if pixels.is_empty() || thresholds.iter().all(|v| *v == 0.0) {
        return pixels.to_vec();
    }
    let mut current = to_opponent(pixels);
    let mut next = vec![[0.0; 3]; pixels.len()];
    let mut horizontal = vec![[0.0; 3]; pixels.len()];
    let mut retained = vec![[0.0; 3]; pixels.len()];
    for (level, factor) in NOISE_FACTORS.iter().enumerate() {
        blur(
            &current,
            &mut horizontal,
            &mut next,
            width,
            height,
            1 << level,
        );
        for i in 0..pixels.len() {
            for c in 0..3 {
                let detail = current[i][c] - next[i][c];
                let magnitude = (detail.abs() - thresholds[c] * factor).max(0.0);
                retained[i][c] += if detail < 0.0 { -magnitude } else { magnitude };
            }
        }
        std::mem::swap(&mut current, &mut next);
    }
    for i in 0..pixels.len() {
        let y = retained[i][0] + current[i][0];
        let u = retained[i][1] + current[i][1];
        let v = retained[i][2] + current[i][2];
        let g = y - 0.25 * u - 0.25 * v;
        let rgb = [g+u,g,g+v];
        for c in 0..3 {
            horizontal[i][c] = rgb[c].signum()*(rgb[c]*rgb[c]).min(f32::MAX);
        }
    }
    horizontal
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn active_denoising_preserves_constant_signed_gamut() {
        let pixels=vec![[-0.125,1.5,0.000001];9*7];
        let result=denoise(&pixels,9,7,50.0,50.0,[0.01;3]);
        for rgb in result {for c in 0..3 {assert!((rgb[c]-pixels[0][c]).abs()<0.000001);}}
    }

    fn noisy_image(width: usize, height: usize, edge: bool) -> Vec<[f32; 3]> {
        let mut state = 0x12345678u32;
        let mut random = || {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (state as f64 + 1.0) / 4294967297.0
        };
        (0..width * height)
            .map(|i| {
                let base = if edge {
                    if i % width < width / 2 {
                        0.1
                    } else {
                        0.8
                    }
                } else {
                    0.35
                };
                std::array::from_fn(|_| {
                    (base
                        + 0.02
                            * (-2.0 * random().ln()).sqrt()
                            * (2.0 * std::f64::consts::PI * random()).cos())
                        as f32
                })
            })
            .collect()
    }

    fn stats(
        pixels: &[[f32; 3]],
        width: usize,
        x0: usize,
        x1: usize,
        y0: usize,
        y1: usize,
    ) -> (f64, f64) {
        let mut values = Vec::new();
        for y in y0..y1 {
            for x in x0..x1 {
                let p = pixels[y * width + x];
                values.push(0.25 * p[0] as f64 + 0.5 * p[1] as f64 + 0.25 * p[2] as f64);
            }
        }
        let mean = values.iter().sum::<f64>() / values.len() as f64;
        let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;
        (mean, variance)
    }

    #[test]
    fn zero_controls_and_zero_sigma_are_exact_identity() {
        let pixels = [[-0.1, 0.2, 0.3], [0.6, 0.8, 1.2]];
        assert_eq!(denoise(&pixels, 2, 1, 0.0, 0.0, [0.1; 3]), pixels);
        assert_eq!(denoise(&pixels, 2, 1, 100.0, 100.0, [0.0; 3]), pixels);
    }

    #[test]
    fn constant_hdr_field_has_no_noise_or_color_shift() {
        let pixels = vec![[1.6, 0.35, 0.05]; 19 * 17];
        assert_eq!(estimate_noise(&pixels, 19, 17), [0.0; 3]);
        let result = denoise(&pixels, 19, 17, 100.0, 100.0, [0.02, 0.04, 0.04]);
        for p in result {
            for c in 0..3 {
                assert!((p[c] - pixels[0][c]).abs() < 1e-5);
            }
        }
    }

    #[test]
    fn gaussian_noise_variance_falls_without_brightness_shift() {
        let pixels = noisy_image(80, 64, false);
        let sigma = estimate_noise(&pixels, 80, 64);
        assert!(sigma[0] > 0.005 && sigma[0] < 0.015);
        assert!(sigma[1] > 0.01);
        let result = denoise(&pixels, 80, 64, 100.0, 100.0, sigma);
        let before = stats(&pixels, 80, 14, 66, 14, 50);
        let after = stats(&result, 80, 14, 66, 14, 50);
        assert!(
            after.1 < before.1 * 0.25,
            "residual variance ratio {}",
            after.1 / before.1
        );
        assert!((after.0 - before.0).abs() < 0.001);
    }

    #[test]
    fn preserves_strong_edge_location_and_contrast() {
        let pixels = noisy_image(96, 64, true);
        let result = denoise(
            &pixels,
            96,
            64,
            100.0,
            100.0,
            estimate_noise(&pixels, 96, 64),
        );
        let dark = stats(&result, 96, 16, 40, 14, 50);
        let light = stats(&result, 96, 56, 80, 14, 50);
        assert!(light.0 - dark.0 > 0.68);
        assert!(stats(&result, 96, 48, 49, 14, 50).0 - stats(&result, 96, 47, 48, 14, 50).0 > 0.62);
        assert!(dark.1 < stats(&pixels, 96, 16, 40, 14, 50).1 * 0.4);
    }

    #[test]
    fn stripe_interiors_equal_full_image_with_native_halo() {
        let (width, height, top, bottom) = (43, 90, 14, 75);
        let pixels = noisy_image(width, height, true);
        let sigma = [0.015, 0.03, 0.03];
        let full = denoise(&pixels, width, height, 75.0, 95.0, sigma);
        let stripe = denoise(
            &pixels[top * width..bottom * width],
            width,
            bottom - top,
            75.0,
            95.0,
            sigma,
        );
        for y in top + NATIVE_HALO..bottom - NATIVE_HALO {
            for x in 0..width {
                assert_eq!(stripe[(y - top) * width + x], full[y * width + x]);
            }
        }
    }

    #[test]
    fn active_processing_sanitizes_nonfinite_samples() {
        let pixels = [
            [f32::NAN, f32::INFINITY, f32::NEG_INFINITY],
            [0.2, 0.3, 0.5],
        ];
        assert!(denoise(&pixels, 2, 1, 100.0, 100.0, [0.1; 3])
            .iter()
            .flatten()
            .all(|v| v.is_finite()));
        assert!(estimate_noise(&pixels, 2, 1).iter().all(|v| v.is_finite()));
    }

    #[test]
    #[should_panic(expected = "Wavelet input")]
    fn malformed_shape_is_rejected() {
        denoise(&[[0.0; 3]; 2], 3, 1, 100.0, 100.0, [0.1; 3]);
    }

    #[test]
    fn matches_hand_derived_typescript_three_band_fixture() {
        let pixels = [[0.01; 3], [0.81; 3]];
        let result = denoise(&pixels, 2, 1, 100.0, 100.0, [0.1; 3]);
        for c in 0..3 {
            assert!((result[0][c] - 0.053882174118).abs() < 1e-6);
            assert!((result[1][c] - 0.589631491335).abs() < 1e-6);
        }
        let sigma = estimate_noise(&pixels, 2, 1);
        assert!((sigma[0] - 0.370650554626).abs() < 1e-6);
        assert_eq!(sigma[1], 0.0);
        assert_eq!(sigma[2], 0.0);
    }
}
