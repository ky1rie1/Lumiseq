//! Version 2 brightness detail. Complete Gaussian and self-guided averaging.
use super::spatial::SpatialSettings;
fn luma(v: [f32; 3]) -> f32 {
    0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
fn encode(v: f32) -> f32 {
    v.signum() * (16.0 * v.abs()).ln_1p() / 16.0
}
fn decode(v: f32) -> f32 {
    v.signum() * (16.0 * v.abs()).exp_m1() / 16.0
}
fn smooth(a: f32, b: f32, v: f32) -> f32 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn gaussian(input: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    let sigma = sigma.max(0.35);
    let r = (3.0 * sigma).ceil() as isize;
    let mut kernel: Vec<f32> = (-r..=r)
        .map(|i| (-0.5 * (i as f32 / sigma).powi(2)).exp())
        .collect();
    let sum: f32 = kernel.iter().sum();
    for k in &mut kernel {
        *k /= sum;
    }
    let mut temp = vec![0.0; input.len()];
    let mut out = vec![0.0; input.len()];
    for y in 0..h {
        for x in 0..w {
            let mut sum=0.0f64;
            for k in -r..=r {
                sum += input[y * w + (x as isize + k).clamp(0, w as isize - 1) as usize] as f64
                    * kernel[(k + r) as usize] as f64;
            }
            temp[y*w+x]=sum as f32;
        }
    }
    for y in 0..h {
        for x in 0..w {
            let mut sum=0.0f64;
            for k in -r..=r {
                sum += temp[(y as isize + k).clamp(0, h as isize - 1) as usize * w + x] as f64
                    * kernel[(k + r) as usize] as f64;
            }
            out[y*w+x]=sum as f32;
        }
    }
    out
}
pub fn apply_image(pixels: &[[f32; 3]], w: usize, h: usize, s: SpatialSettings) -> Vec<[f32; 3]> {
    let mut output = pixels.to_vec();
    for (amount, sigma, guided, threshold) in [
        (s.texture / 100.0 * 1.2, s.scale, true, 0.0),
        (s.clarity / 100.0 * 0.85, 4.0 * s.scale, true, 0.0),
        (
            s.sharpen_amount / 100.0,
            s.sharpen_radius.max(0.5) * s.scale,
            false,
            s.sharpen_threshold / 255.0,
        ),
    ] {
        if amount == 0.0 {
            continue;
        }
        let p: Vec<f32> = output.iter().map(|v| encode(luma(*v))).collect();
        let mean = gaussian(&p, w, h, sigma);
        let low = if guided {
            let sq = gaussian(&p.iter().map(|v| v * v).collect::<Vec<_>>(), w, h, sigma);
            let mut a = vec![0.0; p.len()];
            let mut b = vec![0.0; p.len()];
            for i in 0..p.len() {
                let var = (sq[i] - mean[i] * mean[i]).max(0.0);
                a[i] = var / (var + 0.0004);
                b[i] = (1.0 - a[i]) * mean[i];
            }
            let ma = gaussian(&a, w, h, sigma);
            let mb = gaussian(&b, w, h, sigma);
            (0..p.len())
                .map(|i| ma[i] * p[i] + mb[i])
                .collect::<Vec<_>>()
        } else {
            mean.clone()
        };
        for i in 0..p.len() {
            let y = luma(output[i]);
            let diff = p[i] - low[i];
            let noise = smooth(0.0002, 0.002, diff.abs());
            let tw = if threshold > 0.0 {
                smooth(threshold * 0.5, threshold * 1.5 + 1e-6, diff.abs())
            } else {
                1.0
            };
            let ratio = p[i].abs() / (mean[i].abs() + 0.0001);
            let point = 1.0 - 0.85 * smooth(1.5, 3.0, ratio);
            let target = decode(p[i] + diff * amount * noise * tw * point);
            let enhancement_limit = if amount > 0.0 {
                if (target - y) * y < 0.0 {
                    0.02
                } else {
                    0.35 - 0.33 * smooth(1.3, 1.6, ratio)
                }
            } else {
                0.35
            };
            let limit = 0.0002 + enhancement_limit * y.abs();
            let delta = (target - y).clamp(-limit, limit);
            let gain = if y.abs() > 1e-12 {
                1.0 + delta / y * smooth(0.0, 1e-5, y.abs())
            } else {
                1.0
            };
            for c in &mut output[i] {
                *c *= gain;
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    fn settings() -> SpatialSettings {
        SpatialSettings {
            texture: 50.0,
            clarity: 40.0,
            sharpen_amount: 80.0,
            sharpen_radius: 1.8,
            sharpen_threshold: 0.0,
            scale: 1.0,
        }
    }
    #[test]
    fn signed_hdr_flat_field_and_rotated_points_preserve_shape() {
        let n = 41;
        let s = settings();
        let flat = vec![[-0.2, 0.4, 3.5]; n * n];
        let out = apply_image(&flat, n, n, s);
        assert!(out
            .iter()
            .zip(&flat)
            .all(|(a, b)| a.iter().zip(b).all(|(a, b)| (a - b).abs() < 2e-6)));
        let source: Vec<_> = (0..n * n)
            .map(|i| {
                let x = (i % n) as f32 - 15.25;
                let y = (i / n) as f32 - 21.5;
                let v = 0.002 + 2.0 * (-(x * x + y * y) / 3.0).exp();
                [-0.07 + v, v, 1.4 + v]
            })
            .collect();
        let rotate = |a: &[[f32; 3]]| {
            let mut b = vec![[0.0; 3]; a.len()];
            for y in 0..n {
                for x in 0..n {
                    b[x * n + n - 1 - y] = a[y * n + x];
                }
            }
            b
        };
        let rotated = rotate(&apply_image(&source, n, n, s));
        let independently = apply_image(&rotate(&source), n, n, s);
        let maximum=rotated.iter().zip(&independently).flat_map(|(a,b)|a.iter().zip(b).map(|(a,b)|(a-b).abs())).fold(0.0,f32::max);
        assert!(maximum<2e-6,"rotation error {maximum}");
    }
    #[test]
    fn finite_support_stripes_equal_full_image_at_all_boundaries() {
        let (w, h) = (47, 300);
        let s = settings();
        let halo = s.halo_v2();
        let source: Vec<_> = (0..w * h)
            .map(|i| {
                let v = 0.003 + ((i * 13 % 97) as f32) / 200.0;
                [v, -0.05 + v, 1.5 + v]
            })
            .collect();
        let full = apply_image(&source, w, h, s);
        for start in (0..h).step_by(128) {
            let end = (start + 128).min(h);
            let top = start.saturating_sub(halo);
            let bottom = (end + halo).min(h);
            let stripe = apply_image(&source[top * w..bottom * w], w, bottom - top, s);
            for y in start..end {
                for x in 0..w {
                    for c in 0..3 {
                        assert!(
                            (stripe[(y - top) * w + x][c] - full[y * w + x][c]).abs() < 1e-6,
                            "boundary y={y}"
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn moderate_point_enhancement_bounds_added_dark_halos() {
        let n = 41;
        let source: Vec<_> = (0..n * n)
            .map(|i| {
                let x = i % n;
                let y = i / n;
                let v = 0.002
                    + 0.8
                        * (-(((x as f32 - 20.0).powi(2) + (y as f32 - 20.0).powi(2)) / 2.0)).exp();
                [v; 3]
            })
            .collect();
        let out = apply_image(&source, n, n, settings());
        let minimum = out
            .iter()
            .zip(&source)
            .map(|(a, b)| a[0] - b[0])
            .fold(0.0, f32::min);
        assert!(minimum > -0.001);
    }
    #[test]
    fn ordinary_edges_and_negative_texture_retain_effective_control_strength() {
        let mut s = settings();
        s.texture = 0.0;
        s.clarity = 0.0;
        s.sharpen_amount = 100.0;
        s.sharpen_radius = 1.0;
        let source: Vec<_> = (0..41)
            .map(|x| if x < 20 { [0.1; 3] } else { [0.4; 3] })
            .collect();
        let out = apply_image(&source, 41, 1, s);
        assert!(out[20][0] - 0.4 > 0.045);
        s.sharpen_amount = 0.0;
        s.texture = -100.0;
        let source: Vec<_> = (0..41 * 41)
            .map(|i| if i % 2 == 0 { [0.04; 3] } else { [0.02; 3] })
            .collect();
        let out = apply_image(&source, 41, 41, s);
        assert!((out[20 * 41 + 20][0] - out[20 * 41 + 21][0]).abs() < 0.012);
    }
}
