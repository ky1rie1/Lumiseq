//! Opt-in development verification in the application's actual WebView2.
//! Not shipped or compiled in the ordinary release binary.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[tauri::command]
fn complete_quality_probe(app: tauri::AppHandle, report: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&report).map_err(|e| e.to_string())?;
    let destination = std::env::var("LUMISEQ_GPU_REPORT").map_err(|e| e.to_string())?;
    std::fs::write(destination, &report).map_err(|e| e.to_string())?;
    app.exit(if value["passed"].as_bool() == Some(true) {
        0
    } else {
        1
    });
    Ok(())
}

#[tauri::command]
fn quality_probe_inputs() -> Result<serde_json::Value, String> {
    let report = std::path::PathBuf::from(std::env::var("LUMISEQ_GPU_REPORT").map_err(|e| e.to_string())?);
    Ok(serde_json::json!({"reportDir": report.parent(),
        "rawPath": std::env::var("LUMISEQ_PROBE_RAW").ok(),
        "rasterPath": std::env::var("LUMISEQ_PROBE_RASTER").ok()}))
}

#[tauri::command]
async fn read_quality_input(kind: String) -> Result<tauri::ipc::Response, String> {
    let variable = match kind.as_str() { "raw" => "LUMISEQ_PROBE_RAW", "raster" => "LUMISEQ_PROBE_RASTER", _ => return Err("Unknown probe input".into()) };
    let path = std::env::var(variable).map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 * 1024 { return Err("Probe input too large".into()); }
    Ok(tauri::ipc::Response::new(bytes))
}

fn main() {
    // Fixed localhost pages only; this binary cannot be used to browse arbitrary URLs.
    let url = match std::env::var("LUMISEQ_GPU_CASE").as_deref() {
        Ok("raw") => "http://localhost:5173/integration/real-raw-gpu-validation.html",
        Ok("raw-precision") => "http://localhost:5173/integration/raw-linear-precision.html",
        Ok("raw-v2") => "http://localhost:5173/integration/raw-quality-v2-validation.html",
        Ok("workbench") => "http://localhost:5173/integration/workbench-validation.html",
        Ok("edit-float") => "http://localhost:5173/integration/float-editor-validation.html",
        _ => "http://localhost:5173/integration/spatial-quality-validation.html",
    };
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![complete_quality_probe, quality_probe_inputs, read_quality_input,
            lumiseq_lib::commands::decode_edit_source,
            lumiseq_lib::commands::stage_raw_edit_source,
            lumiseq_lib::commands::read_edit_source_tile,
            lumiseq_lib::commands::release_edit_source,
            lumiseq_lib::commands::render_raw_develop_tile,
            lumiseq_lib::commands::begin_edit_export,
            lumiseq_lib::commands::append_edit_export_band,
            lumiseq_lib::commands::finish_edit_export,
            lumiseq_lib::commands::cancel_edit_export,
            lumiseq_lib::commands::decode_raw_image,
            lumiseq_lib::commands::get_raw_metadata,
            lumiseq_lib::commands::get_raw_tone_samples,
            lumiseq_lib::commands::get_raw_spatial_analysis,
            lumiseq_lib::commands::export_raw_develop,
            lumiseq_lib::commands::release_raw_asset,
            lumiseq_lib::commands::get_app_paths,
            lumiseq_lib::commands::delete_file,
            lumiseq_lib::commands::write_local_binary_file,
            lumiseq_lib::commands::read_local_binary_file,
            lumiseq_lib::commands::get_raw_linear_preview,
            lumiseq_lib::commands::get_raw_linear_tile])
        .setup(move|app|{
            if std::env::var("LUMISEQ_GPU_CASE").as_deref() == Ok("edit-float") {
                let report = std::path::PathBuf::from(std::env::var("LUMISEQ_GPU_REPORT")?);
                let root = report.parent().ok_or("Report directory missing")?;
                std::fs::create_dir_all(root)?;
                let path = root.join("float-editor-input.png");
                let options = serde_json::from_value(serde_json::json!({"width":8,"height":2,"format":"png","quality":1,"output_profile":"srgb"}))?;
                let data: Vec<f32> = (0..16).flat_map(|i| {
                    let linear = lumiseq_lib::color::transform::srgb_to_linear((32768 + i % 8) as f32 / 65535.0);
                    [linear, linear, linear, 1.0]
                }).collect();
                let job = "quality-float-input";
                lumiseq_lib::edit_image::begin_export(job, path.to_str().ok_or("Invalid input path")?, options)?;
                lumiseq_lib::edit_image::append_export(job, 0, lumiseq_lib::edit_image::packet(8, 2, &data))?;
                lumiseq_lib::edit_image::finish_export(job)?;
                std::env::set_var("LUMISEQ_PROBE_RASTER", path);
            }
            if std::env::var("LUMISEQ_GPU_CASE").as_deref()==Ok("raw-precision") {
                let buffer=[0u16,1,10,19,200,500,1000,2000].into_iter()
                    .flat_map(|v|[v,v,v,65535]).flat_map(u16::to_le_bytes).collect();
                lumiseq_lib::assets::global_asset_registry().register(lumiseq_lib::assets::NativeImageAsset{
                    id:"quality-raw-linear".into(),width:4,height:2,pixel_format:lumiseq_lib::raw::PixelFormat::RGBA16,
                    buffer,metadata:None,ref_count:1,created_at:0,
                });
                let buffer=[-0.125f32,1.5,0.000001,1.,1.0001234,0.25,0.5,1.].into_iter().flat_map(f32::to_le_bytes).collect();
                lumiseq_lib::assets::global_asset_registry().register(lumiseq_lib::assets::NativeImageAsset{
                    id:"quality-raw-float".into(),width:2,height:1,pixel_format:lumiseq_lib::raw::PixelFormat::RGBA32F,
                    buffer,metadata:None,ref_count:1,created_at:0,
                });
            }
            tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::External(url.parse()?))
                .inner_size(1440.0, 900.0)
                .visible(false)
                .initialization_script(r#"
                    window.addEventListener('DOMContentLoaded',()=>{
                        let n=0;const tick=setInterval(()=>{
                            let value;try{value=JSON.parse(document.querySelector('#report')?.textContent||'');}catch{}
                            if(value?.complete||++n>2400){clearInterval(tick);
                                window.__TAURI_INTERNALS__.invoke('complete_quality_probe',{report:JSON.stringify(value?.complete?value:{complete:true,passed:false,errors:['WebView probe timed out']})});
                            }
                        },150);
                    });
                "#).build()?;
            Ok(())
        })
        .run(context).expect("Quality WebView probe failed");
}
