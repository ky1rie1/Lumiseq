// src-tauri/src/raw/ffi/bindings.rs
//! Low-level C FFI declarations for LibRaw native wrapper.

use std::os::raw::{c_char, c_int};

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct LibRawMetaResult {
    pub make: [c_char; 64],
    pub model: [c_char; 64],
    pub width: u32,
    pub height: u32,
    pub raw_width: u32,
    pub raw_height: u32,
    pub flip: u32,
    pub colors: u32,
    pub bits_per_sample: u32,
    pub cam_mul: [f32; 4],
    pub pre_mul: [f32; 4],
    pub cmatrix: [[f32; 4]; 3],
    pub rgb_cam: [[f32; 4]; 3],
    pub black_levels: [u32; 4],
    pub white_level: u32,
    pub has_thumb: c_int,
    pub thumb_width: u32,
    pub thumb_height: u32,
    pub error_code: c_int,
}

#[repr(C)]
pub struct LibRawDecodedImage {
    pub width: u32,
    pub height: u32,
    pub channels: u32,
    pub bits_per_channel: u32,
    pub data_size: usize,
    pub data: *mut u8,
    pub error_code: c_int,
}

#[repr(C)]
pub struct LibRawThumbResult {
    pub data_size: usize,
    pub data: *mut u8,
    pub is_jpeg: c_int,
    pub error_code: c_int,
}

extern "C" {
    pub fn libraw_wrapper_get_metadata(
        file_path: *const c_char,
        out_meta: *mut LibRawMetaResult,
    ) -> c_int;

    pub fn libraw_wrapper_extract_thumbnail(
        file_path: *const c_char,
        out_thumb: *mut LibRawThumbResult,
    ) -> c_int;

    pub fn libraw_wrapper_free_thumb(thumb: *mut LibRawThumbResult);

    pub fn libraw_wrapper_decode_16bit(
        file_path: *const c_char,
        demosaic_quality: c_int,
        out_image: *mut LibRawDecodedImage,
    ) -> c_int;

    pub fn libraw_wrapper_free_image(image: *mut LibRawDecodedImage);
}
