#[cfg(test)]
mod tests {
    static SESSION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    #[test]
    fn unknown_matrix_icc_interpolates_original_curve_without_input_quantization() {
        let mut icc = super::OutputProfile::Srgb.icc(false);
        let at = icc.windows(9).position(|s| s == b"Copyright").unwrap();
        icc[at] = b'c';
        let profile = moxcms::ColorProfile::new_from_slice(&icc).unwrap();
        let moxcms::ToneReprCurve::Lut(table) = profile.red_trc.unwrap() else {
            panic!("sampled fixture")
        };
        let original: Vec<u16> = (32768..32776).flat_map(|v| [v, v, v, 65535]).collect();
        let mut encoded = Vec::new();
        {
            let mut info = png::Info::with_size(8, 1);
            info.icc_profile = Some(std::borrow::Cow::Owned(icc));
            let mut e = png::Encoder::with_info(&mut encoded, info).unwrap();
            e.set_depth(png::BitDepth::Sixteen);
            e.set_color(png::ColorType::Rgba);
            e.write_header()
                .unwrap()
                .write_image_data(
                    &original
                        .iter()
                        .flat_map(|v| v.to_be_bytes())
                        .collect::<Vec<_>>(),
                )
                .unwrap();
        }
        let source = super::decode_source(encoded).unwrap();
        let packet = super::read_source_tile(&source.asset_id, 0, 0, 8, 1).unwrap();
        let mut previous = 0.0;
        for x in 0..8 {
            let input = (32768 + x) as f32 / 65535.0;
            let at = input as f64 * (table.len() - 1) as f64;
            let lo = at.floor() as usize;
            let fraction = at - lo as f64;
            let expected =
                ((1.0 - fraction) * table[lo] as f64 + fraction * table[lo + 1] as f64) / 65535.0;
            let offset = 12 + x * 16;
            let actual = f32::from_le_bytes(packet[offset..offset + 4].try_into().unwrap());
            assert!(
                (actual as f64 - expected).abs() < 1e-7,
                "x={x} actual={actual} expected={expected}"
            );
            assert!(actual > previous);
            previous = actual;
        }
        super::release_source(&source.asset_id).unwrap();
    }
    #[test]
    fn tagged_srgb_sixteen_bit_adjacent_gradient_survives_repeated_deliveries() {
        let _guard = SESSION_LOCK.lock().unwrap();
        let original: Vec<u16> = (32768..32776).flat_map(|v| [v, v, v, 65535]).collect();
        let mut encoded = Vec::new();
        {
            let mut info = png::Info::with_size(8, 1);
            info.icc_profile = Some(std::borrow::Cow::Owned(
                super::OutputProfile::Srgb.icc(false),
            ));
            let mut e = png::Encoder::with_info(&mut encoded, info).unwrap();
            e.set_depth(png::BitDepth::Sixteen);
            e.set_color(png::ColorType::Rgba);
            e.write_header()
                .unwrap()
                .write_image_data(
                    &original
                        .iter()
                        .flat_map(|v| v.to_be_bytes())
                        .collect::<Vec<_>>(),
                )
                .unwrap();
        }
        assert_eq!(
            image::load_from_memory(&encoded)
                .unwrap()
                .to_rgba16()
                .as_raw(),
            &original
        );
        for pass in 0..3 {
            let source = super::decode_source(std::mem::take(&mut encoded)).unwrap();
            let packet = super::read_source_tile(&source.asset_id, 0, 0, 8, 1).unwrap();
            for x in 0..8 {
                let offset = 12 + x * 16;
                let v = f32::from_le_bytes(packet[offset..offset + 4].try_into().unwrap());
                let expected =
                    crate::color::transform::srgb_to_linear((32768 + x) as f32 / 65535.0);
                assert!(
                    (v - expected).abs() < 1e-7,
                    "pass={pass} x={x} actual={v} expected={expected}"
                );
            }
            for format in ["png", "tiff"] {
                let id = format!("gradient-{pass}-{format}");
                let path = std::env::temp_dir().join(format!("{id}.{format}"));
                super::begin_export(
                    &id,
                    path.to_str().unwrap(),
                    super::ExportOptions {
                        width: 8,
                        height: 1,
                        format: format.into(),
                        output_profile: Default::default(),
                        quality: 0.9,
                    },
                )
                .unwrap();
                super::append_export(&id, 0, packet.clone()).unwrap();
                super::finish_export(&id).unwrap();
                let bytes = std::fs::read(&path).unwrap();
                assert_eq!(
                    image::load_from_memory(&bytes)
                        .unwrap()
                        .to_rgba16()
                        .as_raw(),
                    &original,
                    "pass={pass} format={format}"
                );
                if format == "png" {
                    encoded = bytes;
                }
                let _ = std::fs::remove_file(path);
            }
            super::release_source(&source.asset_id).unwrap();
        }
    }
    #[test]
    fn linear_png_decode_retains_sixteen_bit_and_alpha() {
        let mut encoded = Vec::new();
        {
            let mut e = png::Encoder::new(&mut encoded, 1, 1);
            e.set_depth(png::BitDepth::Sixteen);
            e.set_color(png::ColorType::Rgba);
            e.write_header()
                .unwrap()
                .write_image_data(&[128, 0, 64, 0, 255, 255, 128, 0])
                .unwrap();
        }
        let source = super::decode_source(encoded).unwrap();
        assert_eq!(source.bit_depth, 16);
        let bytes = super::read_source_tile(&source.asset_id, 0, 0, 1, 1).unwrap();
        assert_eq!(&bytes[..4], b"LF32");
        let red = f32::from_le_bytes(bytes[12..16].try_into().unwrap());
        let alpha = f32::from_le_bytes(bytes[24..28].try_into().unwrap());
        assert!((red - crate::color::transform::srgb_to_linear(32768.0 / 65535.0)).abs() < 1e-6);
        assert!((alpha - 32768.0 / 65535.0).abs() < 1e-6);
        super::release_source(&source.asset_id).unwrap();
        assert!(super::read_source_tile(&source.asset_id, 0, 0, 1, 1).is_err());
    }
    #[test]
    fn export_rejects_gap_and_removes_failed_session_without_touching_target() {
        let _guard = SESSION_LOCK.lock().unwrap();
        let path = std::env::temp_dir().join("edit_export_gap_test.png");
        std::fs::write(&path, b"original").unwrap();
        super::begin_export(
            "gap-test",
            path.to_str().unwrap(),
            super::ExportOptions {
                width: 1,
                height: 2,
                format: "png".into(),
                output_profile: Default::default(),
                quality: 0.8,
            },
        )
        .unwrap();
        assert!(
            super::append_export("gap-test", 1, super::packet(1, 1, &[0.5, 0.5, 0.5, 1.0]))
                .is_err()
        );
        assert!(super::finish_export("gap-test").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn tagged_display_p3_decode_matches_independent_matrix_reference_and_alpha() {
        let mut encoded = Vec::new();
        {
            let mut info = png::Info::with_size(1, 1);
            info.icc_profile = Some(std::borrow::Cow::Owned(
                super::OutputProfile::DisplayP3.icc(false),
            ));
            let mut e = png::Encoder::with_info(&mut encoded, info).unwrap();
            e.set_depth(png::BitDepth::Sixteen);
            e.set_color(png::ColorType::Rgba);
            e.write_header()
                .unwrap()
                .write_image_data(&[255, 255, 0, 0, 0, 0, 128, 0])
                .unwrap();
        }
        let source = super::decode_source(encoded).unwrap();
        let bytes = super::read_source_tile(&source.asset_id, 0, 0, 1, 1).unwrap();
        let values: Vec<f32> = bytes[12..]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        // D65 Display P3 -> sRGB matrix, independently computed from primary xy coordinates.
        for (actual, expected) in values[..3].iter().zip([1.224745, -0.042058, -0.019642]) {
            assert!((*actual - expected).abs() < 0.0006, "{values:?}");
        }
        assert!((values[3] - 32768.0 / 65535.0).abs() < 1e-6);
        super::release_source(&source.asset_id).unwrap();
    }
    #[test]
    fn malformed_icc_fails_instead_of_assuming_srgb() {
        let mut encoded = Vec::new();
        {
            let mut info = png::Info::with_size(1, 1);
            info.icc_profile = Some(std::borrow::Cow::Owned(vec![1, 2, 3]));
            let mut e = png::Encoder::with_info(&mut encoded, info).unwrap();
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header()
                .unwrap()
                .write_image_data(&[128, 128, 128, 255])
                .unwrap();
        }
        assert!(super::decode_source(encoded).is_err());
    }
    #[test]
    fn float_tiff_signed_headroom_and_alpha_roundtrip() {
        let _guard = SESSION_LOCK.lock().unwrap();
        let dir = std::env::temp_dir();
        let path = dir.join("edit-f32-roundtrip.tiff");
        super::begin_export(
            "float-roundtrip",
            path.to_str().unwrap(),
            super::ExportOptions {
                width: 2,
                height: 1,
                format: "tiff-f32".into(),
                output_profile: Default::default(),
                quality: 0.8,
            },
        )
        .unwrap();
        super::append_export(
            "float-roundtrip",
            0,
            super::packet(2, 1, &[-0.2, 1.5, 0.3, 0.25, 0.1, 0.2, 0.3, 0.75]),
        )
        .unwrap();
        super::finish_export("float-roundtrip").unwrap();
        let source = super::decode_source(std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(source.bit_depth, 32);
        let bytes = super::read_source_tile(&source.asset_id, 0, 0, 2, 1).unwrap();
        let values: Vec<_> = bytes[12..]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        for (actual, expected) in values
            .into_iter()
            .zip([-0.2, 1.5, 0.3, 0.25, 0.1, 0.2, 0.3, 0.75])
        {
            assert!((actual - expected).abs() < 0.0001, "{actual} vs {expected}");
        }
        super::release_source(&source.asset_id).unwrap();
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn session_rejects_nonfinite_alpha_duplicate_and_incomplete_bands() {
        let _guard = SESSION_LOCK.lock().unwrap();
        for (index, values) in [
            [f32::NAN, 0.2, 0.3, 1.0],
            [0.2, 0.2, 0.3, -0.1],
            [0.2, 0.2, 0.3, 1.1],
        ]
        .into_iter()
        .enumerate()
        {
            let id = format!("invalid-band-{index}");
            super::begin_export(
                &id,
                "C:/invalid-test.png",
                super::ExportOptions {
                    width: 1,
                    height: 1,
                    format: "png".into(),
                    output_profile: Default::default(),
                    quality: 0.8,
                },
            )
            .unwrap();
            assert!(super::append_export(&id, 0, super::packet(1, 1, &values)).is_err());
            assert!(super::finish_export(&id).is_err());
        }
        super::begin_export(
            "duplicate-band",
            "C:/invalid-test.png",
            super::ExportOptions {
                width: 1,
                height: 2,
                format: "png".into(),
                output_profile: Default::default(),
                quality: 0.8,
            },
        )
        .unwrap();
        super::append_export(
            "duplicate-band",
            0,
            super::packet(1, 1, &[0.2, 0.3, 0.4, 1.0]),
        )
        .unwrap();
        assert!(super::append_export(
            "duplicate-band",
            0,
            super::packet(1, 1, &[0.2, 0.3, 0.4, 1.0])
        )
        .is_err());
        super::begin_export(
            "incomplete-band",
            "C:/invalid-test.png",
            super::ExportOptions {
                width: 1,
                height: 2,
                format: "png".into(),
                output_profile: Default::default(),
                quality: 0.8,
            },
        )
        .unwrap();
        assert!(super::finish_export("incomplete-band").is_err());
    }
    #[test]
    fn cancellation_reaches_a_session_already_taken_by_finish() {
        let _guard = SESSION_LOCK.lock().unwrap();
        let path = std::env::temp_dir().join("edit-cancel-encoder-test.tmp");
        super::begin_export(
            "cancel-encoder",
            "C:/unused-output.png",
            super::ExportOptions {
                width: 1,
                height: 1,
                format: "png".into(),
                output_profile: Default::default(),
                quality: 0.8,
            },
        )
        .unwrap();
        super::append_export(
            "cancel-encoder",
            0,
            super::packet(1, 1, &[0.2, 0.3, 0.4, 1.0]),
        )
        .unwrap();
        let mut session = super::jobs()
            .lock()
            .unwrap()
            .remove("cancel-encoder")
            .unwrap();
        super::cancel_export("cancel-encoder").unwrap();
        let mut file = std::fs::File::create(&path).unwrap();
        let result = super::encode_session(&mut session, &mut file);
        drop(file);
        let _ = std::fs::remove_file(path);
        assert!(
            result.is_err(),
            "Cancellation must reach a finishing session"
        );
    }
    #[test]
    fn raw_source_staging_preserves_original_bytes_and_rejects_wrong_extension() {
        let original = b"exact original RAW bytes".to_vec();
        let path = super::stage_raw_source("camera.ARW", original.clone()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(!std::path::Path::new(&path).starts_with(std::env::current_dir().unwrap()));
        assert!(super::stage_raw_source("camera.jpg", original).is_err());
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn bmp_import_preserves_existing_supported_format() {
        let mut bytes = vec![0u8; 58];
        bytes[..2].copy_from_slice(b"BM");
        bytes[2..6].copy_from_slice(&58u32.to_le_bytes());
        bytes[10..14].copy_from_slice(&54u32.to_le_bytes());
        bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
        bytes[18..22].copy_from_slice(&1u32.to_le_bytes());
        bytes[22..26].copy_from_slice(&1u32.to_le_bytes());
        bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
        bytes[28..30].copy_from_slice(&24u16.to_le_bytes());
        bytes[54..58].copy_from_slice(&[0, 0, 255, 0]);
        let info = super::decode_source(bytes).unwrap();
        assert_eq!(info.bit_depth, 8);
        let packet = super::read_source_tile(&info.asset_id, 0, 0, 1, 1).unwrap();
        assert_eq!(f32::from_le_bytes(packet[12..16].try_into().unwrap()), 1.0);
        super::release_source(&info.asset_id).unwrap();
    }
    #[test]
    fn webp_import_preserves_existing_supported_format_and_alpha() {
        let image = image::DynamicImage::ImageRgba8(image::ImageBuffer::from_pixel(
            1,
            1,
            image::Rgba([32, 128, 255, 64]),
        ));
        let mut cursor = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, image::ImageFormat::WebP)
            .unwrap();
        let info = super::decode_source(cursor.into_inner()).unwrap();
        assert_eq!(info.bit_depth, 8);
        let bytes = super::read_source_tile(&info.asset_id, 0, 0, 1, 1).unwrap();
        let green = f32::from_le_bytes(bytes[16..20].try_into().unwrap());
        let alpha = f32::from_le_bytes(bytes[24..28].try_into().unwrap());
        assert!((green - crate::color::transform::srgb_to_linear(128.0 / 255.0)).abs() < 1e-6);
        assert!((alpha - 64.0 / 255.0).abs() < 1e-6);
        super::release_source(&info.asset_id).unwrap();
    }
    #[test]
    fn bmp_embedded_profile_is_honored() {
        let profile = super::OutputProfile::DisplayP3.icc(false);
        let size = 142 + profile.len();
        let mut bytes = vec![0u8; size];
        bytes[..2].copy_from_slice(b"BM");
        bytes[2..6].copy_from_slice(&(size as u32).to_le_bytes());
        bytes[10..14].copy_from_slice(&138u32.to_le_bytes());
        bytes[14..18].copy_from_slice(&124u32.to_le_bytes());
        bytes[18..22].copy_from_slice(&1u32.to_le_bytes());
        bytes[22..26].copy_from_slice(&1u32.to_le_bytes());
        bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
        bytes[28..30].copy_from_slice(&24u16.to_le_bytes());
        bytes[70..74].copy_from_slice(&0x4D424544u32.to_le_bytes());
        bytes[126..130].copy_from_slice(&128u32.to_le_bytes());
        bytes[130..134].copy_from_slice(&(profile.len() as u32).to_le_bytes());
        bytes[138..142].copy_from_slice(&[0, 0, 255, 0]);
        bytes[142..].copy_from_slice(&profile);
        let info = super::decode_source(bytes).unwrap();
        let bytes = super::read_source_tile(&info.asset_id, 0, 0, 1, 1).unwrap();
        let red = f32::from_le_bytes(bytes[12..16].try_into().unwrap());
        assert!((red - 1.224745).abs() < 0.0006, "{red}");
        super::release_source(&info.asset_id).unwrap();
    }
    #[test]
    fn jpeg_import_applies_exif_orientation_without_precision_fallback() {
        use image::ImageEncoder;
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::jpeg::JpegEncoder::new(&mut bytes);
            encoder
                .set_exif_metadata(vec![
                    73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0,
                    0,
                ])
                .unwrap();
            encoder
                .encode(
                    &[255, 0, 0, 0, 0, 255],
                    2,
                    1,
                    image::ExtendedColorType::Rgb8,
                )
                .unwrap();
        }
        let decoded = image::ImageReader::new(std::io::Cursor::new(bytes.clone()))
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap()
            .rotate90()
            .into_rgba32f();
        let info = super::decode_source(bytes).unwrap();
        assert_eq!((info.width, info.height), (1, 2));
        let packet = super::read_source_tile(&info.asset_id, 0, 0, 1, 2).unwrap();
        let samples: Vec<f32> = packet[12..]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        for (p, expected) in samples.chunks_exact(4).zip(decoded.pixels()) {
            for c in 0..3 {
                assert!(
                    (p[c] - crate::color::transform::srgb_to_linear(expected.0[c])).abs() < 1e-6
                );
            }
            assert_eq!(p[3], 1.0);
        }
        super::release_source(&info.asset_id).unwrap();
    }
    #[test]
    fn associated_float_tiff_alpha_is_converted_to_straight_working_rgb() {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut encoder = tiff::encoder::TiffEncoder::new(&mut cursor).unwrap();
            let mut image = encoder
                .new_image::<tiff::encoder::colortype::RGB32Float>(1, 1)
                .unwrap();
            image
                .extra_samples(&[tiff::tags::ExtraSamples::AssociatedAlpha])
                .unwrap();
            image.write_data(&[0.125, 0.25, -0.1, 0.5]).unwrap();
        }
        let info = super::decode_source(cursor.into_inner()).unwrap();
        let bytes = super::read_source_tile(&info.asset_id, 0, 0, 1, 1).unwrap();
        let values: Vec<_> = bytes[12..]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        super::release_source(&info.asset_id).unwrap();
        assert_eq!(values, vec![0.25, 0.5, -0.2, 0.5]);
    }
    #[test]
    fn released_source_is_still_budgeted_while_a_tile_lease_owns_it() {
        let mut bytes = Vec::new();
        {
            let mut e = png::Encoder::new(&mut bytes, 1, 1);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header()
                .unwrap()
                .write_image_data(&[32, 128, 255, 64])
                .unwrap();
        }
        let info = super::decode_source(bytes).unwrap();
        let lease = super::sources()
            .lock()
            .unwrap()
            .get(&info.asset_id)
            .cloned()
            .unwrap();
        super::release_source(&info.asset_id).unwrap();
        assert!(
            super::source_live_bytes() >= 16,
            "Released but leased float data must count against the registry budget"
        );
        assert_eq!(lease.data.len(), 4);
    }
    #[test]
    #[ignore = "allocates 256 MiB original bytes to verify the large TIFF input boundary"]
    fn large_tiff_original_bytes_can_exceed_old_256_mib_input_cap() {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut encoder = tiff::encoder::TiffEncoder::new(&mut cursor).unwrap();
            encoder
                .new_image::<tiff::encoder::colortype::RGB32Float>(1, 1)
                .unwrap()
                .write_data(&[-0.2, 1.5, 0.3])
                .unwrap();
        }
        let mut bytes = cursor.into_inner();
        bytes.resize(256 * 1024 * 1024 + 1, 0);
        let info = super::decode_source(bytes).unwrap();
        assert_eq!(info.bit_depth, 32);
        super::release_source(&info.asset_id).unwrap();
    }
}

pub fn stage_raw_source(name: &str, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 256 * 1024 * 1024 {
        return Err("RAW original must be 1 byte..256 MiB".into());
    }
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !crate::filesystem::is_raw_extension(&extension) {
        return Err("Unsupported RAW source extension".into());
    }
    let path = PathBuf::from(crate::filesystem::get_app_paths()?.local_data_dir)
        .join("edit-sources")
        .join(format!(
            "{}-{}.{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed),
            extension
        ));
    crate::filesystem::atomic_write(&path, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
pub struct SourceInfo {
    pub asset_id: String,
    pub width: usize,
    pub height: usize,
    pub bit_depth: u8,
}
#[derive(serde::Deserialize)]
pub struct ExportOptions {
    pub width: usize,
    pub height: usize,
    pub format: String,
    #[serde(default)]
    pub output_profile: crate::raw::output_profile::OutputProfile,
    pub quality: f32,
}
use crate::raw::output_profile::OutputProfile;
use image::{ColorType, ImageDecoder, ImageFormat};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
};
const SOURCE_BUDGET: usize = 1024 * 1024 * 1024;
const MAX_SOURCE_PIXELS: usize = 64_000_000;
const MAX_JOBS: usize = 4;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static LIVE_SOURCE_BYTES: AtomicUsize = AtomicUsize::new(0);
struct Source {
    width: usize,
    height: usize,
    data: Vec<f32>,
}
impl Drop for Source {
    fn drop(&mut self) {
        LIVE_SOURCE_BYTES.fetch_sub(self.data.len() * 4, Ordering::AcqRel);
    }
}
fn sources() -> &'static Mutex<HashMap<String, Arc<Source>>> {
    static S: OnceLock<Mutex<HashMap<String, Arc<Source>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
fn source_live_bytes() -> usize {
    LIVE_SOURCE_BYTES.load(Ordering::Acquire)
}
fn jobs() -> &'static Mutex<HashMap<String, ExportSession>> {
    static S: OnceLock<Mutex<HashMap<String, ExportSession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
struct LiveJob {
    cancel: Arc<AtomicBool>,
    path: PathBuf,
}
fn live_jobs() -> &'static Mutex<HashMap<String, LiveJob>> {
    static S: OnceLock<Mutex<HashMap<String, LiveJob>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
// Serialize peak decoder allocation so concurrent callers cannot bypass the budget.
fn decode_lock() -> &'static Mutex<()> {
    static S: OnceLock<Mutex<()>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(()))
}
fn bmp_profile(bytes: &[u8]) -> Result<Option<Vec<u8>>, String> {
    if bytes.get(..2) != Some(b"BM") {
        return Ok(None);
    }
    let read = |offset: usize| -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            bytes
                .get(offset..offset + 4)
                .ok_or("Truncated BMP color header")?
                .try_into()
                .unwrap(),
        ))
    };
    let header = read(14)?;
    if header < 108 {
        return Ok(None);
    }
    let space = read(70)?;
    match space {
        0x73524742 | 0x57696E20 => Ok(None), // LCS_sRGB, LCS_WINDOWS_COLOR_SPACE
        0x4D424544 if header >= 124 => {
            let start = (read(126)? as usize)
                .checked_add(14)
                .ok_or("Invalid BMP ICC offset")?;
            let size = read(130)? as usize;
            if size == 0 || size > 4 * 1024 * 1024 {
                return Err("Invalid BMP ICC size".into());
            }
            Ok(Some(
                bytes
                    .get(start..start.checked_add(size).ok_or("Invalid BMP ICC range")?)
                    .ok_or("BMP ICC is outside source")?
                    .to_vec(),
            ))
        }
        _ => Err("Unsupported calibrated or linked BMP color profile".into()),
    }
}
struct TiffMetadata {
    icc: Option<Vec<u8>>,
    associated_alpha: bool,
    float_samples: bool,
}
fn tiff_metadata(bytes: &[u8]) -> Result<Option<TiffMetadata>, String> {
    if !matches!(image::guess_format(bytes), Ok(ImageFormat::Tiff)) {
        return Ok(None);
    }
    let mut limits = tiff::decoder::Limits::default();
    limits.ifd_value_size = 4 * 1024 * 1024;
    let mut decoder = tiff::decoder::Decoder::new(Cursor::new(bytes))
        .map_err(|e| e.to_string())?
        .with_limits(limits);
    // Image's TIFF wrapper discards ICC tag errors; read it explicitly so a bad
    // embedded profile cannot silently become the untagged sRGB default.
    let icc = decoder
        .find_tag(tiff::tags::Tag::IccProfile)
        .map_err(|e| e.to_string())?
        .map(|v| v.into_u8_vec())
        .transpose()
        .map_err(|e| e.to_string())?;
    let extra = decoder
        .find_tag(tiff::tags::Tag::ExtraSamples)
        .map_err(|e| e.to_string())?
        .map(|v| v.into_u16_vec())
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let sample = decoder
        .find_tag(tiff::tags::Tag::SampleFormat)
        .map_err(|e| e.to_string())?
        .map(|v| v.into_u16_vec())
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(Some(TiffMetadata {
        icc,
        associated_alpha: extra == [1],
        float_samples: !sample.is_empty() && sample.iter().all(|v| *v == 3),
    }))
}
pub fn decode_source(bytes: Vec<u8>) -> Result<SourceInfo, String> {
    let _guard = decode_lock().lock().map_err(|_| "Decoder unavailable")?;
    if bytes.len() > SOURCE_BUDGET {
        return Err("Encoded source exceeds 1 GiB".into());
    }
    let bmp_icc = bmp_profile(&bytes)?;
    let tiff = tiff_metadata(&bytes)?;
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader.format().ok_or("Unsupported source format")?;
    if !matches!(
        format,
        ImageFormat::Jpeg
            | ImageFormat::Png
            | ImageFormat::Tiff
            | ImageFormat::WebP
            | ImageFormat::Bmp
    ) {
        return Err("Edit source must be JPEG, PNG, TIFF, WebP or BMP".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32768);
    limits.max_image_height = Some(32768);
    limits.max_alloc = Some(SOURCE_BUDGET as u64);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let (w, h) = decoder.dimensions();
    let (width, height) = (w as usize, h as usize);
    let count = width
        .checked_mul(height)
        .ok_or("Source dimensions overflow")?;
    if count == 0 || count > MAX_SOURCE_PIXELS {
        return Err("Edit source exceeds 64 million pixels".into());
    }
    let color = decoder.color_type();
    let bit_depth = match color {
        ColorType::L8 | ColorType::La8 | ColorType::Rgb8 | ColorType::Rgba8 => 8,
        ColorType::L16 | ColorType::La16 | ColorType::Rgb16 | ColorType::Rgba16 => 16,
        ColorType::Rgb32F | ColorType::Rgba32F
            if tiff.as_ref().is_some_and(|m| m.float_samples) =>
        {
            32
        }
        _ => return Err("Unsupported source sample format".into()),
    };
    let profile = if let Some(metadata) = &tiff {
        metadata.icc.clone()
    } else {
        decoder
            .icc_profile()
            .map_err(|e| e.to_string())?
            .or(bmp_icc)
    };
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    if profile.as_ref().is_some_and(|p| p.len() > 4 * 1024 * 1024) {
        return Err("ICC profile exceeds 4 MiB".into());
    }
    if sources()
        .lock()
        .map_err(|_| "Source registry unavailable")?
        .len()
        >= 32
    {
        return Err("Edit source registry exceeds 32 sources".into());
    }
    let stored = source_live_bytes();
    if stored + count * 16 > SOURCE_BUDGET {
        return Err("Edit source registry exceeds 1 GiB".into());
    }
    let mut decoded = image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    decoded.apply_orientation(orientation);
    let (width, height) = (decoded.width() as usize, decoded.height() as usize);
    let mut data = decoded.into_rgba32f().into_raw();
    if data
        .chunks_exact(4)
        .any(|p| p.iter().any(|v| !v.is_finite()) || !(0.0..=1.0).contains(&p[3]))
    {
        return Err("Invalid source sample or alpha".into());
    }
    if tiff.as_ref().is_some_and(|m| m.associated_alpha) {
        for p in data.chunks_exact_mut(4) {
            for c in 0..3 {
                p[c] = if p[3] > 0.0 { p[c] / p[3] } else { 0.0 };
            }
        }
    }
    if let Some(icc) = profile {
        use moxcms::{ColorProfile, Layout, TransformOptions};
        let mut source =
            ColorProfile::new_from_slice(&icc).map_err(|e| format!("Invalid source ICC: {e}"))?;
        if source.color_space != moxcms::DataColorSpace::Rgb {
            return Err("Only RGB source ICC profiles are supported".into());
        }
        // Sampled identity curves have a defined linear extension. Normalize only
        // exact rounded identity tables; arbitrary sampled TRCs stay unchanged.
        for curve in [
            &mut source.red_trc,
            &mut source.green_trc,
            &mut source.blue_trc,
        ] {
            let identity = match curve.as_ref() {
                Some(moxcms::ToneReprCurve::Lut(samples)) => {
                    samples.is_empty()
                        || samples.as_slice() == [256]
                        || (samples.len() > 1
                            && samples.iter().enumerate().all(|(i, v)| {
                                *v == (i as f64 * 65535.0 / (samples.len() - 1) as f64).round()
                                    as u16
                            }))
                }
                _ => false,
            };
            if identity {
                *curve = Some(moxcms::ToneReprCurve::Lut(Vec::new()));
            }
        }
        if data
            .chunks_exact(4)
            .any(|p| p[..3].iter().any(|v| !(0.0..=1.0).contains(v)))
        {
            let evaluator = source.red_trc == source.green_trc
                && source.red_trc == source.blue_trc
                && match source.red_trc.as_ref() {
                    Some(moxcms::ToneReprCurve::Lut(table)) => table.len() <= 1,
                    Some(moxcms::ToneReprCurve::Parametric(_)) => true,
                    _ => false,
                };
            if !evaluator {
                return Err("Source ICC has no supported extended-range input curve".into());
            }
        }
        // moxcms' sampled-TRC transform resamples to an indexed working LUT,
        // losing adjacent 16-bit inputs. Evaluate matrix-profile curves at the
        // original float sample, then let moxcms perform the ICC matrix stage.
        let matrix_profile = source.pcs == moxcms::DataColorSpace::Xyz
            && source.lut_a_to_b_perceptual.is_none()
            && source.lut_a_to_b_colorimetric.is_none()
            && source.lut_a_to_b_saturation.is_none()
            && source.cicp.is_none();
        if matrix_profile {
            let known_srgb_transfer =
                icc == OutputProfile::Srgb.icc(false) || icc == OutputProfile::DisplayP3.icc(false);
            let curves = [&source.red_trc, &source.green_trc, &source.blue_trc]
                .into_iter()
                .map(|curve| {
                    curve
                        .as_ref()
                        .ok_or_else(|| "Missing source ICC curve".to_string())?
                        .make_linear_evaluator()
                        .map_err(|e| e.to_string())
                })
                .collect::<Result<Vec<_>, String>>()?;
            for p in data.chunks_exact_mut(4) {
                for c in 0..3 {
                    p[c] = if known_srgb_transfer {
                        crate::color::transform::srgb_to_linear(p[c])
                    } else {
                        curves[c].evaluate_value(p[c])
                    };
                }
            }
            source.red_trc = Some(moxcms::ToneReprCurve::Lut(Vec::new()));
            source.green_trc = source.red_trc.clone();
            source.blue_trc = source.red_trc.clone();
        }
        let mut target = ColorProfile::new_from_slice(&OutputProfile::Srgb.icc(true))
            .map_err(|e| e.to_string())?;
        // Our generated destination is exactly linear; an explicit identity TRC
        // lets moxcms preserve extended output instead of its bounded LUT path.
        let linear = moxcms::ToneReprCurve::Lut(Vec::new());
        target.red_trc = Some(linear.clone());
        target.green_trc = Some(linear.clone());
        target.blue_trc = Some(linear);
        let transform = source
            .create_transform_f32(
                Layout::Rgb,
                &target,
                Layout::Rgb,
                TransformOptions {
                    prefer_fixed_point: false,
                    allow_extended_range_rgb_xyz: true,
                    ..Default::default()
                },
            )
            .map_err(|e| format!("Unsupported source ICC transform: {e}"))?;
        let mut input = vec![0f32; width * 3];
        let mut output = vec![0f32; width * 3];
        for row in data.chunks_exact_mut(width * 4) {
            for (p, rgb) in row.chunks_exact(4).zip(input.chunks_exact_mut(3)) {
                rgb.copy_from_slice(&p[..3]);
            }
            transform
                .transform(&input, &mut output)
                .map_err(|e| e.to_string())?;
            for (p, rgb) in row.chunks_exact_mut(4).zip(output.chunks_exact(3)) {
                p[..3].copy_from_slice(rgb);
            }
        }
    } else if bit_depth != 32 {
        // Untagged integer RGB is sRGB; proven IEEE float TIFF is linear sRGB.
        for p in data.chunks_exact_mut(4) {
            for c in &mut p[..3] {
                *c = crate::color::transform::srgb_to_linear(*c);
            }
        }
    }
    if data.iter().any(|v| !v.is_finite()) {
        return Err("ICC produced nonfinite pixels".into());
    }
    let asset_id = format!(
        "edit-source-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    );
    let mut registry = sources()
        .lock()
        .map_err(|_| "Source registry unavailable")?;
    LIVE_SOURCE_BYTES.fetch_add(data.len() * 4, Ordering::AcqRel);
    registry.insert(
        asset_id.clone(),
        Arc::new(Source {
            width,
            height,
            data,
        }),
    );
    Ok(SourceInfo {
        asset_id,
        width,
        height,
        bit_depth,
    })
}
pub fn packet(width: usize, height: usize, data: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(12 + data.len() * 4);
    b.extend_from_slice(b"LF32");
    b.extend_from_slice(&(width as u32).to_le_bytes());
    b.extend_from_slice(&(height as u32).to_le_bytes());
    for v in data {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b
}
pub fn validate_region(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    sw: usize,
    sh: usize,
) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || width.checked_mul(height).is_none_or(|n| n > 6_000_000)
        || x.checked_add(width).is_none_or(|v| v > sw)
        || y.checked_add(height).is_none_or(|v| v > sh)
    {
        return Err("Invalid LF32 source region".into());
    }
    Ok(())
}
pub fn read_source_tile(
    id: &str,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> Result<Vec<u8>, String> {
    let source = sources()
        .lock()
        .map_err(|_| "Source registry unavailable")?
        .get(id)
        .cloned()
        .ok_or("Edit source is released")?;
    validate_region(x, y, width, height, source.width, source.height)?;
    let mut output = packet(width, height, &[]);
    output
        .try_reserve_exact(width * height * 16)
        .map_err(|_| "LF32 allocation failed")?;
    for row in y..y + height {
        for v in &source.data[(row * source.width + x) * 4..(row * source.width + x + width) * 4] {
            output.extend_from_slice(&v.to_le_bytes());
        }
    }
    Ok(output)
}
pub fn release_source(id: &str) -> Result<(), String> {
    sources()
        .lock()
        .map_err(|_| "Source registry unavailable")?
        .remove(id);
    Ok(())
}
struct TempSpool(PathBuf);
impl Drop for TempSpool {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
struct ExportSession {
    id: String,
    cancel: Arc<AtomicBool>,
    path: PathBuf,
    file: File,
    _spool: TempSpool,
    options: ExportOptions,
    next_y: usize,
}
impl Drop for ExportSession {
    fn drop(&mut self) {
        if let Ok(mut live) = live_jobs().lock() {
            live.remove(&self.id);
        }
    }
}
fn check_cancel(s: &ExportSession) -> Result<(), String> {
    if s.cancel.load(Ordering::Acquire) {
        Err("Edit export cancelled".into())
    } else {
        Ok(())
    }
}
pub fn begin_export(id: &str, path: &str, options: ExportOptions) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 256
        || path.trim().is_empty()
        || options.width == 0
        || options.height == 0
        || options.width > 32768
        || options.height > 32768
        || options
            .width
            .checked_mul(options.height)
            .is_none_or(|n| n > 150_000_000)
        || !matches!(
            options.format.as_str(),
            "png" | "jpeg" | "tiff" | "tiff-f32"
        )
        || !(0.0..=1.0).contains(&options.quality)
    {
        return Err("Invalid Edit export options".into());
    }
    let mut registry = jobs().lock().map_err(|_| "Export registry unavailable")?;
    let mut live = live_jobs()
        .lock()
        .map_err(|_| "Export registry unavailable")?;
    if live.contains_key(id)
        || live.len() >= MAX_JOBS
        || live.values().any(|s| s.path == PathBuf::from(path))
    {
        return Err("Duplicate export id/path or four-job limit exceeded".into());
    }
    let dir = PathBuf::from(crate::filesystem::get_app_paths()?.temp_dir);
    let spool = dir.join(format!(
        "edit-float-{}-{}.tmp",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&spool)
        .map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    live.insert(
        id.into(),
        LiveJob {
            cancel: cancel.clone(),
            path: PathBuf::from(path),
        },
    );
    registry.insert(
        id.into(),
        ExportSession {
            id: id.into(),
            cancel,
            path: PathBuf::from(path),
            file,
            _spool: TempSpool(spool),
            options,
            next_y: 0,
        },
    );
    Ok(())
}
pub fn append_export(id: &str, y: usize, bytes: Vec<u8>) -> Result<(), String> {
    let mut registry = jobs().lock().map_err(|_| "Export registry unavailable")?;
    let result = (|| {
        let s = registry
            .get_mut(id)
            .ok_or("Export session is unavailable")?;
        check_cancel(s)?;
        if bytes.len() < 12 || &bytes[..4] != b"LF32" {
            return Err("Invalid export LF32 header".into());
        }
        let w = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let h = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        if y != s.next_y
            || w != s.options.width
            || h == 0
            || h > 128
            || w.checked_mul(h).is_none_or(|n| n > 6_000_000)
            || bytes.len() != 12 + w * h * 16
            || y.checked_add(h).is_none_or(|n| n > s.options.height)
        {
            return Err("Export bands must be ordered, complete full-width rows (1..128)".into());
        }
        for (i, b) in bytes[12..].chunks_exact(4).enumerate() {
            let value = f32::from_le_bytes(b.try_into().unwrap());
            if !value.is_finite() || (i % 4 == 3 && !(0.0..=1.0).contains(&value)) {
                return Err("Invalid export float or alpha".into());
            }
        }
        s.file.write_all(&bytes[12..]).map_err(|e| e.to_string())?;
        s.next_y += h;
        Ok(())
    })();
    if result.is_err() {
        registry.remove(id);
    }
    result
}
pub fn cancel_export(id: &str) -> Result<(), String> {
    if let Some(flag) = live_jobs()
        .lock()
        .map_err(|_| "Export registry unavailable")?
        .get(id)
        .map(|j| j.cancel.clone())
    {
        flag.store(true, Ordering::Release);
    }
    jobs()
        .lock()
        .map_err(|_| "Export registry unavailable")?
        .remove(id);
    Ok(())
}
fn read_pixels(file: &mut File, count: usize) -> Result<Vec<f32>, String> {
    let mut bytes = vec![0u8; count * 4];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect())
}
fn delivery_pixels(values: &mut [f32], profile: OutputProfile, float: bool, jpeg: bool) {
    for p in values.chunks_exact_mut(4) {
        let mut rgb = [p[0], p[1], p[2]];
        if jpeg {
            for v in &mut rgb {
                *v = *v * p[3] + 1.0 - p[3];
            }
        }
        let rgb = profile.convert(rgb);
        for c in 0..3 {
            p[c] = if float {
                rgb[c]
            } else {
                crate::color::transform::linear_to_srgb(rgb[c]).clamp(0.0, 1.0)
            };
        }
    }
}
fn encode_session(s: &mut ExportSession, file: &mut File) -> Result<(), String> {
    check_cancel(s)?;
    let o = &s.options;
    let w = o.width;
    let h = o.height;
    s.file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    match o.format.as_str() {
        "png" => {
            let mut info = png::Info::with_size(w as u32, h as u32);
            info.icc_profile = Some(std::borrow::Cow::Owned(o.output_profile.icc(false)));
            let mut encoder =
                png::Encoder::with_info(&mut *file, info).map_err(|e| e.to_string())?;
            encoder.set_depth(png::BitDepth::Sixteen);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_source_gamma(png::ScaledFloat::from_scaled(45455));
            let (r, g, b) = if matches!(o.output_profile, OutputProfile::DisplayP3) {
                ((0.68, 0.32), (0.265, 0.69), (0.15, 0.06))
            } else {
                ((0.64, 0.33), (0.30, 0.60), (0.15, 0.06))
            };
            encoder.set_source_chromaticities(png::SourceChromaticities::new(
                (0.3127, 0.3290),
                r,
                g,
                b,
            ));
            let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
            {
                let mut stream = writer.stream_writer().map_err(|e| e.to_string())?;
                for _ in 0..h {
                    check_cancel(s)?;
                    let mut row = read_pixels(&mut s.file, w * 4)?;
                    delivery_pixels(&mut row, o.output_profile, false, false);
                    let bytes: Vec<u8> = row
                        .iter()
                        .flat_map(|v| ((*v * 65535.0).round() as u16).to_be_bytes())
                        .collect();
                    stream.write_all(&bytes).map_err(|e| e.to_string())?;
                }
                stream.finish().map_err(|e| e.to_string())?;
            }
            writer.finish().map_err(|e| e.to_string())?;
        }
        "tiff" | "tiff-f32" => {
            let float = o.format == "tiff-f32";
            let mut encoder =
                tiff::encoder::TiffEncoder::new(&mut *file).map_err(|e| e.to_string())?;
            macro_rules! write_tiff {
                ($color:ty,$sample:ty,$convert:expr) => {{
                    let mut image = encoder
                        .new_image::<$color>(w as u32, h as u32)
                        .map_err(|e| e.to_string())?;
                    image
                        .extra_samples(&[tiff::tags::ExtraSamples::UnassociatedAlpha])
                        .map_err(|e| e.to_string())?;
                    image.rows_per_strip(128).map_err(|e| e.to_string())?;
                    image
                        .encoder()
                        .write_tag(
                            tiff::tags::Tag::IccProfile,
                            o.output_profile.icc(float).as_slice(),
                        )
                        .map_err(|e| e.to_string())?;
                    for y in (0..h).step_by(128) {
                        check_cancel(s)?;
                        let mut pixels = read_pixels(&mut s.file, w * (h - y).min(128) * 4)?;
                        delivery_pixels(&mut pixels, o.output_profile, float, false);
                        let samples: Vec<$sample> = pixels.into_iter().map($convert).collect();
                        image.write_strip(&samples).map_err(|e| e.to_string())?;
                    }
                    image.finish().map_err(|e| e.to_string())?;
                }};
            }
            if float {
                write_tiff!(tiff::encoder::colortype::RGB32Float, f32, |v: f32| v);
            } else {
                write_tiff!(
                    tiff::encoder::colortype::RGB16,
                    u16,
                    |v: f32| (v * 65535.0).round() as u16
                );
            }
        }
        "jpeg" => {
            let mut rgb = Vec::new();
            rgb.try_reserve_exact(w * h * 3)
                .map_err(|_| "JPEG allocation failed")?;
            for _ in 0..h {
                check_cancel(s)?;
                let mut row = read_pixels(&mut s.file, w * 4)?;
                delivery_pixels(&mut row, o.output_profile, false, true);
                for p in row.chunks_exact(4) {
                    rgb.extend(p[..3].iter().map(|v| (*v * 255.0).round() as u8));
                }
            }
            use image::ImageEncoder;
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut *file,
                (o.quality * 100.0).round().clamp(1.0, 100.0) as u8,
            );
            encoder
                .set_icc_profile(o.output_profile.icc(false))
                .map_err(|e| e.to_string())?;
            encoder
                .encode(&rgb, w as u32, h as u32, image::ExtendedColorType::Rgb8)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported export format".into()),
    }
    Ok(())
}
pub fn finish_export(id: &str) -> Result<String, String> {
    static ENCODE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = ENCODE_LOCK
        .lock()
        .map_err(|_| "Export encoder unavailable")?;
    let mut s = jobs()
        .lock()
        .map_err(|_| "Export registry unavailable")?
        .remove(id)
        .ok_or("Export session is unavailable")?;
    if s.next_y != s.options.height {
        return Err("Incomplete Edit export".into());
    }
    let parent = s
        .path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or("Output requires a directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(
        ".edit-delivery-{}-{}.tmp",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        encode_session(&mut s, &mut file)?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        check_cancel(&s)?;
        crate::filesystem::atomic_replace(&temporary, &s.path)?;
        Ok(s.path.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
