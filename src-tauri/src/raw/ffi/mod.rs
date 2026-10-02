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

fn processed_sample_count(width: usize, height: usize, channels: usize, bits: u32) -> Result<usize, RawError> {
    let pixels=width.checked_mul(height).filter(|n|*n>0 && *n<=150_000_000)
        .ok_or_else(||RawError::DecodeFailed("Invalid LibRaw output dimensions".into()))?;
    if bits!=16 || !matches!(channels,1|3|4) {
        return Err(RawError::DecodeFailed("Unexpected LibRaw output precision or color channels".into()));
    }
    Ok(pixels*channels)
}

fn processed_to_rgba16(width: usize, height: usize, channels: usize, bits: u32, samples: &[u16]) -> Result<Vec<u8>, RawError> {
    if samples.len()!=processed_sample_count(width,height,channels,bits)? {
        return Err(RawError::DecodeFailed("Truncated LibRaw output buffer".into()));
    }
    let mut rgba=Vec::with_capacity(width*height*8);
    for pixel in samples.chunks_exact(channels) {
        for c in 0..3 { rgba.extend_from_slice(&pixel[if channels==1 {0} else {c}].to_le_bytes()); }
        // LibRaw's fourth channel is a color plane, never transparency.
        rgba.extend_from_slice(&65535u16.to_le_bytes());
    }
    Ok(rgba)
}

fn native_decode_error(code: i32, make: &str, model: &str) -> RawError {
    match code {
        -200001 => RawError::UnsupportedCamera("Nikon High Efficiency (HE/HE*) NEF compression is not supported by the bundled decoder. Use Lossless Compressed NEF or convert with the camera vendor to a sensor-data DNG.".into()),
        -200002 => RawError::UnsupportedCamera("Floating-point sensor DNG requires a float sensor decoder; refusing integer conversion that would lose HDR precision. Ordinary integer camera RAW/DNG is unaffected.".into()),
        -2 => RawError::UnsupportedCamera(format!("{make} {model}: this RAW encoding is not supported. Use an uncompressed/lossless RAW mode or a sensor-data DNG; an embedded JPEG does not replace RAW decoding.")),
        -100007 | -100012 | -100013 => RawError::OutOfMemory,
        _ => RawError::DecodeFailed(format!("LibRaw decode failed with error code: {code}")),
    }
}

fn camera_to_scene(width: usize, height: usize, channels: usize, bits: u32, samples: &[u16], calibration: &LibRawSceneCalibration) -> Result<Vec<u8>, RawError> {
    if samples.len()!=processed_sample_count(width,height,channels,bits)?
        || !calibration.normalization.is_finite() || calibration.normalization<=0.0
        || calibration.multipliers.iter().any(|v|!v.is_finite() || *v<=0.0)
        || calibration.matrix.iter().flatten().any(|v|!v.is_finite())
        || (channels!=1 && calibration.matrix.iter().flatten().all(|v|*v==0.0)) {
        return Err(RawError::DecodeFailed("Invalid camera-space RAW calibration".into()));
    }
    let optics=scene_optics(width,height,calibration)?;
    let (output_width,output_height)=optics.dimensions();
    let mut rgba=Vec::new();
    rgba.try_reserve_exact(output_width*output_height*16).map_err(|_|RawError::OutOfMemory)?;
    for y in 0..output_height {for x in 0..output_width {
        let mut camera=[0f32;4];
        for c in 0..channels {
            let (sx,sy)=optics.map(x as f32,y as f32,c);
            if sx<0.0 || sy<0.0 || sx>(width-1) as f32 || sy>(height-1) as f32 {
                return Err(RawError::DecodeFailed("Camera optical mapping exceeds available sensor frame".into()));
            }
            let x0=sx.floor() as usize; let y0=sy.floor() as usize;
            let x1=(x0+1).min(width-1); let y1=(y0+1).min(height-1);
            let fx=sx-x0 as f32; let fy=sy-y0 as f32;
            let at=|px,py|samples[(py*width+px)*channels+c] as f32;
            let sample=(at(x0,y0)*(1.0-fx)+at(x1,y0)*fx)*(1.0-fy)
                +(at(x0,y1)*(1.0-fx)+at(x1,y1)*fx)*fy;
            camera[c]=sample/calibration.normalization*optics.shading_gain(sx,sy);
        }
        let rgb: [f32;3] = if channels==1 {[camera[0];3]}
        else {std::array::from_fn(|r| (0..channels).map(|c|camera[c]*calibration.multipliers[c]*calibration.matrix[r][c]).sum())};
        for value in rgb.into_iter().chain(std::iter::once(1.0)) {rgba.extend_from_slice(&value.to_le_bytes());}
    }}
    Ok(rgba)
}

fn scene_optics(width:usize,height:usize,calibration:&LibRawSceneCalibration)->Result<super::optics::OpticalMapping,RawError> {
    let c=&calibration.optics;
    let crop=if c.crop[2]==0 && c.crop[3]==0 {[0,0,width,height]} else {c.crop.map(|v|v as usize)};
    super::optics::OpticalMapping::new(width,height,crop,&c.distortion,&c.aberration,&c.shading)
}

fn apply_correction_mode(calibration:&mut LibRawSceneCalibration,mode:super::types::RawCorrectionMode) {
    if mode==super::types::RawCorrectionMode::Uncorrected {
        calibration.optics.distortion=[0;17];
        calibration.optics.aberration=[0;33];
        calibration.optics.shading=[0;17];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uncorrected_scene_keeps_active_crop_and_float_calibration() {
        let mut calibration=LibRawSceneCalibration {normalization:10000.0,multipliers:[2.,1.,1.,1.],
            matrix:[[1.,0.,0.,0.],[0.,1.,0.,0.],[0.,0.,1.,0.]],optics:unsafe {std::mem::zeroed()}};
        calibration.optics.crop=[1,0,1,1];
        calibration.optics.distortion[0]=2;
        calibration.optics.distortion[1]=100;
        calibration.optics.shading[0]=2;
        calibration.optics.shading[1]=1024;
        apply_correction_mode(&mut calibration,super::super::types::RawCorrectionMode::Uncorrected);
        assert_eq!(scene_optics(2,1,&calibration).unwrap().map(0.,0.,0),(1.,0.));
        let bytes=camera_to_scene(2,1,3,16,&[1,2,3,10000,1000,1],&calibration).unwrap();
        assert_eq!(f32::from_le_bytes(bytes[..4].try_into().unwrap()),2.);
        assert_eq!(calibration.optics.crop,[1,0,1,1]);
    }
    #[test]
    fn camera_conversion_preserves_signed_gamut_headroom_and_sensor_steps() {
        let calibration=LibRawSceneCalibration {
            normalization:10000.0, multipliers:[2.0,1.0,1.5,1.0],
            matrix:[[1.5,-0.5,0.0,0.0],[-0.25,1.25,0.0,0.0],[0.0,0.0,1.0,0.0]],
            optics:unsafe {std::mem::zeroed()},
        };
        let bytes=camera_to_scene(2,1,3,16,&[9000,1000,1,9001,1000,1],&calibration).unwrap();
        let values:Vec<f32>=bytes.chunks_exact(4).map(|b|f32::from_le_bytes(b.try_into().unwrap())).collect();
        assert!((values[0]-2.65).abs()<0.000001);
        assert!((values[1]+0.325).abs()<0.000001);
        assert!((values[2]-0.00015).abs()<0.00000001);
        assert!(values[4]>values[0]);
        assert_eq!(values[3],1.0);
        let gray=camera_to_scene(1,1,1,16,&[5000],&calibration).unwrap();
        assert_eq!(f32::from_le_bytes(gray[..4].try_into().unwrap()),0.5);
        let mut invalid=calibration; invalid.normalization=0.0;
        assert!(camera_to_scene(1,1,3,16,&[1,2,3],&invalid).is_err());
    }
    #[test]
    fn monochrome_output_expands_gray_and_fourth_color_is_not_alpha() {
        assert_eq!(processed_to_rgba16(2,1,1,16,&[1,65535]).unwrap(), [1,1,1,65535,65535,65535,65535,65535].iter().flat_map(|v: &u16|v.to_le_bytes()).collect::<Vec<_>>());
        let rgbg=processed_to_rgba16(1,1,4,16,&[100,200,300,0]).unwrap();
        assert_eq!(&rgbg[6..8],&65535u16.to_le_bytes());
        assert!(processed_to_rgba16(2,1,3,16,&[1,2,3]).is_err());
        assert!(processed_to_rgba16(1,1,3,8,&[1,2,3]).is_err());
        assert!(processed_to_rgba16(usize::MAX,2,3,16,&[]).is_err());
    }
    #[test]
    fn codec_errors_identify_nikon_variant_and_memory_failure() {
        assert!(matches!(native_decode_error(-2,"Unknown","Unknown"),RawError::UnsupportedCamera(_)));
        let error=native_decode_error(-200001,"Nikon","Z6_3");
        assert!(error.to_string().contains("High Efficiency"));
        assert!(error.to_string().contains("Lossless Compressed"));
        assert!(matches!(native_decode_error(-100007,"Sony","camera"),RawError::OutOfMemory));
    }
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
    /// Camera samples are demosaiced before float WB/matrix conversion. The
    /// immutable source RAW remains the authority for sensor-domain reprocessing.
    pub fn decode_scene(&self, quality: DemosaicQuality) -> Result<(usize,usize,PixelFormat,Vec<u8>,RawMetadata),RawError> {
        self.decode_scene_with_mode(quality,super::types::RawCorrectionMode::Camera)
    }

    pub fn decode_scene_with_mode(&self, quality:DemosaicQuality,mode:super::types::RawCorrectionMode)->Result<(usize,usize,PixelFormat,Vec<u8>,RawMetadata),RawError> {
        let mut metadata=self.get_metadata()?;
        let path=CString::new(self.file_path.clone()).map_err(|e|RawError::DecodeFailed(e.to_string()))?;
        let code=match quality {DemosaicQuality::Fast=>0,DemosaicQuality::Balanced=>3,DemosaicQuality::High=>11};
        let mut image:LibRawDecodedImage=unsafe {std::mem::zeroed()};
        let mut calibration:LibRawSceneCalibration=unsafe {std::mem::zeroed()};
        let ret=unsafe {libraw_wrapper_decode_scene(path.as_ptr(),code,&mut image,&mut calibration)};
        let result=(|| {
            if ret!=0 || image.data.is_null() {return Err(native_decode_error(ret,&metadata.camera_make,&metadata.camera_model));}
            let (width,height,channels)=(image.width as usize,image.height as usize,image.channels as usize);
            let count=processed_sample_count(width,height,channels,image.bits_per_channel)?;
            if image.data_size!=count*2 {return Err(RawError::DecodeFailed("Invalid camera-space RAW buffer size".into()));}
            let calibrated=calibration.optics.distortion[0]>0 || calibration.optics.aberration[0]>0 || calibration.optics.shading[0]>0;
            apply_correction_mode(&mut calibration,mode);
            let samples=unsafe {std::slice::from_raw_parts(image.data as *const u16,count)};
            let buffer=camera_to_scene(width,height,channels,image.bits_per_channel,samples,&calibration)?;
            let dimensions=scene_optics(width,height,&calibration)?.dimensions();
            metadata.processing_version=2;
            metadata.width=dimensions.0; metadata.height=dimensions.1;
            metadata.optical_correction=Some(crate::raw::types::RawOpticalCorrection {
                mode,provenance:if calibrated {"sony-embedded-tables"} else {"camera-active-area-only"}.into(),
                source_width:width,source_height:height,
                active_crop:if calibration.optics.crop[2]>0 {calibration.optics.crop.map(|v|v as usize)} else {[0,0,width,height]},
                distortion_applied:calibration.optics.distortion[0]>0,
                aberration_applied:calibration.optics.aberration[0]>0,
                shading_applied:calibration.optics.shading[0]>0,
            });
            Ok((dimensions.0,dimensions.1,PixelFormat::RGBA32F,buffer,metadata))
        })();
        unsafe {libraw_wrapper_free_image(&mut image);}
        result
    }
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
            return Err(native_decode_error(ret,&metadata.camera_make,&metadata.camera_model));
        }

        let width = decoded_img.width as usize;
        let height = decoded_img.height as usize;
        let channels = decoded_img.channels as usize;
        // Validate the shape before constructing an unsafe view of the native allocation.
        let result=(|| {
            let count=processed_sample_count(width,height,channels,decoded_img.bits_per_channel)?;
            if decoded_img.data_size!=count*2 { return Err(RawError::DecodeFailed("Invalid LibRaw output buffer size".into())); }
            let samples=unsafe { std::slice::from_raw_parts(decoded_img.data as *const u16,count) };
            processed_to_rgba16(width,height,channels,decoded_img.bits_per_channel,samples)
        })();
        unsafe { libraw_wrapper_free_image(&mut decoded_img); }
        let byte_slice=result?;

        Ok((width, height, PixelFormat::RGBA16, byte_slice, metadata))
    }
}
