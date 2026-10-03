// src-tauri/src/lib.rs
// Keep Common Controls v6 active in the Rust unit-test executable as in the app.
#[cfg(all(test, windows))]
#[link(name = "lumiseq_test_manifest", kind = "static", modifiers = "+whole-archive")]
unsafe extern "C" {}

pub mod core;
pub mod filesystem;
pub mod raw;
pub mod edit_image;
pub mod color;
pub mod assets;
pub mod security;
pub mod commands;
pub mod mcp;
pub mod clipboard;
pub mod release_check;
// Startup diagnostics exist solely for the real entry point, which is excluded from test builds.
#[cfg(not(test))]
mod diagnostics;

#[cfg(not(test))]
pub fn run() {
    std::panic::set_hook(Box::new(|info| diagnostics::report_fatal(&info.to_string())));
    let res = std::panic::catch_unwind(|| {
        tauri::Builder::default()
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .setup(|_app| {
                // MCP HTTP Server is OFF by default.
                // It is strictly started on-demand via UI or persisted setting.
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                commands::get_system_info,
                commands::decode_edit_source,
                commands::stage_raw_edit_source,
                commands::read_edit_source_tile,
                commands::release_edit_source,
                commands::render_raw_develop_tile,
                commands::begin_edit_export,
                commands::append_edit_export_band,
                commands::finish_edit_export,
                commands::cancel_edit_export,
                commands::inspect_local_file,
                commands::read_local_binary_file,
                commands::write_local_binary_file,
                commands::stage_recovery_source,
                commands::get_app_paths,
                commands::read_text_file,
                commands::write_text_file_atomic,
                commands::list_dir_files,
                commands::delete_file,
                commands::clipboard_read_text,
                commands::clipboard_write_text,
                commands::clipboard_read_image,
                commands::clipboard_write_image,
                commands::get_raw_metadata,
                commands::extract_raw_thumbnail,
                commands::decode_raw_image,
                commands::get_raw_display_tile,
                commands::get_raw_linear_preview,
                commands::get_raw_linear_tile,
                commands::get_raw_linear_sample,
                commands::get_raw_tone_samples,
                commands::get_raw_spatial_analysis,
                commands::cancel_raw_decode,
                commands::release_raw_asset,
                commands::export_raw_develop,
                commands::save_secure_secret,
                commands::get_secure_secret,
                commands::has_secure_secret,
                commands::delete_secure_secret,
                commands::mcp_respond,
                commands::set_mcp_auth_token,
                commands::start_mcp_http_server,
                commands::stop_mcp_http_server,
                commands::get_mcp_server_status,
                commands::get_startup_args,
                commands::write_diagnostic_log,
                commands::reveal_path_in_explorer,
                commands::local_agents::probe_local_agent,
                commands::local_agents::run_local_agent,
                commands::local_agents::cancel_local_agent,
                release_check::check_release,
                release_check::cancel_release_check,
                release_check::open_release_page,
                release_check::get_build_identity,
            ])
        .run(tauri::generate_context!())

            .expect("影序 Studio 启动失败");
    });
    if res.is_err() {
        std::process::exit(1);
    }
}
