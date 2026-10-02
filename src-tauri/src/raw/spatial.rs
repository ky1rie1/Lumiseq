//! Full-resolution counterpart of the current WebGL spatial pass.
//! Inputs are base-tone linear RGB pixels in a stripe with a source-pixel halo.

#[derive(Clone, Copy)]
pub struct SpatialSettings {
    pub texture: f32,
    pub clarity: f32,
    pub sharpen_amount: f32,
    pub sharpen_radius: f32,
    pub sharpen_threshold: f32,
    pub scale: f32,
}

impl SpatialSettings {
    pub fn active(self) -> bool {
        self.texture != 0.0 || self.clarity != 0.0 || self.sharpen_amount != 0.0
    }

    pub fn halo(self) -> usize {
        if !self.active() {
            return 0;
        }
        let mut radius: f32 = 0.0;
        if self.texture != 0.0 {
            radius = radius.max(1.0);
        }
        if self.clarity != 0.0 {
            radius = radius.max(8.0);
        }
        if self.sharpen_amount != 0.0 {
            radius = radius.max(self.sharpen_radius.max(0.5));
        }
        (radius * self.scale).ceil() as usize + 1
    }
}

struct Stripe<'a> {
    pixels: &'a [[f32; 3]],
    width: usize,
    height: usize,
    top: usize,
}

impl Stripe<'_> {
    fn pixel(&self, x: usize, y: usize) -> [f32; 3] {
        self.pixels[(y - self.top) * self.width + x]
    }

    fn sample(&self, x: f32, y: f32) -> [f32; 3] {
        let x = x.clamp(0.0, (self.width - 1) as f32);
        let y = y.clamp(0.0, (self.height - 1) as f32);
        let x0 = x.floor() as usize;
        let y0 = y.floor() as usize;
        let x1 = (x0 + 1).min(self.width - 1);
        let y1 = (y0 + 1).min(self.height - 1);
        let fx = x - x0 as f32;
        let fy = y - y0 as f32;
        let a = self.pixel(x0, y0);
        let b = self.pixel(x1, y0);
        let c = self.pixel(x0, y1);
        let d = self.pixel(x1, y1);
        std::array::from_fn(|i| {
            (a[i] * (1.0 - fx) + b[i] * fx) * (1.0 - fy) + (c[i] * (1.0 - fx) + d[i] * fx) * fy
        })
    }

    fn blur(&self, x: f32, y: f32, radius: f32) -> [f32; 3] {
        let mut sum = self.sample(x, y).map(|v| v * 0.25);
        for (dx, dy, weight) in [
            (radius, 0.0, 0.15),
            (-radius, 0.0, 0.15),
            (0.0, radius, 0.15),
            (0.0, -radius, 0.15),
            (radius, radius, 0.0375),
            (-radius, radius, 0.0375),
            (radius, -radius, 0.0375),
            (-radius, -radius, 0.0375),
        ] {
            let sample = self.sample(x + dx, y + dy);
            for i in 0..3 {
                sum[i] += sample[i] * weight;
            }
        }
        sum
    }

    fn wide_blur(&self, x: f32, y: f32, scale: f32) -> [f32; 3] {
        let mut sum = self.sample(x, y).map(|v| v * 0.20);
        for (dx, dy, weight) in [
            (4.0, 0.0, 0.15),
            (-4.0, 0.0, 0.15),
            (0.0, 4.0, 0.15),
            (0.0, -4.0, 0.15),
            (8.0, 0.0, 0.05),
            (-8.0, 0.0, 0.05),
            (0.0, 8.0, 0.05),
            (0.0, -8.0, 0.05),
        ] {
            let sample = self.sample(x + dx * scale, y + dy * scale);
            for i in 0..3 {
                sum[i] += sample[i] * weight;
            }
        }
        sum
    }
}

pub fn apply(
    pixels: &[[f32; 3]],
    width: usize,
    height: usize,
    top: usize,
    x: usize,
    y: usize,
    settings: SpatialSettings,
) -> [f32; 3] {
    let stripe = Stripe {
        pixels,
        width,
        height,
        top,
    };
    let mut color = stripe.pixel(x, y);
    if !settings.active() {
        return color;
    }
    let x = x as f32;
    let y = y as f32;

    if settings.texture != 0.0 {
        let fine = stripe.blur(x, y, settings.scale);
        let weight = settings.texture / 100.0 * 1.2;
        for i in 0..3 {
            color[i] += (color[i] - fine[i]) * weight;
        }
    }
    if settings.clarity != 0.0 {
        let middle = stripe.wide_blur(x, y, settings.scale);
        let weight = settings.clarity / 100.0 * 0.85;
        for i in 0..3 {
            color[i] += (color[i] - middle[i]) * weight;
        }
    }
    if settings.sharpen_amount > 0.0 {
        let blurred = stripe.blur(x, y, settings.sharpen_radius.max(0.5) * settings.scale);
        let diff = [
            color[0] - blurred[0],
            color[1] - blurred[1],
            color[2] - blurred[2],
        ];
        let magnitude = (diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]).sqrt();
        if magnitude > settings.sharpen_threshold / 255.0 {
            for i in 0..3 {
                color[i] += diff[i] * settings.sharpen_amount / 100.0;
            }
        }
    }
    color
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> SpatialSettings {
        SpatialSettings {
            texture: 0.0,
            clarity: 0.0,
            sharpen_amount: 0.0,
            sharpen_radius: 1.0,
            sharpen_threshold: 0.0,
            scale: 1.0,
        }
    }

    #[test]
    fn sharpening_matches_hand_computed_linear_edge() {
        let source = [[0.25; 3], [0.25; 3], [0.7; 3], [0.7; 3], [0.7; 3]];
        let output = apply(
            &source,
            5,
            1,
            0,
            2,
            0,
            SpatialSettings {
                sharpen_amount: 100.0,
                ..settings()
            },
        );
        // 55% center-column weight, 22.5% left and right. Blur = .59875.
        for value in output {
            assert!((value - 0.80125).abs() < 0.000001);
        }
    }

    #[test]
    fn stripe_halo_matches_full_image_at_every_boundary() {
        let width: usize = 19;
        let height: usize = 277;
        let source: Vec<[f32; 3]> = (0..width * height)
            .map(|i| {
                [
                    ((i * 17 % 97) as f32 / 200.0),
                    ((i * 29 % 83) as f32 / 150.0),
                    0.4,
                ]
            })
            .collect();
        let params = SpatialSettings {
            texture: 35.0,
            clarity: 60.0,
            sharpen_amount: 40.0,
            scale: 3.7,
            ..settings()
        };
        let halo = params.halo();
        for start in (0..height).step_by(128) {
            let end = (start + 128).min(height);
            let top = start.saturating_sub(halo);
            let bottom = (end + halo).min(height);
            let stripe = &source[top * width..bottom * width];
            for y in start..end {
                for x in 0..width {
                    assert_eq!(
                        apply(stripe, width, height, top, x, y, params),
                        apply(&source, width, height, 0, x, y, params)
                    );
                }
            }
        }
    }

    #[test]
    fn flat_field_is_preserved_and_threshold_protects_edges() {
        let source = vec![[0.3; 3]; 25];
        let params = SpatialSettings {
            texture: 80.0,
            clarity: 80.0,
            sharpen_amount: 100.0,
            ..settings()
        };
        for y in 0..5 {
            for x in 0..5 {
                let output = apply(&source, 5, 5, 0, x, y, params);
                for value in output {
                    assert!((value - 0.3).abs() < 0.000001);
                }
            }
        }
        let edge = [[0.5; 3], [0.505; 3], [0.5; 3]];
        let output = apply(
            &edge,
            3,
            1,
            0,
            1,
            0,
            SpatialSettings {
                sharpen_amount: 100.0,
                sharpen_threshold: 25.0,
                ..settings()
            },
        );
        assert_eq!(output, edge[1]);
    }
}
