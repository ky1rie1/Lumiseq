// src-tauri/src/raw/types.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PixelFormat {
    RGBA8,
    RGBA16,
    RGBA16F,
    RGBA32F,
    RawMosaic16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DemosaicQuality {
    Fast,     // e.g. Bilinear / Quick demosaic for responsive preview
    Balanced, // e.g. AHD / VNG for regular view
    High,     // e.g. Highest quality for full export
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HighlightStrategy {
    Clip,
    Blend,
    Reconstruct,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawMetadata {
    #[serde(default = "legacy_processing_version")]
    pub processing_version: u8,
    #[serde(default)]
    pub optical_correction: Option<RawOpticalCorrection>,
    pub camera_make: String,
    pub camera_model: String,
    pub lens_model: Option<String>,
    pub iso: Option<u32>,
    pub shutter_speed: Option<String>,
    pub aperture: Option<String>,
    pub focal_length: Option<String>,
    pub capture_time: Option<String>,
    pub width: usize,
    pub height: usize,
    pub orientation: u32, // EXIF Orientation 1-8
    pub white_balance_multipliers: [f32; 4], // Camera As-Shot multipliers [r, g1, b, g2]
    pub daylight_multipliers: Option<[f32; 4]>,
    // First 3 columns of LibRaw rgb_cam: camera RGB -> linear sRGB. Informational;
    // already applied to decoded pixels, never an unapplied camera -> XYZ matrix.
    pub color_matrix: Vec<Vec<f32>>,
    pub black_levels: [u16; 4],
    pub white_levels: [u16; 4],
    pub cfa_pattern: String, // e.g. "RGGB", "BGGR"
    pub bits_per_sample: u32,
    pub has_embedded_preview: bool,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
}

fn legacy_processing_version()->u8 {1}

#[derive(Debug,Clone,Copy,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum RawCorrectionMode {
    #[default]
    Camera,
    Uncorrected,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct RawOpticalCorrection {
    pub mode:RawCorrectionMode,
    pub provenance:String,
    pub source_width:usize,
    pub source_height:usize,
    pub active_crop:[usize;4],
    pub distortion_applied:bool,
    pub aberration_applied:bool,
    pub shading_applied:bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RawError {
    UnsupportedCamera(String),
    CorruptFile(String),
    PermissionDenied(String),
    DecodeFailed(String),
    OutOfMemory,
    Cancelled,
    Unknown(String),
}

impl std::fmt::Display for RawError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RawError::UnsupportedCamera(msg) => write!(f, "Unsupported camera: {}", msg),
            RawError::CorruptFile(msg) => write!(f, "Corrupted RAW file: {}", msg),
            RawError::PermissionDenied(msg) => write!(f, "Permission denied: {}", msg),
            RawError::DecodeFailed(msg) => write!(f, "Decode failed: {}", msg),
            RawError::OutOfMemory => write!(f, "Out of memory during RAW decode"),
            RawError::Cancelled => write!(f, "RAW decode cancelled"),
            RawError::Unknown(msg) => write!(f, "Unknown error: {}", msg),
        }
    }
}

impl std::error::Error for RawError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawDecodeResult {
    pub asset_id: String,
    pub width: usize,
    pub height: usize,
    pub pixel_format: PixelFormat,
    pub metadata: RawMetadata,
    pub preview_png_bytes: Option<Vec<u8>>,
}
