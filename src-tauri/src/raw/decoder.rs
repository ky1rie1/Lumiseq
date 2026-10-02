// src-tauri/src/raw/decoder.rs
use crate::assets::{global_asset_registry, NativeImageAsset};
use crate::raw::ffi::SafeRawDecoder;
use crate::raw::types::{DemosaicQuality, RawDecodeResult, RawError};
use std::collections::HashSet;
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
    decode_raw_versioned(job_id,file_path,quality,2)
}

pub fn decode_raw_versioned(job_id:&str,file_path:&str,quality:DemosaicQuality,processing_version:u8)->Result<RawDecodeResult,RawError> {
    decode_raw_with_options(job_id,file_path,quality,processing_version,super::types::RawCorrectionMode::Camera)
}

pub fn decode_raw_with_options(job_id:&str,file_path:&str,quality:DemosaicQuality,processing_version:u8,correction_mode:super::types::RawCorrectionMode)->Result<RawDecodeResult,RawError> {
    if !matches!(processing_version,1|2) {return Err(RawError::DecodeFailed("Unsupported RAW processing version".into()));}
    if processing_version==1 && correction_mode!=super::types::RawCorrectionMode::Camera {return Err(RawError::DecodeFailed("Uncorrected inspection requires RAW processing version 2".into()));}
    if DecodeJobTracker::is_cancelled(job_id) {
        DecodeJobTracker::cleanup_job(job_id);
        return Err(RawError::Cancelled);
    }

    // 1. Run safe isolated FFI decode
    let decoder = SafeRawDecoder::new(file_path);
    let (width, height, pixel_format, buffer, metadata) = if processing_version==1 {decoder.decode(quality)?} else {decoder.decode_scene_with_mode(quality,correction_mode)?};

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
        buffer,
        metadata: Some(metadata.clone()),
        ref_count: 1,
        created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64,
    };

    // Bound the preview before display conversion; never duplicate the full float master.
    let preview_png_bytes = Some(super::detail::display_preview_for_asset(&native_asset)?);
    global_asset_registry().register(native_asset);

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
