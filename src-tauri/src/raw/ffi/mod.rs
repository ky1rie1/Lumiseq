// src-tauri/src/raw/ffi/mod.rs
//! Isolated FFI boundary for native LibRaw decoding.
//! All unsafe C/C++ memory allocation, pointers, and external decoding calls are strictly contained here.

pub mod bindings;

use crate::raw::ffi::bindings::*;
use crate::raw::types::{DemosaicQuality, PixelFormat, RawError, RawMetadata};
use std::ffi::{CStr, CString};
use std::path::Path;

pub struct SafeRawDecoder {
    file_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Poly Haven outdoor_workshop CC0 DSC_8832.NEF, measured unclipped chart white.
    /// Publication TIFF is a rendition reference, not absolute chart calibration.
    #[test]
    #[ignore = "requires LUMISEQ_RAW_CHART pointing to the CC0 Nikon Z7 chart capture"]
    fn real_chart_white_patch_preserves_decoded_headroom() {
        let path = std::env::var("LUMISEQ_RAW_CHART").expect("CC0 chart RAW");
        let (w, h, format, buffer, metadata) = SafeRawDecoder::new(&path)
            .decode(DemosaicQuality::High)
            .unwrap();
        assert_eq!(metadata.camera_model, "Z 7");
        assert_eq!((w, h, format), (5520, 8288, PixelFormat::RGBA16));
        let mut channels: [Vec<u16>; 3] = std::array::from_fn(|_| Vec::new());
        for y in 6826..6836 {
            for x in 2281..2291 {
                for c in 0..3 {
                    let offset = (y * w + x) * 8 + c * 2;
                    channels[c].push(u16::from_le_bytes([buffer[offset], buffer[offset + 1]]));
                }
            }
        }
        let median: [u16; 3] = std::array::from_fn(|c| {
            channels[c].sort_unstable();
            channels[c][50]
        });
        println!("chart white linear16 median: {median:?}");
        assert!(
            median.iter().all(|v| *v > 0 && *v < 60000),
            "Unclipped chart white lost headroom: {median:?}"
        );
    }
}

impl SafeRawDecoder {
    pub fn new(file_path: &str) -> Self {
        Self {
            file_path: file_path.to_string(),
        }
    }

    /// Read metadata via LibRaw + EXIF container
    pub fn get_metadata(&self) -> Result<RawMetadata, RawError> {
        let path = Path::new(&self.file_path);
        if !path.exists() {
            return Err(RawError::CorruptFile(format!(
                "File does not exist: {}",
                self.file_path
            )));
        }

        let c_path = CString::new(self.file_path.clone())
            .map_err(|e| RawError::DecodeFailed(e.to_string()))?;

        let mut raw_meta: LibRawMetaResult = unsafe { std::mem::zeroed() };
        let ret = unsafe { libraw_wrapper_get_metadata(c_path.as_ptr(), &mut raw_meta) };

        // Start with EXIF metadata from kamadak-exif as base
        let mut meta = crate::raw::metadata::read_metadata_exif_base(&self.file_path)?;

        if ret == 0 {
            let make_str = unsafe { CStr::from_ptr(raw_meta.make.as_ptr()) }
                .to_string_lossy()
                .trim()
                .to_string();
            let model_str = unsafe { CStr::from_ptr(raw_meta.model.as_ptr()) }
                .to_string_lossy()
                .trim()
                .to_string();

            if !make_str.is_empty() {
                meta.camera_make = make_str;
            }
            if !model_str.is_empty() {
                meta.camera_model = model_str;
            }

            if raw_meta.width > 0 && raw_meta.height > 0 {
                meta.width = raw_meta.width as usize;
                meta.height = raw_meta.height as usize;
            }

            if raw_meta.bits_per_sample > 0 {
                meta.bits_per_sample = raw_meta.bits_per_sample;
            }

            meta.white_balance_multipliers = raw_meta.cam_mul;
            meta.black_levels = [
                raw_meta.black_levels[0] as u16,
                raw_meta.black_levels[1] as u16,
                raw_meta.black_levels[2] as u16,
                raw_meta.black_levels[3] as u16,
            ];
            meta.white_levels = [
                raw_meta.white_level as u16,
                raw_meta.white_level as u16,
                raw_meta.white_level as u16,
                raw_meta.white_level as u16,
            ];

            let mut mat: Vec<Vec<f32>> = Vec::new();
            for r in 0..3 {
                let mut row = Vec::new();
                for c in 0..3 {
                    row.push(raw_meta.rgb_cam[r][c]);
                }
                mat.push(row);
            }
            meta.color_matrix = mat;
        }

        Ok(meta)
    }

    /// Extract embedded JPEG thumbnail via LibRaw or binary container scan
    pub fn extract_thumbnail(&self) -> Result<Vec<u8>, RawError> {
        let c_path = CString::new(self.file_path.clone())
            .map_err(|e| RawError::DecodeFailed(e.to_string()))?;

        let mut thumb_res: LibRawThumbResult = unsafe { std::mem::zeroed() };
        let ret = unsafe { libraw_wrapper_extract_thumbnail(c_path.as_ptr(), &mut thumb_res) };

        if ret == 0
            && !thumb_res.data.is_null()
            && thumb_res.data_size > 0
            && thumb_res.is_jpeg == 1
        {
            let bytes =
                unsafe { std::slice::from_raw_parts(thumb_res.data, thumb_res.data_size).to_vec() };
            unsafe { libraw_wrapper_free_thumb(&mut thumb_res) };
            return Ok(bytes);
        }

        unsafe { libraw_wrapper_free_thumb(&mut thumb_res) };

        // Fallback to container scan
        crate::raw::thumbnail::extract_embedded_thumbnail(&self.file_path)
    }

    /// Safe isolated decode returning high-precision RGBA16 16-bit linear buffer
    pub fn decode(
        &self,
        quality: DemosaicQuality,
    ) -> Result<(usize, usize, PixelFormat, Vec<u8>, RawMetadata), RawError> {
        let path = Path::new(&self.file_path);
        if !path.exists() {
            return Err(RawError::CorruptFile(format!(
                "File does not exist: {}",
                self.file_path
            )));
        }

        // 1. Get metadata
        let metadata = self.get_metadata()?;

        // 2. Map quality to LibRaw user_qual
        let demosaic_code = match quality {
            DemosaicQuality::Fast => 0,     // Linear
            DemosaicQuality::Balanced => 3, // AHD
            DemosaicQuality::High => 11,    // DHT
        };

        let c_path = CString::new(self.file_path.clone())
            .map_err(|e| RawError::DecodeFailed(e.to_string()))?;

        let mut decoded_img: LibRawDecodedImage = unsafe { std::mem::zeroed() };
        let ret = unsafe {
            libraw_wrapper_decode_16bit(c_path.as_ptr(), demosaic_code, &mut decoded_img)
        };

        if ret != 0 || decoded_img.data.is_null() {
            unsafe { libraw_wrapper_free_image(&mut decoded_img) };
            return Err(RawError::DecodeFailed(format!(
                "LibRaw decode failed with error code: {}",
                ret
            )));
        }

        let width = decoded_img.width as usize;
        let height = decoded_img.height as usize;
        let channels = decoded_img.channels as usize;
        let pixels_count = width * height;

        // Convert LibRaw 16-bit RGB (3 channels) into 16-bit RGBA (4 channels)
        let mut rgba16 = vec![0u16; pixels_count * 4];

        unsafe {
            let u16_ptr = decoded_img.data as *const u16;
            if channels == 3 {
                for i in 0..pixels_count {
                    rgba16[i * 4] = *u16_ptr.add(i * 3);
                    rgba16[i * 4 + 1] = *u16_ptr.add(i * 3 + 1);
                    rgba16[i * 4 + 2] = *u16_ptr.add(i * 3 + 2);
                    rgba16[i * 4 + 3] = 65535;
                }
            } else if channels == 4 {
                std::ptr::copy_nonoverlapping(u16_ptr, rgba16.as_mut_ptr(), pixels_count * 4);
            }
            libraw_wrapper_free_image(&mut decoded_img);
        }

        // Convert u16 buffer to byte slice
        let byte_slice: Vec<u8> = rgba16.iter().flat_map(|val| val.to_le_bytes()).collect();

        Ok((width, height, PixelFormat::RGBA16, byte_slice, metadata))
    }
}
