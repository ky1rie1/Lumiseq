// src-tauri/src/raw/decoder.rs
use crate::assets::{global_asset_registry, NativeImageAsset};
use crate::color::display::ColorPipeline;
use crate::raw::ffi::SafeRawDecoder;
use crate::raw::types::{DemosaicQuality, RawDecodeResult, RawError};
use std::collections::HashSet;
use std::io::Cursor;
use std::sync::{OnceLock, RwLock};

fn cancelled_jobs() -> &'static RwLock<HashSet<String>> {
    static JOBS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
    JOBS.get_or_init(|| RwLock::new(HashSet::new()))
}

pub struct DecodeJobTracker;

impl DecodeJobTracker {
    pub fn cancel_job(job_id: &str) {
        let mut set = cancelled_jobs().write().unwrap();
        set.insert(job_id.to_string());
    }

    pub fn is_cancelled(job_id: &str) -> bool {
        let set = cancelled_jobs().read().unwrap();
        set.contains(job_id)
    }

    pub fn cleanup_job(job_id: &str) {
        let mut set = cancelled_jobs().write().unwrap();
        set.remove(job_id);
    }
}

pub fn decode_raw(
    job_id: &str,
    file_path: &str,
    quality: DemosaicQuality,
) -> Result<RawDecodeResult, RawError> {
    if DecodeJobTracker::is_cancelled(job_id) {
        DecodeJobTracker::cleanup_job(job_id);
        return Err(RawError::Cancelled);
    }

    // 1. Run safe isolated FFI decode
    let decoder = SafeRawDecoder::new(file_path);
    let (width, height, pixel_format, buffer16, metadata) = decoder.decode(quality)?;

    if DecodeJobTracker::is_cancelled(job_id) {
        DecodeJobTracker::cleanup_job(job_id);
        return Err(RawError::Cancelled);
    }

    // 2. Generate native asset ID and register into NativeAssetRegistry
    let asset_id = format!("raw_{}_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), rand_suffix());

    let native_asset = NativeImageAsset {
        id: asset_id.clone(),
        width,
        height,
        pixel_format,
        buffer: buffer16.clone(),
        metadata: Some(metadata.clone()),
        ref_count: 1,
        created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64,
    };

    global_asset_registry().register(native_asset);

    // 3. Generate downsampled 8-bit display preview for fast GPU upload
    let srgb8 = ColorPipeline::linear16_to_srgb8(&buffer16, width, height);

    // The overview is downsampled, but its encoding must not add JPEG blocks.
    let mut preview_png_bytes: Option<Vec<u8>> = None;
    if let Some(img_buffer) = image::RgbaImage::from_raw(width as u32, height as u32, srgb8) {
        // Downsample preview to at most 2048px on longest edge for smooth UI
        let max_dim = 2048;
        let (pw, ph) = if width > max_dim || height > max_dim {
            let ratio = (max_dim as f32) / (width.max(height) as f32);
            ((width as f32 * ratio) as u32, (height as f32 * ratio) as u32)
        } else {
            (width as u32, height as u32)
        };

        let resized = image::imageops::resize(&img_buffer, pw, ph, image::imageops::FilterType::Triangle);
        let mut png_bytes = Vec::new();
        let mut cursor = Cursor::new(&mut png_bytes);
        if image::DynamicImage::ImageRgba8(resized).write_to(&mut cursor, image::ImageFormat::Png).is_ok() {
            preview_png_bytes = Some(png_bytes);
        }
    }

    DecodeJobTracker::cleanup_job(job_id);

    Ok(RawDecodeResult {
        asset_id,
        width,
        height,
        pixel_format,
        metadata,
        preview_png_bytes,
    })
}

fn rand_suffix() -> String {
    use std::time::SystemTime;
    let nanos = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos();
    format!("{:04x}", nanos % 0xFFFF)
}
