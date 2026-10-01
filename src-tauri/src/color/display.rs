// src-tauri/src/color/display.rs
use crate::color::transform::linear_to_srgb;

pub struct ColorPipeline;

impl ColorPipeline {
    /// Converts a 16-bit linear RGB buffer to standard 8-bit sRGB for display / preview
    pub fn linear16_to_srgb8(linear16_buffer: &[u8], width: usize, height: usize) -> Vec<u8> {
        let pixel_count = width * height;
        let mut srgb8 = vec![0u8; pixel_count * 4];

        for i in 0..pixel_count {
            let byte_idx = i * 8;
            if byte_idx + 7 < linear16_buffer.len() {
                let r16 = u16::from_le_bytes([linear16_buffer[byte_idx], linear16_buffer[byte_idx + 1]]);
                let g16 = u16::from_le_bytes([linear16_buffer[byte_idx + 2], linear16_buffer[byte_idx + 3]]);
                let b16 = u16::from_le_bytes([linear16_buffer[byte_idx + 4], linear16_buffer[byte_idx + 5]]);
                let a16 = u16::from_le_bytes([linear16_buffer[byte_idx + 6], linear16_buffer[byte_idx + 7]]);

                let r_lin = r16 as f32 / 65535.0;
                let g_lin = g16 as f32 / 65535.0;
                let b_lin = b16 as f32 / 65535.0;

                let r_disp = (linear_to_srgb(r_lin) * 255.0).min(255.0).max(0.0) as u8;
                let g_disp = (linear_to_srgb(g_lin) * 255.0).min(255.0).max(0.0) as u8;
                let b_disp = (linear_to_srgb(b_lin) * 255.0).min(255.0).max(0.0) as u8;
                let a_disp = (a16 as f32 / 257.0).min(255.0).max(0.0) as u8;

                let out_idx = i * 4;
                srgb8[out_idx] = r_disp;
                srgb8[out_idx + 1] = g_disp;
                srgb8[out_idx + 2] = b_disp;
                srgb8[out_idx + 3] = a_disp;
            }
        }

        srgb8
    }
}
