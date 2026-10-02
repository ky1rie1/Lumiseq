//! Opt-in full-resolution, source-preserving quality evidence, separate from codec coverage.
use super::*;
use crate::assets::{global_asset_registry,NativeImageAsset};

#[test]
#[ignore="requires LUMISEQ_SCENE_MANIFEST and LUMISEQ_SCENE_REPORT_DIR"]
fn full_resolution_scene_quality() {
    let manifest=std::fs::read(std::env::var("LUMISEQ_SCENE_MANIFEST").unwrap()).unwrap();
    let cases:Vec<serde_json::Value>=serde_json::from_slice(&manifest).unwrap();
    let root=std::path::PathBuf::from(std::env::var("LUMISEQ_SCENE_REPORT_DIR").unwrap());
    std::fs::create_dir_all(&root).unwrap();
    let neutral:NativeDevelopSettings=serde_json::from_value(serde_json::json!({
        "exposure":0,"contrast":0,"saturation":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,
        "vibrance":0,"temperature":5500,"tint":0,"white_balance_mode":"as-shot",
        "texture":0,"clarity":0,"dehaze":0,"sharpen_amount":0,"sharpen_radius":1,
        "sharpen_threshold":0,"luma_denoise":0,"chroma_denoise":0
    })).unwrap();
    let mut rows=Vec::new();
    for (index,case) in cases.iter().enumerate() {
        let mode=if case["mode"]=="uncorrected" {types::RawCorrectionMode::Uncorrected} else {Default::default()};
        let decoded=decoder::decode_raw_with_options(&format!("scene_quality_{index}"),case["path"].as_str().unwrap(),DemosaicQuality::High,2,mode).unwrap();
        let id=&decoded.asset_id;
        assert_eq!(decoded.metadata.optical_correction.as_ref().unwrap().mode,mode);
        if mode==types::RawCorrectionMode::Uncorrected {
            let optics=decoded.metadata.optical_correction.as_ref().unwrap();
            assert!(!optics.distortion_applied && !optics.aberration_applied && !optics.shading_applied);
        }
        let stats=global_asset_registry().with_asset(id,|asset|{
            assert_eq!(asset.pixel_format,PixelFormat::RGBA32F);
            let source=linear_source::LinearSource::new(asset).unwrap();
            let mut negative=0usize; let mut headroom=0usize; let mut maximum=f32::NEG_INFINITY;
            for i in 0..decoded.width*decoded.height {
                let pixel=source.pixel(i).unwrap();
                negative+=usize::from(pixel[..3].iter().any(|v|*v<0.0));
                headroom+=usize::from(pixel[..3].iter().any(|v|*v>1.0));
                maximum=maximum.max(pixel[0]).max(pixel[1]).max(pixel[2]);
            }
            serde_json::json!({"negative_pixels":negative,"headroom_pixels":headroom,"maximum":maximum})
        }).unwrap();
        if let Some(dim)=case["dimensions"].as_array() {
            assert_eq!((decoded.width,decoded.height),(dim[0].as_u64().unwrap() as usize,dim[1].as_u64().unwrap() as usize));
        }
        let name=case["name"].as_str().unwrap();
        let format=case["format"].as_str().unwrap_or(if case["sony"]==true {"tiff"} else {"png"});
        let mut settings=neutral.clone();
        if case["sony"]==true {
            let optics=decoded.metadata.optical_correction.as_ref().unwrap();
            assert!(optics.distortion_applied && optics.aberration_applied && optics.shading_applied);
            settings.exposure=1.7;
        }
        let output=root.join(format!("{name}-full.{format}"));
        let profile=if case["sony"]==true {output_profile::OutputProfile::DisplayP3} else {Default::default()};
        export_raw_develop(id,settings,NativeExportOptions{format:format.into(),output_profile:profile,quality:None,width:None,height:None},output.to_str().unwrap()).unwrap();
        let dimensions=image::image_dimensions(&output).unwrap();
        assert_eq!(dimensions,(decoded.width as u32,decoded.height as u32));
        if format=="tiff" {
            let mut reader=tiff::decoder::Decoder::new(std::io::BufReader::new(std::fs::File::open(&output).unwrap())).unwrap();
            assert_eq!(reader.colortype().unwrap(),tiff::ColorType::RGBA(16));
            assert!(!reader.get_tag_u8_vec(tiff::tags::Tag::IccProfile).unwrap().is_empty());
        } else {
            let reader=png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&output).unwrap())).read_info().unwrap();
            assert_eq!(reader.info().bit_depth,png::BitDepth::Sixteen);
            assert!(reader.info().icc_profile.is_some());
        }
        if case["sony"]==true {
            let overview=detail::render_raw_linear_preview(id).unwrap();
            let w=u32::from_le_bytes(overview[4..8].try_into().unwrap()) as usize;
            let h=u32::from_le_bytes(overview[8..12].try_into().unwrap()) as usize;
            let mut regions=vec![("overview".to_owned(),w,h,overview[12..].to_vec())];
            for (label,x,y) in [("tl",0,0),("tr",decoded.width-128,0),("bl",0,decoded.height-128),("br",decoded.width-128,decoded.height-128)] {
                let tile=detail::render_raw_linear_tile(id,x,y,128,128).unwrap();
                regions.push((label.into(),128,128,tile[12..].to_vec()));
            }
            for (label,w,h,buffer) in regions {
                let region_id=format!("scene_quality_{label}");
                if label=="tl" {
                    let mut packet=b"LF32".to_vec(); packet.extend_from_slice(&(w as u32).to_le_bytes()); packet.extend_from_slice(&(h as u32).to_le_bytes()); packet.extend_from_slice(&buffer);
                    std::fs::write(root.join("sony-corner.lf32"),packet).unwrap();
                }
                global_asset_registry().register(NativeImageAsset{id:region_id.clone(),width:w,height:h,pixel_format:PixelFormat::RGBA32F,buffer,metadata:None,ref_count:1,created_at:0});
                for ev in [0.,1.7,4.] {
                    let mut settings=neutral.clone(); settings.exposure=ev;
                    let file=root.join(format!("sony-{label}-ev{ev}.png"));
                    export_raw_develop(&region_id,settings,NativeExportOptions{format:"png".into(),output_profile:Default::default(),quality:None,width:None,height:None},file.to_str().unwrap()).unwrap();
                }
                global_asset_registry().release(&region_id);
            }
        }
        rows.push(serde_json::json!({"name":name,"metadata":decoded.metadata,"stats":stats,"output":output,"dimensions":dimensions,"full_depth":16}));
        global_asset_registry().release(id);
        std::fs::write(root.join("quality.json"),serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
    }
}
