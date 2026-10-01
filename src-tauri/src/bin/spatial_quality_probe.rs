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
        Ok("workbench") => "http://localhost:5173/integration/workbench-validation.html",
        _ => "http://localhost:5173/integration/spatial-quality-validation.html",
    };
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![complete_quality_probe])
        .setup(move|app|{
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
