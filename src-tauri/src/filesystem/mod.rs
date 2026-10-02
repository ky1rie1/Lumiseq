// src-tauri/src/filesystem/mod.rs
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalFileInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at_ms: Option<u64>,
    pub is_raw: bool,
}

pub fn inspect_file(file_path: &str) -> Result<LocalFileInfo, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let is_raw = is_raw_extension(&ext);

    Ok(LocalFileInfo {
        file_name,
        path: file_path.to_string(),
        size_bytes: metadata.len(),
        modified_at_ms: metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as u64),
        is_raw,
    })
}

pub fn is_raw_extension(extension: &str) -> bool {
    static FORMATS: std::sync::OnceLock<std::collections::HashSet<String>> = std::sync::OnceLock::new();
    FORMATS.get_or_init(|| serde_json::from_str(include_str!("../../../src/config/rawFormats.json"))
        .expect("Invalid bundled RAW extension catalog")).contains(&extension.to_ascii_lowercase())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPathsDto {
    pub roaming_data_dir: String,
    pub local_data_dir: String,
    pub cache_dir: String,
    pub logs_dir: String,
    pub temp_dir: String,
    pub models_dir: String,
    pub presets_dir: String,
    pub recent_projects_file: String,
}

pub fn get_app_paths() -> Result<AppPathsDto, String> {
    let roaming = if let Some(appdata) = std::env::var_os("APPDATA") {
        std::path::PathBuf::from(appdata).join("AI-Creative-Studio")
    } else if let Some(userprofile) = std::env::var_os("USERPROFILE") {
        std::path::PathBuf::from(userprofile).join("AppData").join("Roaming").join("AI-Creative-Studio")
    } else {
        std::path::PathBuf::from(".ai-creative-studio-roaming")
    };

    let local = if let Some(localappdata) = std::env::var_os("LOCALAPPDATA") {
        std::path::PathBuf::from(localappdata).join("AI-Creative-Studio")
    } else if let Some(userprofile) = std::env::var_os("USERPROFILE") {
        std::path::PathBuf::from(userprofile).join("AppData").join("Local").join("AI-Creative-Studio")
    } else {
        std::path::PathBuf::from(".ai-creative-studio-local")
    };

    let cache_dir = local.join("runtime-cache");
    let logs_dir = local.join("logs");
    let temp_dir = local.join("temp");
    let models_dir = local.join("models");
    let presets_dir = roaming.join("presets");
    let recent_projects_file = roaming.join("recent.json");

    let _ = std::fs::create_dir_all(&roaming);
    let _ = std::fs::create_dir_all(&presets_dir);
    let _ = std::fs::create_dir_all(&local);
    let _ = std::fs::create_dir_all(&cache_dir);
    let _ = std::fs::create_dir_all(&logs_dir);
    let _ = std::fs::create_dir_all(&temp_dir);
    let _ = std::fs::create_dir_all(&models_dir);

    Ok(AppPathsDto {
        roaming_data_dir: roaming.to_string_lossy().into_owned(),
        local_data_dir: local.to_string_lossy().into_owned(),
        cache_dir: cache_dir.to_string_lossy().into_owned(),
        logs_dir: logs_dir.to_string_lossy().into_owned(),
        temp_dir: temp_dir.to_string_lossy().into_owned(),
        models_dir: models_dir.to_string_lossy().into_owned(),
        presets_dir: presets_dir.to_string_lossy().into_owned(),
        recent_projects_file: recent_projects_file.to_string_lossy().into_owned(),
    })
}

pub fn read_text_file(file_path: &str) -> Result<String, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }
    fs::read_to_string(path).map_err(|e| format!("Failed to read file {}: {}", file_path, e))
}

pub fn write_text_file_atomic(file_path: &str, content: &str) -> Result<(), String> {
    let path = Path::new(file_path);
    atomic_write(path, content.as_bytes())
}

pub fn list_dir_files(dir_path: &str, extension_filter: Option<String>) -> Result<Vec<String>, String> {
    let path = Path::new(dir_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(ext) = &extension_filter {
                if p.extension().and_then(|x| x.to_str()).map(|s| s.eq_ignore_ascii_case(ext)).unwrap_or(false) {
                    files.push(p.to_string_lossy().into_owned());
                }
            } else {
                files.push(p.to_string_lossy().into_owned());
            }
        }
    }
    files.sort();
    Ok(files)
}

pub fn delete_file(file_path: &str) -> Result<bool, String> {
    let path = Path::new(file_path);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn write_diagnostic_log(category: &str, message: &str) -> Result<(), String> {
    use std::io::Write;
    let paths = get_app_paths()?;
    let logs_dir = std::path::Path::new(&paths.logs_dir);
    let _ = fs::create_dir_all(logs_dir);

    let safe_category: String = category.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    let safe_category = if safe_category.is_empty() { "app".to_string() } else { safe_category };
    let log_file = logs_dir.join(format!("{}.log", safe_category));

    if fs::metadata(&log_file).is_ok_and(|meta| meta.len() > 1_048_576) {
        let _ = fs::rename(&log_file, log_file.with_extension("previous.log"));
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;

    writeln!(file, "[{:?}] {}", std::time::SystemTime::now(), message)
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn reveal_path_in_explorer(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let p = std::path::Path::new(path);
        if !p.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
        if p.is_dir() {
            Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;
        } else {
            Command::new("explorer").arg(format!("/select,{}", path)).spawn().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}
#[cfg(test)]
mod atomic_tests {
    #[test]
    fn native_inspection_recognizes_additional_camera_raw_formats() {
        let dir = std::env::temp_dir().join(format!("lumiseq-raw-formats-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["camera.PEF", "camera.3FR", "camera.IIQ", "camera.X3F", "camera.NRW", "camera.SRW"] {
            let path = dir.join(name);
            std::fs::write(&path, b"format-routing-fixture").unwrap();
            assert!(super::inspect_file(path.to_str().unwrap()).unwrap().is_raw, "{name}");
            std::fs::remove_file(path).unwrap();
        }
        std::fs::remove_dir(dir).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn locked_destination_preserves_previous_contents_and_cleans_temp() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = std::env::temp_dir().join(format!("studio-atomic-locked-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("project.aistudio");
        std::fs::write(&target,b"previous").unwrap();
        let locked = std::fs::OpenOptions::new().read(true).share_mode(0).open(&target).unwrap();
        assert!(super::atomic_write(&target,b"replacement").is_err());
        drop(locked);
        assert_eq!(std::fs::read(&target).unwrap(),b"previous");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(),1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn replaces_complete_file_and_preserves_old_on_failed_write() {
        let dir = std::env::temp_dir().join(format!("studio-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("project.aistudio");
        std::fs::write(&target, b"old").unwrap();
        super::atomic_write(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(super::atomic_write(&target, b"").is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn app_paths_generates_valid_directories_and_files() {
        let paths = super::get_app_paths().unwrap();
        assert!(paths.roaming_data_dir.contains("AI-Creative-Studio"));
        assert!(paths.local_data_dir.contains("AI-Creative-Studio"));
        assert!(paths.presets_dir.ends_with("presets"));
        assert!(paths.recent_projects_file.ends_with("recent.json"));
    }
    #[test]
    fn atomic_text_and_dir_listing_workflow() {
        let dir = std::env::temp_dir().join(format!("studio-text-ops-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file1 = dir.join("test1.json");
        let file2 = dir.join("test2.txt");
        super::write_text_file_atomic(file1.to_str().unwrap(), "{\"hello\":\"world\"}").unwrap();
        super::write_text_file_atomic(file2.to_str().unwrap(), "plain text").unwrap();

        let read_back = super::read_text_file(file1.to_str().unwrap()).unwrap();
        assert_eq!(read_back, "{\"hello\":\"world\"}");

        let json_files = super::list_dir_files(dir.to_str().unwrap(), Some("json".to_string())).unwrap();
        assert_eq!(json_files.len(), 1);
        assert!(json_files[0].ends_with("test1.json"));

        let deleted = super::delete_file(file1.to_str().unwrap()).unwrap();
        assert!(deleted);
        assert!(!file1.exists());

        std::fs::remove_dir_all(dir).unwrap();
    }
}

/// Flush a sibling temporary file, then atomically replace the destination.
pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    if bytes.is_empty() { return Err("Cannot write empty output".into()); }
    let parent = target.parent().ok_or("Missing output directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".studio-{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        atomic_replace(&temporary, target)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}
#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" { fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32; }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH. Never delete the old file first.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
    Ok(())
}
#[cfg(not(windows))]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), String> { fs::rename(from, to).map_err(|e| e.to_string()) }
