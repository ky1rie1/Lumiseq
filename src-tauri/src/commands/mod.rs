// src-tauri/src/commands/mod.rs
use crate::core::system::{self, SystemInfo};
use crate::filesystem::{self, LocalFileInfo};
use crate::raw::{
    extract_embedded_thumbnail, read_metadata, DecodeJobTracker, DemosaicQuality,
    NativeDevelopSettings, NativeExportOptions, RawDecodeResult, RawMetadata,
};
use crate::security;
use std::fs;

pub mod local_agents;

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    system::get_system_info()
}

#[tauri::command]
pub fn inspect_local_file(path: String) -> Result<LocalFileInfo, String> {
    filesystem::inspect_file(&path)
}

#[tauri::command]
pub fn read_local_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Writes an exported image to the path the user chose in the native save dialog.
/// Without this the desktop application reported a successful export while nothing reached disk.
#[tauri::command]
pub fn write_local_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("导出失败：没有选择保存位置。".to_string());
    }
    let target = std::path::Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("导出失败：无法创建目录 {}。{}", parent.display(), e))?;
        }
    }
    filesystem::atomic_write(target, &bytes).map_err(|e| {
        format!(
            "导出失败：无法写入 {}。请确认该文件夹可写、文件未被其他程序占用后重试。{}",
            path, e
        )
    })
}

#[tauri::command]
pub fn get_raw_metadata(path: String) -> Result<RawMetadata, String> {
    read_metadata(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn extract_raw_thumbnail(path: String) -> Result<Vec<u8>, String> {
    extract_embedded_thumbnail(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn decode_raw_image(
    job_id: String,
    path: String,
    quality: Option<DemosaicQuality>,
    processing_version: Option<u8>,
    correction_mode: Option<crate::raw::types::RawCorrectionMode>,
) -> Result<RawDecodeResult, String> {
    let q = quality.unwrap_or(DemosaicQuality::Balanced);
    tauri::async_runtime::spawn_blocking(move||crate::raw::decoder::decode_raw_with_options(&job_id,&path,q,processing_version.unwrap_or(2),correction_mode.unwrap_or_default()))
        .await.map_err(|e|e.to_string())?.map_err(|e|e.to_string())
}

#[tauri::command]
pub fn get_raw_display_tile(asset_id: String, x: usize, y: usize, width: usize, height: usize) -> Result<Vec<u8>, String> {
    crate::raw::detail::render_raw_display_tile(&asset_id, x, y, width, height).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_raw_linear_preview(asset_id: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || crate::raw::detail::render_raw_linear_preview(&asset_id))
        .await.map_err(|e| format!("RAW linear preview worker failed: {e}"))?.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_raw_linear_tile(asset_id: String, x: usize, y: usize, width: usize, height: usize) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || crate::raw::detail::render_raw_linear_tile(&asset_id, x, y, width, height))
        .await.map_err(|e| format!("RAW linear tile worker failed: {e}"))?.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn get_raw_linear_sample(asset_id: String) -> Result<Vec<[f32;3]>, String> {
    crate::raw::auto_white_balance::sample_raw_linear_rgb(&asset_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cancel_raw_decode(job_id: String) -> Result<(), String> {
    DecodeJobTracker::cancel_job(&job_id);
    Ok(())
}

#[tauri::command]
pub async fn get_raw_spatial_analysis(asset_id:String,settings:NativeDevelopSettings)->Result<crate::raw::RawSpatialAnalysis,String> {
    tauri::async_runtime::spawn_blocking(move||crate::raw::analyze_raw_spatial(&asset_id,&settings).map_err(|e|e.to_string()))
        .await.map_err(|e|format!("RAW spatial analysis worker failed: {e}"))?
}

#[tauri::command]
pub async fn export_raw_develop(
    asset_id: String,
    settings: NativeDevelopSettings,
    options: NativeExportOptions,
    output_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::raw::export_raw_develop(&asset_id, settings, options, &output_path)
            .map_err(|e| e.to_string())
    }).await.map_err(|e| format!("RAW export worker failed: {e}"))?
}

// === Security Vault Commands ===

#[tauri::command]
pub fn save_secure_secret(key_id: String, secret: String) -> Result<(), String> {
    security::save_secret(&key_id, &secret)
}

#[tauri::command]
pub fn get_secure_secret(key_id: String) -> Result<Option<String>, String> {
    security::get_secret(&key_id)
}

#[tauri::command]
pub fn has_secure_secret(key_id: String) -> Result<bool, String> {
    security::has_secret(&key_id)
}

#[tauri::command]
pub fn delete_secure_secret(key_id: String) -> Result<bool, String> {
    security::delete_secret(&key_id)
}

// === MCP Server Commands ===

#[tauri::command]
pub fn mcp_respond(id: String, response: String) -> Result<bool, String> {
    Ok(crate::mcp::McpServerManager::global().complete_request(&id, response))
}

#[tauri::command]
pub fn set_mcp_auth_token(token: String) -> Result<(), String> {
    crate::mcp::McpServerManager::global().set_auth_token(token)
}

#[tauri::command]
pub fn start_mcp_http_server(
    app: tauri::AppHandle,
    port: Option<u16>,
    port_mode: Option<String>,
    bind_address: Option<String>,
) -> Result<crate::mcp::McpServerStatusDto, String> {
    crate::mcp::McpServerManager::global().start_server(app, port, port_mode, bind_address)
}

#[tauri::command]
pub fn stop_mcp_http_server() -> Result<crate::mcp::McpServerStatusDto, String> {
    crate::mcp::McpServerManager::global().stop_server()
}

#[tauri::command]
pub fn get_mcp_server_status() -> Result<crate::mcp::McpServerStatusDto, String> {
    Ok(crate::mcp::McpServerManager::global().get_status())
}
/// Restore embedded RAW bytes to an application-owned file for the native decoder.
#[tauri::command]
pub fn stage_recovery_source(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let extension = std::path::Path::new(&file_name).extension().and_then(|x| x.to_str()).unwrap_or("raw").to_ascii_lowercase();
    if !filesystem::is_raw_extension(&extension) { return Err("Unsupported recovery source extension".into()); }
    let base = std::env::var_os("LOCALAPPDATA").ok_or("Missing local application data directory")?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let path = std::path::PathBuf::from(base).join("AI Creative Studio").join("recovery-sources").join(format!("{}-{}.{}", std::process::id(), stamp, extension));
    filesystem::atomic_write(&path, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Drops only the decoded asset reference owned by the requesting frontend job.
#[tauri::command]
pub fn release_raw_asset(asset_id: String) {
    crate::assets::global_asset_registry().release(&asset_id);
}

// === Native AppPaths & Storage Commands ===

#[tauri::command]
pub fn get_app_paths() -> Result<filesystem::AppPathsDto, String> {
    filesystem::get_app_paths()
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    filesystem::read_text_file(&path)
}

#[tauri::command]
pub fn write_text_file_atomic(path: String, content: String) -> Result<(), String> {
    filesystem::write_text_file_atomic(&path, &content)
}

#[tauri::command]
pub fn list_dir_files(dir_path: String, extension_filter: Option<String>) -> Result<Vec<String>, String> {
    filesystem::list_dir_files(&dir_path, extension_filter)
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<bool, String> {
    filesystem::delete_file(&path)
}

// === Native Clipboard Commands ===

#[tauri::command]
pub fn clipboard_read_text() -> Result<String, String> {
    crate::clipboard::read_text()
}

#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    crate::clipboard::write_text(text)
}

#[tauri::command]
pub fn clipboard_read_image() -> Result<Option<crate::clipboard::ClipboardImageDto>, String> {
    crate::clipboard::read_image()
}

#[tauri::command]
pub fn clipboard_write_image(width: usize, height: usize, rgba_bytes: Vec<u8>) -> Result<(), String> {
    crate::clipboard::write_image(width, height, rgba_bytes)
}

// === Windows Startup CLI Arguments ===

#[tauri::command]
pub fn get_startup_args() -> Result<Vec<String>, String> {
    Ok(std::env::args().skip(1).collect())
}

// === Diagnostic & Shell Commands ===

#[tauri::command]
pub fn write_diagnostic_log(category: String, message: String) -> Result<(), String> {
    filesystem::write_diagnostic_log(&category, &message)
}

#[tauri::command]
pub fn reveal_path_in_explorer(path: String) -> Result<(), String> {
    filesystem::reveal_path_in_explorer(&path)
}
