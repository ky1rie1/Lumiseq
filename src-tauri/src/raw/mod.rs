// src-tauri/src/raw/mod.rs
pub mod types;
pub mod ffi;
pub mod metadata;
pub mod thumbnail;
pub mod decoder;
pub mod detail;
mod linear_source;
mod optics;
#[cfg(test)]
mod compatibility_tests;
#[cfg(test)]
mod scene_quality_tests;
pub mod auto_white_balance;
pub mod develop;
mod spatial;
mod quality;
mod wavelet;
mod haze;
mod output_profile;

pub use types::{DemosaicQuality, HighlightStrategy, PixelFormat, RawDecodeResult, RawError, RawMetadata};
pub use metadata::read_metadata;
pub use thumbnail::extract_embedded_thumbnail;
pub use decoder::{decode_raw, DecodeJobTracker};
pub use develop::{export_raw_develop, NativeDevelopSettings, NativeExportOptions};
pub use quality::{analyze_raw_spatial, RawSpatialAnalysis};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::{global_asset_registry, NativeImageAsset};
    use crate::color::display::ColorPipeline;

    #[test]
    fn test_asset_registry_lifecycle() {
        let registry = global_asset_registry();
        let asset = NativeImageAsset {
            id: "test_raw_asset_001".to_string(),
            width: 100,
            height: 100,
            pixel_format: PixelFormat::RGBA16,
            buffer: vec![0u8; 100 * 100 * 8],
            metadata: None,
            ref_count: 1,
            created_at: 1000,
        };

        registry.register(asset);
        assert!(registry.get("test_raw_asset_001").is_some());

        assert!(registry.retain("test_raw_asset_001"));
        assert!(!registry.release("test_raw_asset_001")); // ref count 2 -> 1
        assert!(registry.release("test_raw_asset_001"));  // ref count 1 -> 0 (removed)
        assert!(registry.get("test_raw_asset_001").is_none());
    }

    #[test]
    fn test_color_pipeline_linear16_to_srgb8() {
        // Create 1 pixel RGBA16: 50% gray
        let mid16 = 32768u16;
        let mut buf = Vec::new();
        buf.extend_from_slice(&mid16.to_le_bytes());
        buf.extend_from_slice(&mid16.to_le_bytes());
        buf.extend_from_slice(&mid16.to_le_bytes());
        buf.extend_from_slice(&65535u16.to_le_bytes());

        let srgb8 = ColorPipeline::linear16_to_srgb8(&buf, 1, 1);
        assert_eq!(srgb8.len(), 4);
        assert_eq!(srgb8[3], 255); // Alpha 255
        // 50% linear is ~73% in sRGB (~187)
        assert!(srgb8[0] >= 180 && srgb8[0] <= 195);
    }

    #[test]
    fn test_job_tracker_cancellation() {
        let job = "job_test_cancel_99";
        assert!(!DecodeJobTracker::is_cancelled(job));

        DecodeJobTracker::cancel_job(job);
        assert!(DecodeJobTracker::is_cancelled(job));

        DecodeJobTracker::cleanup_job(job);
        assert!(!DecodeJobTracker::is_cancelled(job));
    }
}

pub mod detail_v2;
