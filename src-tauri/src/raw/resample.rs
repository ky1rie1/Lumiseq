use super::types::RawError;
use std::collections::VecDeque;
const BUFFER_LIMIT: usize = 128 * 1024 * 1024;
pub struct LinearResampler {
    width: usize,
    height: usize,
    out_width: usize,
    next_input: usize,
    next_output: usize,
    horizontal: Vec<Vec<(usize, f64)>>,
    vertical: Vec<Vec<(usize, f64)>>,
    rows: VecDeque<(usize, Vec<[f32; 3]>)>,
}
fn lanczos(x: f64) -> f64 {
    let x = x.abs();
    if x < 1e-12 {
        1.0
    } else if x >= 3.0 {
        0.0
    } else {
        let p = std::f64::consts::PI * x;
        (p.sin() / p) * ((p / 3.0).sin() / (p / 3.0))
    }
}
fn weights(source: usize, target: usize) -> Result<Vec<Vec<(usize, f64)>>, RawError> {
    if source == target {
        return Ok((0..target).map(|i| vec![(i, 1.0)]).collect());
    }
    let scale = source as f64 / target as f64;
    let filter = scale.max(1.0);
    let radius = 3.0 * filter;
    if (target as f64 * (2.0 * radius + 2.0) * 16.0) > BUFFER_LIMIT as f64 {
        return Err(RawError::OutOfMemory);
    }
    let mut output = Vec::with_capacity(target);
    for i in 0..target {
        let center = (i as f64 + 0.5) * scale - 0.5;
        let start = ((center - radius).ceil() as isize).max(0) as usize;
        let end = ((center + radius).floor() as usize).min(source - 1);
        let mut row: Vec<_> = (start..=end)
            .map(|j| (j, lanczos((j as f64 - center) / filter)))
            .collect();
        let sum: f64 = row.iter().map(|(_, w)| w).sum();
        for (_, w) in &mut row {
            *w /= sum;
        }
        output.push(row);
    }
    Ok(output)
}
impl LinearResampler {
    pub fn new(
        width: usize,
        height: usize,
        out_width: usize,
        out_height: usize,
    ) -> Result<Self, RawError> {
        if [width, height, out_width, out_height].contains(&0)
            || out_width
                .checked_mul(out_height)
                .is_none_or(|n| n > 150_000_000)
        {
            return Err(RawError::DecodeFailed(
                "Invalid linear resampling dimensions".into(),
            ));
        }
        let vertical = weights(height, out_height)?;
        let horizontal = weights(width, out_width)?;
        let max_rows = vertical.iter().map(Vec::len).max().unwrap_or(0);
        let coefficients: usize = horizontal
            .iter()
            .chain(vertical.iter())
            .map(|v| v.capacity() * 16 + 24)
            .sum();
        if max_rows
            .checked_add(2)
            .and_then(|n| n.checked_mul(out_width))
            .and_then(|n| n.checked_mul(12))
            .and_then(|n| n.checked_add(coefficients))
            .is_none_or(|n| n > BUFFER_LIMIT)
        {
            return Err(RawError::OutOfMemory);
        }
        Ok(Self {
            width,
            height,
            out_width,
            next_input: 0,
            next_output: 0,
            horizontal,
            vertical,
            rows: VecDeque::new(),
        })
    }
    #[cfg(test)]
    pub fn push(
        &mut self,
        y: usize,
        input: &[[f32; 3]],
    ) -> Result<Vec<(usize, Vec<[f32; 3]>)>, RawError> {
        let mut output = Vec::new();
        self.push_into(y, input, |y, row| {
            output.push((y, row.to_vec()));
            Ok(())
        })?;
        Ok(output)
    }
    pub fn push_into(
        &mut self,
        y: usize,
        input: &[[f32; 3]],
        mut emit: impl FnMut(usize, &[[f32; 3]]) -> Result<(), RawError>,
    ) -> Result<(), RawError> {
        if y != self.next_input
            || y >= self.height
            || input.len() != self.width
            || input.iter().flatten().any(|v| !v.is_finite())
        {
            return Err(RawError::DecodeFailed(
                "Invalid linear resampling row".into(),
            ));
        }
        self.next_input += 1;
        let row = self
            .horizontal
            .iter()
            .map(|weights| {
                std::array::from_fn(|c| {
                    weights
                        .iter()
                        .map(|(x, w)| input[*x][c] as f64 * w)
                        .sum::<f64>() as f32
                })
            })
            .collect();
        self.rows.push_back((y, row));
        while let Some(taps) = self.vertical.get(self.next_output) {
            if taps.last().is_some_and(|(last, _)| *last > y) {
                break;
            }
            let mut row = vec![[0f32; 3]; self.out_width];
            for x in 0..self.out_width {
                for c in 0..3 {
                    let first = self.rows.front().expect("retained filter rows").0;
                    row[x][c] = taps
                        .iter()
                        .map(|(sy, w)| self.rows[*sy - first].1[x][c] as f64 * w)
                        .sum::<f64>() as f32;
                }
            }
            if row.iter().flatten().any(|v| !v.is_finite()) {
                return Err(RawError::DecodeFailed("Nonfinite resampling output".into()));
            }
            emit(self.next_output, &row)?;
            self.next_output += 1;
        }
        let first_needed = self
            .vertical
            .get(self.next_output)
            .and_then(|t| t.first())
            .map_or(self.height, |(sy, _)| *sy);
        while self.rows.front().is_some_and(|(sy, _)| *sy < first_needed) {
            self.rows.pop_front();
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn resize(input: &[[f32; 3]], w: usize, h: usize, ow: usize, oh: usize) -> Vec<[f32; 3]> {
        let mut r = LinearResampler::new(w, h, ow, oh).unwrap();
        let mut output = Vec::new();
        for y in 0..h {
            for (_, row) in r.push(y, &input[y * w..(y + 1) * w]).unwrap() {
                output.extend(row);
            }
        }
        assert_eq!(output.len(), ow * oh);
        output
    }
    #[test]
    fn black_white_linear_average() {
        assert!((resize(&[[0.0; 3], [1.0; 3]], 2, 1, 1, 1)[0][0] - 0.5).abs() < 1e-6);
    }
    #[test]
    fn signed_hdr_average() {
        assert!((resize(&[[-2.0; 3], [4.0; 3]], 2, 1, 1, 1)[0][0] - 1.0).abs() < 1e-6);
    }
    #[test]
    fn constant_field_and_edge_normalization() {
        for p in resize(&[[2.5, -0.3, 0.4]; 35], 7, 5, 3, 2) {
            for (a, b) in p.into_iter().zip([2.5, -0.3, 0.4]) {
                assert!((a - b).abs() < 1e-6);
            }
        }
    }
    #[test]
    fn identity_exact() {
        let source = [[0.12, -2.3, 4.5], [6.7, 8.9, 0.2]];
        assert_eq!(resize(&source, 2, 1, 2, 1), source);
    }
    #[test]
    fn downsample_antialiases_checkerboard() {
        let input: Vec<_> = (0..64).map(|i| [(i % 2) as f32; 3]).collect();
        let output = resize(&input, 64, 1, 8, 1);
        for p in &output[3..5] {
            assert!((p[0] - 0.5).abs() < 0.002);
        }
    }
}
