// src-tauri/src/raw/metadata.rs
use crate::raw::ffi::SafeRawDecoder;
use crate::raw::types::{RawError, RawMetadata};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// High-level entry point: reads metadata using LibRaw native engine and EXIF parser
pub fn read_metadata(file_path: &str) -> Result<RawMetadata, RawError> {
    let decoder = SafeRawDecoder::new(file_path);
    decoder.get_metadata()
}

/// Baseline EXIF parser via kamadak-exif for photography EXIF tags
pub fn read_metadata_exif_base(file_path: &str) -> Result<RawMetadata, RawError> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(RawError::CorruptFile(format!("File does not exist: {}", file_path)));
    }

    let file = File::open(path).map_err(|e| RawError::PermissionDenied(e.to_string()))?;
    let mut reader = BufReader::new(file);

    let mut camera_make = "Unknown".to_string();
    let mut camera_model = "Unknown".to_string();
    let mut lens_model: Option<String> = None;
    let mut iso: Option<u32> = None;
    let mut shutter_speed: Option<String> = None;
    let mut aperture: Option<String> = None;
    let mut focal_length: Option<String> = None;
    let mut capture_time: Option<String> = None;
    let mut orientation: u32 = 1; // Normal default
    let mut width: usize = 0;
    let mut height: usize = 0;
    let wb_multipliers = [1.0f32, 1.0f32, 1.0f32, 1.0f32];
    let color_matrix: Vec<Vec<f32>> = vec![
        vec![1.0, 0.0, 0.0],
        vec![0.0, 1.0, 0.0],
        vec![0.0, 0.0, 1.0],
    ];
    let black_levels = [0u16, 0u16, 0u16, 0u16];
    let white_levels = [16383u16, 16383u16, 16383u16, 16383u16]; // 14-bit default
    let cfa_pattern = "RGGB".to_string();
    let bits_per_sample = 14u32;
    let gps_latitude: Option<f64> = None;
    let gps_longitude: Option<f64> = None;

    if let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) {
        if let Some(field) = exif.get_field(exif::Tag::Make, exif::In::PRIMARY) {
            camera_make = field.display_value().to_string().trim_matches('"').to_string();
        }
        if let Some(field) = exif.get_field(exif::Tag::Model, exif::In::PRIMARY) {
            camera_model = field.display_value().to_string().trim_matches('"').to_string();
        }
        if let Some(field) = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
            lens_model = Some(field.display_value().to_string().trim_matches('"').to_string());
        }
        if let Some(field) = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY) {
            if let exif::Value::Short(ref shorts) = field.value {
                if let Some(&first) = shorts.first() {
                    iso = Some(first as u32);
                }
            }
        }
        if let Some(field) = exif.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY) {
            shutter_speed = Some(field.display_value().to_string());
        }
        if let Some(field) = exif.get_field(exif::Tag::FNumber, exif::In::PRIMARY) {
            aperture = Some(format!("f/{}", field.display_value()));
        }
        if let Some(field) = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY) {
            focal_length = Some(format!("{}mm", field.display_value()));
        }
        if let Some(field) = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
            capture_time = Some(field.display_value().to_string().trim_matches('"').to_string());
        }
        if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
            if let Some(val) = field.value.get_uint(0) {
                orientation = val;
            }
        }
        if let Some(field) = exif.get_field(exif::Tag::PixelXDimension, exif::In::PRIMARY) {
            if let Some(val) = field.value.get_uint(0) {
                width = val as usize;
            }
        }
        if let Some(field) = exif.get_field(exif::Tag::PixelYDimension, exif::In::PRIMARY) {
            if let Some(val) = field.value.get_uint(0) {
                height = val as usize;
            }
        }
    }

    Ok(RawMetadata {
        camera_make,
        camera_model,
        lens_model,
        iso,
        shutter_speed,
        aperture,
        focal_length,
        capture_time,
        width,
        height,
        orientation,
        white_balance_multipliers: wb_multipliers,
        daylight_multipliers: None,
        color_matrix,
        black_levels,
        white_levels,
        cfa_pattern,
        bits_per_sample,
        has_embedded_preview: true,
        gps_latitude,
        gps_longitude,
    })
}
