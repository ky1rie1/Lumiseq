// src-tauri/src/color/transform.rs

/// Linear to standard sRGB transfer function (IEC 61966-2-1)
#[inline]
pub fn linear_to_srgb(c: f32) -> f32 {
    let clamped = c.max(0.0);
    if clamped <= 0.0031308 {
        clamped * 12.92
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    }
}

/// Standard sRGB to linear transfer function
#[inline]
pub fn srgb_to_linear(c: f32) -> f32 {
    let clamped = c.max(0.0);
    if clamped <= 0.04045 {
        clamped / 12.92
    } else {
        ((clamped + 0.055) / 1.055).powf(2.4)
    }
}

/// 3x3 matrix multiplication on 3D color vector [r, g, b]
#[inline]
pub fn apply_matrix3x3(mat: &[[f32; 3]; 3], rgb: [f32; 3]) -> [f32; 3] {
    [
        mat[0][0] * rgb[0] + mat[0][1] * rgb[1] + mat[0][2] * rgb[2],
        mat[1][0] * rgb[0] + mat[1][1] * rgb[1] + mat[1][2] * rgb[2],
        mat[2][0] * rgb[0] + mat[2][1] * rgb[1] + mat[2][2] * rgb[2],
    ]
}
