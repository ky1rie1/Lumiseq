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

fn main() {
    // Fixed localhost pages only; this binary cannot be used to browse arbitrary URLs.
    let url = match std::env::var("LUMISEQ_GPU_CASE").as_deref() {
        Ok("raw") => "http://localhost:5173/integration/real-raw-gpu-validation.html",
        Ok("raw-precision") => "http://localhost:5173/integration/raw-linear-precision.html",
        Ok("raw-v2") => "http://localhost:5173/integration/raw-quality-v2-validation.html",
        Ok("workbench") => "http://localhost:5173/integration/workbench-validation.html",
        _ => "http://localhost:5173/integration/spatial-quality-validation.html",
    };
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![complete_quality_probe,
            lumiseq_lib::commands::get_raw_linear_preview,
            lumiseq_lib::commands::get_raw_linear_tile])
        .setup(move|app|{
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
                            if(value?.complete||++n>200){clearInterval(tick);
                                window.__TAURI_INTERNALS__.invoke('complete_quality_probe',{report:JSON.stringify(value?.complete?value:{complete:true,passed:false,errors:['WebView probe timed out']})});
                            }
                        },150);
                    });
                "#).build()?;
            Ok(())
        })
        .run(context).expect("Quality WebView probe failed");
}
