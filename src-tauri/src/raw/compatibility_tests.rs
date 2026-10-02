//! Opt-in real-camera corpus. Inputs and generated images are never part of the release.
use super::{decode_raw, DemosaicQuality, NativeDevelopSettings, NativeExportOptions};
use crate::assets::global_asset_registry;

#[test]
#[ignore = "requires LUMISEQ_RAW_CORPUS and LUMISEQ_RAW_REPORT_DIR"]
fn real_camera_raw_compatibility_matrix() {
    let manifest = std::env::var("LUMISEQ_RAW_CORPUS").expect("RAW corpus manifest");
    let root = std::path::PathBuf::from(std::env::var("LUMISEQ_RAW_REPORT_DIR").expect("report directory"));
    std::fs::create_dir_all(&root).unwrap();
    let keep_previews=std::env::var("LUMISEQ_RAW_KEEP_PREVIEWS").as_deref()==Ok("1");
    let manifest_bytes=std::fs::read(manifest).unwrap();
    let samples: Vec<serde_json::Value> = serde_json::from_slice(manifest_bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&manifest_bytes)).unwrap();
    assert!(!samples.is_empty(), "No camera samples selected");
    let settings: NativeDevelopSettings = serde_json::from_value(serde_json::json!({
        "exposure":0,"contrast":0,"saturation":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,
        "vibrance":0,"temperature":5500,"tint":0,"white_balance_mode":"as-shot",
        "texture":0,"clarity":0,"dehaze":0,"sharpen_amount":0,"sharpen_radius":1,
        "sharpen_threshold":0,"luma_denoise":0,"chroma_denoise":0
    })).unwrap();
    let mut rows = Vec::new();
    for (index, sample) in samples.iter().enumerate() {
        let started = std::time::Instant::now();
        let job = format!("corpus_{index}");
        let path = sample["path"].as_str().expect("sample path");
        let mut owned_asset = None;
        let result = (|| -> Result<serde_json::Value, String> {
            let decoded = decode_raw(&job, path, DemosaicQuality::Balanced).map_err(|e| e.to_string())?;
            owned_asset = Some(decoded.asset_id.clone());
            let png = decoded.preview_png_bytes.ok_or("Missing overview PNG")?;
            let overview = image::load_from_memory(&png).map_err(|e|e.to_string())?;
            let linear = super::detail::render_raw_linear_preview(&decoded.asset_id).map_err(|e|e.to_string())?;
            let w = u32::from_le_bytes(linear[4..8].try_into().unwrap());
            let h = u32::from_le_bytes(linear[8..12].try_into().unwrap());
            if (w,h) != (overview.width(),overview.height()) { return Err("Linear/PNG overview dimensions differ".into()); }
            if &linear[..4]!=b"LF32" {return Err("Production RAW did not use float source".into());}
            let floats:Vec<f32>=linear[12..].chunks_exact(4).map(|b|f32::from_le_bytes(b.try_into().unwrap())).collect();
            if !floats.chunks_exact(4).any(|p|p[3]>0.0) {return Err("Decoded source is entirely transparent".into());}
            if !floats.chunks_exact(4).any(|p|p[..3].iter().any(|v|*v!=0.0)) {return Err("Decoded source is entirely black".into());}
            let tw = decoded.width.min(256); let th = decoded.height.min(128);
            let tile = super::detail::render_raw_linear_tile(&decoded.asset_id,0,0,tw,th).map_err(|e|e.to_string())?;
            if tile.len()!=12+tw*th*16 { return Err("Native tile length mismatch".into()); }
            let folder = root.join(format!("{index:02}")); std::fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
            let display_tile = super::detail::render_raw_display_tile(&decoded.asset_id,0,0,tw,th).map_err(|e|e.to_string())?;
            if keep_previews {
                std::fs::write(folder.join("overview.lf32"), &linear).map_err(|e|e.to_string())?;
                std::fs::write(folder.join("overview.png"), &png).map_err(|e|e.to_string())?;
                std::fs::write(folder.join("corner.lf32"), &tile).map_err(|e|e.to_string())?;
                std::fs::write(folder.join("corner.png"), &display_tile).map_err(|e|e.to_string())?;
            }
            image::load_from_memory(&display_tile).map_err(|e|e.to_string())?;
            let mut adjusted = settings.clone(); adjusted.exposure = 4.;
            let output = folder.join("exposure-plus4.png");
            super::export_raw_develop(&decoded.asset_id,adjusted,NativeExportOptions{output_profile:Default::default(),
                format:"png".into(),quality:None,width:Some(128),height:Some((decoded.height*128/decoded.width).max(1) as u32)
            },output.to_str().unwrap()).map_err(|e|e.to_string())?;
            let exported = image::open(output).map_err(|e|e.to_string())?;
            if exported.width()!=128 || exported.color()!=image::ColorType::Rgba16 { return Err("PNG delivery dimensions or precision incorrect".into()); }
            Ok(serde_json::json!({"make":decoded.metadata.camera_make,"model":decoded.metadata.camera_model,
                "width":decoded.width,"height":decoded.height,"preview_width":w,"preview_height":h,
                "linear_tile":[tw,th],"export_depth":16,"export_exposure":4,"passed":true}))
        })();
        if let Some(id)=owned_asset { global_asset_registry().release(&id); }
        let mut row = result.unwrap_or_else(|error|serde_json::json!({"passed":false,"error":error}));
        row["brand"] = sample["brand"].clone(); row["extension"] = sample["extension"].clone();
        row["index"] = serde_json::json!(index); row["milliseconds"] = serde_json::json!(started.elapsed().as_millis());
        println!("{}",row); rows.push(row);
        std::fs::write(root.join("matrix.json"),serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
    }
    assert!(rows.iter().all(|r| r["passed"]==true), "Some RAW samples failed; inspect matrix.json");
}
