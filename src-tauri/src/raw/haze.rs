use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct HazeAnalysis {
    pub version: u8,
    pub width: usize,
    pub height: usize,
    pub atmosphere: [f32; 3],
    /// Interleaved mean-a, mean-b, row-major with the top row first.
    pub coefficients: Vec<f32>,
}

fn luminance(rgb: [f64; 3]) -> f64 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

/// Independent dark-channel / fast-guided-filter math, matching engine/hazeAnalysis.ts.
/// Call only with a bounded overview of the complete uncropped base-tone image.
pub fn analyze(pixels: &[[f32; 3]], width: usize, height: usize) -> HazeAnalysis {
    assert!(
        width > 0
            && height > 0
            && width
                .checked_mul(height)
                .is_some_and(|n| n <= 65536 && n == pixels.len()),
        "Haze analysis requires a matching whole-image RGB buffer of at most 65,536 pixels"
    );
    assert!(
        pixels.iter().flatten().all(|v| v.is_finite()),
        "Haze analysis requires finite RGB values"
    );
    let scale = (256.0 / width.max(height) as f64).min(1.0);
    let w = ((width as f64 * scale).round() as usize).max(1);
    let h = ((height as f64 * scale).round() as usize).max(1);
    let mut rgb = Vec::with_capacity(w * h);
    for y in 0..h {
        for x in 0..w {
            let (x0, x1) = (x * width / w, (x + 1) * width / w);
            let (y0, y1) = (y * height / h, (y + 1) * height / h);
            let mut sum = [0.0_f64; 3];
            for yy in y0..y1 {
                for xx in x0..x1 {
                    for c in 0..3 {
                        sum[c] += f64::from(pixels[yy * width + xx][c]).max(0.0);
                    }
                }
            }
            let count = ((x1 - x0) * (y1 - y0)) as f64;
            rgb.push(sum.map(|v| v / count));
        }
    }
    let n = w * h;
    let dark_radius = ((2.0 * w.max(h) as f64 / 256.0).round() as usize).max(1);
    let guided_radius = ((4.0 * w.max(h) as f64 / 256.0).round() as usize).max(1);
    let raw_dark: Vec<f64> = rgb.iter().map(|v| v[0].min(v[1]).min(v[2])).collect();
    let dark = minimum_filter(&raw_dark, w, h, dark_radius);
    let guide: Vec<f64> = rgb.iter().copied().map(luminance).collect();
    let atmosphere = estimate_atmosphere(&rgb, &dark, &raw_dark, &guide);
    if atmosphere == [0.0; 3] {
        return HazeAnalysis {
            version: 1,
            width: w,
            height: h,
            atmosphere: [0.0; 3],
            coefficients: vec![0.0; n * 2],
        };
    }
    let normalized: Vec<f64> = rgb
        .iter()
        .map(|v| {
            (v[0] / atmosphere[0])
                .min(v[1] / atmosphere[1])
                .min(v[2] / atmosphere[2])
        })
        .collect();
    let p = minimum_filter(&normalized, w, h, dark_radius);
    let mean_i = box_mean(&guide, w, h, guided_radius);
    let mean_p = box_mean(&p, w, h, guided_radius);
    let ii: Vec<f64> = guide.iter().map(|v| v * v).collect();
    let ip: Vec<f64> = guide.iter().zip(&p).map(|(v, p)| v * p).collect();
    let mean_ii = box_mean(&ii, w, h, guided_radius);
    let mean_ip = box_mean(&ip, w, h, guided_radius);
    let mut a = vec![0.0; n];
    let mut b = vec![0.0; n];
    for i in 0..n {
        a[i] = (mean_ip[i] - mean_i[i] * mean_p[i])
            / ((mean_ii[i] - mean_i[i] * mean_i[i]).max(0.0) + 0.0001);
        b[i] = mean_p[i] - a[i] * mean_i[i];
    }
    let mean_a = box_mean(&a, w, h, guided_radius);
    let mean_b = box_mean(&b, w, h, guided_radius);
    let mut coefficients = Vec::with_capacity(n * 2);
    for i in 0..n {
        coefficients.push(mean_a[i] as f32);
        coefficients.push(mean_b[i] as f32);
    }
    HazeAnalysis {
        version: 1,
        width: w,
        height: h,
        atmosphere: atmosphere.map(|v| v as f32),
        coefficients,
    }
}

fn estimate_atmosphere(
    rgb: &[[f64; 3]],
    dark: &[f64],
    raw_dark: &[f64],
    guide: &[f64],
) -> [f64; 3] {
    if rgb.iter().all(|v| *v == [0.0; 3]) {
        return [0.0; 3];
    }
    let display_range = rgb.iter().flatten().all(|c| *c <= 1.0001);
    let mut candidates: Vec<usize> = (0..rgb.len())
        .filter(|&i| {
            raw_dark[i] <= dark[i] * 1.25 + 0.02
                && !(display_range && rgb[i].iter().all(|c| *c >= 0.9999))
        })
        .collect();
    if candidates.len() < ((rgb.len() as f64 * 0.05).ceil() as usize).max(1) {
        candidates = (0..rgb.len()).collect();
    }
    candidates.sort_by(|&a, &b| dark[b].total_cmp(&dark[a]).then(a.cmp(&b)));
    candidates.truncate(((candidates.len() as f64 * 0.05).ceil() as usize).max(1));
    candidates.sort_by(|&a, &b| guide[b].total_cmp(&guide[a]).then(a.cmp(&b)));
    candidates.truncate(((candidates.len() as f64 * 0.05).ceil() as usize).max(1));
    let mut sum = [0.0; 3];
    for &i in &candidates {
        for c in 0..3 {
            sum[c] += rgb[i][c];
        }
    }
    sum.map(|v| (v / candidates.len() as f64).max(0.05))
}

fn minimum_filter(input: &[f64], w: usize, h: usize, radius: usize) -> Vec<f64> {
    let mut horizontal = vec![0.0; w * h];
    let mut output = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut value = f64::INFINITY;
            for xx in x.saturating_sub(radius)..=(x + radius).min(w - 1) {
                value = value.min(input[y * w + xx]);
            }
            horizontal[y * w + x] = value;
        }
    }
    for y in 0..h {
        for x in 0..w {
            let mut value = f64::INFINITY;
            for yy in y.saturating_sub(radius)..=(y + radius).min(h - 1) {
                value = value.min(horizontal[yy * w + x]);
            }
            output[y * w + x] = value;
        }
    }
    output
}

fn box_mean(input: &[f64], w: usize, h: usize, radius: usize) -> Vec<f64> {
    let stride = w + 1;
    let mut integral = vec![0.0; stride * (h + 1)];
    let mut output = vec![0.0; w * h];
    for y in 0..h {
        let mut row = 0.0;
        for x in 0..w {
            row += input[y * w + x];
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
        }
    }
    for y in 0..h {
        for x in 0..w {
            let (x0, x1) = (x.saturating_sub(radius), (x + radius + 1).min(w));
            let (y0, y1) = (y.saturating_sub(radius), (y + radius + 1).min(h));
            output[y * w + x] = (integral[y1 * stride + x1]
                - integral[y0 * stride + x1]
                - integral[y1 * stride + x0]
                + integral[y0 * stride + x0])
                / ((x1 - x0) * (y1 - y0)) as f64;
        }
    }
    output
}

/// Source-normalized coordinates, top left origin, using GL clamp-to-edge bilinear samples.
pub fn apply(rgb: [f32; 3], analysis: &HazeAnalysis, x: f32, y: f32, amount: f32) -> [f32; 3] {
    if amount == 0.0 {
        return rgb;
    }
    let strength = (amount / 100.0).clamp(-1.0, 1.0);
    if strength < 0.0 {
        return std::array::from_fn(|c| {
            rgb[c] + (analysis.atmosphere[c] - rgb[c]) * -strength * 0.26
        });
    }
    let xx = (x * analysis.width as f32 - 0.5).clamp(0.0, (analysis.width - 1) as f32);
    let yy = (y * analysis.height as f32 - 0.5).clamp(0.0, (analysis.height - 1) as f32);
    let (x0, y0) = (xx.floor() as usize, yy.floor() as usize);
    let (x1, y1) = (
        (x0 + 1).min(analysis.width - 1),
        (y0 + 1).min(analysis.height - 1),
    );
    let (fx, fy) = (xx - x0 as f32, yy - y0 as f32);
    let sample = |c: usize| {
        let at = |x: usize, y: usize| analysis.coefficients[(y * analysis.width + x) * 2 + c];
        (at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx) * (1.0 - fy)
            + (at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx) * fy
    };
    let y_rgb = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    let haze = (sample(0) * y_rgb + sample(1)).clamp(0.0, 1.0);
    let transmission = (1.0 - 0.9 * strength * haze).max(0.15);
    std::array::from_fn(|c| {
        analysis.atmosphere[c] + (rgb[c] - analysis.atmosphere[c]) / transmission
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const FOG: [f32; 3] = [0.64, 0.78, 0.9];
    fn fixture(
        width: usize,
        height: usize,
        at: impl Fn(usize, usize) -> [f32; 3],
    ) -> Vec<[f32; 3]> {
        (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, y)| at(x, y))
            .collect()
    }
    fn mix(truth: [f32; 3], t: f32) -> [f32; 3] {
        std::array::from_fn(|c| truth[c] * t + FOG[c] * (1.0 - t))
    }
    fn error(a: [f32; 3], b: [f32; 3]) -> f32 {
        (0..3).map(|c| (a[c] - b[c]).powi(2)).sum()
    }
    fn close(actual: [f32; 3], expected: [f32; 3]) {
        for c in 0..3 {
            assert!(
                (actual[c] - expected[c]).abs() < 0.00001,
                "channel {c}: {} != {}",
                actual[c],
                expected[c]
            );
        }
    }
    #[test]
    fn colored_airlight_ignores_clipped_background_and_sparse_bright_point() {
        let pixels = fixture(64, 64, |x, y| {
            if x > 55 {
                [1.0; 3]
            } else if x == 20 && y == 20 {
                [0.99; 3]
            } else if y < 12 {
                FOG
            } else {
                mix([0.06, 0.18, 0.02], 0.6)
            }
        });
        close(analyze(&pixels, 64, 64).atmosphere, FOG);
    }
    #[test]
    fn restoration_improves_scene_rgb_and_preserves_clear_dark_foreground() {
        let truth = [0.06, 0.18, 0.02];
        let pixels = fixture(64, 64, |x, y| {
            if y < 12 {
                FOG
            } else if x < 12 {
                [0.0, 0.02, 0.01]
            } else {
                mix(truth, 0.6)
            }
        });
        let analysis = analyze(&pixels, 64, 64);
        let input = mix(truth, 0.6);
        assert!(
            error(apply(input, &analysis, 0.65, 0.65, 100.0), truth) < error(input, truth) * 0.1
        );
        close(
            apply([0.0, 0.02, 0.01], &analysis, 0.05, 0.8, 100.0),
            [0.0, 0.02, 0.01],
        );
    }
    #[test]
    fn negative_adds_measured_atmosphere_and_zero_is_exact_identity() {
        let analysis = analyze(&vec![FOG; 64], 8, 8);
        let rgb = [0.1, 0.2, 0.3];
        assert_eq!(apply(rgb, &analysis, 0.1, 0.9, 0.0), rgb);
        close(
            apply(rgb, &analysis, 0.1, 0.9, -100.0),
            [0.2404, 0.3508, 0.456],
        );
    }
    #[test]
    fn asymmetric_top_origin_profile_uses_clamped_gl_bilinear_coordinates() {
        let analysis = HazeAnalysis {
            version: 1,
            width: 2,
            height: 2,
            atmosphere: [1.0; 3],
            coefficients: vec![0.0, 0.0, 0.0, 0.2, 0.0, 0.4, 0.0, 0.8],
        };
        assert_eq!(apply([0.5; 3], &analysis, 0.25, 0.25, 100.0), [0.5; 3]);
        close(
            apply([0.5; 3], &analysis, 0.5, 0.5, 100.0),
            [0.2700729927; 3],
        );
        close(apply([0.5; 3], &analysis, -1.0, 2.0, 100.0), [0.21875; 3]);
        close(
            apply([0.5; 3], &analysis, 0.75, 0.25, 100.0),
            [0.3902439024; 3],
        );
    }
    #[test]
    fn guided_coefficients_match_independent_two_pass_reference() {
        let analysis = analyze(&[[0.5; 3], [0.6; 3], [0.7; 3]], 3, 1);
        let expected = [
            0.3518648839,
            0.5269763078,
            0.6924520471,
            0.3156032528,
            1.0386780707,
            0.1162620221,
        ];
        for (actual, expected) in analysis.coefficients.iter().zip(expected) {
            assert!((actual - expected).abs() < 0.00001);
        }
    }
    #[test]
    fn hdr_airlight_and_reconstruction_are_not_clipped() {
        let analysis = analyze(&vec![[1.4, 1.6, 2.0]; 128], 16, 8);
        close(analysis.atmosphere, [1.4, 1.6, 2.0]);
        assert!(apply([3.0; 3], &analysis, 0.5, 0.5, 100.0)[0] > 3.0);
    }
    #[test]
    fn all_black_is_finite_and_identity_in_both_directions() {
        let analysis = analyze(&[[0.0; 3]; 4], 2, 2);
        assert!(analysis.coefficients.iter().all(|v| v.is_finite()));
        for amount in [-100.0, 0.0, 100.0] {
            assert_eq!(apply([0.0; 3], &analysis, 0.5, 0.5, amount), [0.0; 3]);
        }
    }
    #[test]
    fn coarse_grid_is_bounded_and_uniform_atmosphere_is_unchanged() {
        let analysis = analyze(&vec![FOG; 512 * 128], 512, 128);
        assert_eq!((analysis.width, analysis.height), (256, 64));
        assert_eq!(analysis.coefficients.len(), 256 * 64 * 2);
        close(analysis.atmosphere, FOG);
    }
    #[test]
    #[should_panic(expected = "matching whole-image")]
    fn rejects_mismatched_dimensions() {
        analyze(&[[0.0; 3]], 2, 2);
    }
    #[test]
    #[should_panic(expected = "finite RGB")]
    fn rejects_nonfinite_input() {
        analyze(&[[f32::NAN; 3]], 1, 1);
    }
}
