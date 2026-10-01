// src-tauri/src/security/vault.rs
//! Windows DPAPI-backed secure credential vault for API keys.
//! Securely stores provider secrets tied to the current Windows user identity.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

#[cfg(target_os = "windows")]
mod win_dpapi {
    use std::ptr;

    #[repr(C)]
    struct DATA_BLOB {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DATA_BLOB,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DATA_BLOB,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DATA_BLOB,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const DATA_BLOB,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DATA_BLOB,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DATA_BLOB,
        ) -> i32;

        fn LocalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        let in_blob = DATA_BLOB {
            cb_data: data.len() as u32,
            pb_data: data.as_ptr() as *mut u8,
        };
        let mut out_blob = DATA_BLOB {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let res = unsafe {
            CryptProtectData(
                &in_blob,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut out_blob,
            )
        };

        if res == 0 || out_blob.pb_data.is_null() {
            return Err("Windows DPAPI CryptProtectData failed".to_string());
        }

        let slice = unsafe {
            std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize).to_vec()
        };
        unsafe { LocalFree(out_blob.pb_data as *mut std::ffi::c_void) };
        Ok(slice)
    }

    pub fn decrypt(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let in_blob = DATA_BLOB {
            cb_data: cipher.len() as u32,
            pb_data: cipher.as_ptr() as *mut u8,
        };
        let mut out_blob = DATA_BLOB {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let res = unsafe {
            CryptUnprotectData(
                &in_blob,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut out_blob,
            )
        };

        if res == 0 || out_blob.pb_data.is_null() {
            return Err("Windows DPAPI CryptUnprotectData failed".to_string());
        }

        let slice = unsafe {
            std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize).to_vec()
        };
        unsafe { LocalFree(out_blob.pb_data as *mut std::ffi::c_void) };
        Ok(slice)
    }
}

#[cfg(not(target_os = "windows"))]
mod win_dpapi {
    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.iter().map(|b| b ^ 0xAA).collect())
    }
    pub fn decrypt(cipher: &[u8]) -> Result<Vec<u8>, String> {
        Ok(cipher.iter().map(|b| b ^ 0xAA).collect())
    }
}

fn vault_file_path() -> PathBuf {
    let base = dirs_fallback();
    let dir = base.join(".ai-creative-studio");
    let _ = fs::create_dir_all(&dir);
    dir.join("vault.bin")
}

fn dirs_fallback() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata)
    } else if let Ok(home) = std::env::var("USERPROFILE") {
        PathBuf::from(home)
    } else {
        PathBuf::from(".")
    }
}

fn memory_cache() -> &'static RwLock<HashMap<String, String>> {
    static CACHE: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn save_secret(key_id: &str, secret: &str) -> Result<(), String> {
    {
        let mut cache = memory_cache().write().unwrap();
        cache.insert(key_id.to_string(), secret.to_string());
    }

    let path = vault_file_path();
    let mut store: HashMap<String, String> = read_encrypted_store(&path).unwrap_or_default();
    store.insert(key_id.to_string(), secret.to_string());

    let json_bytes = serde_json::to_vec(&store).map_err(|e| e.to_string())?;
    let encrypted = win_dpapi::encrypt(&json_bytes)?;
    fs::write(path, encrypted).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_secret(key_id: &str) -> Result<Option<String>, String> {
    {
        let cache = memory_cache().read().unwrap();
        if let Some(val) = cache.get(key_id) {
            return Ok(Some(val.clone()));
        }
    }

    let path = vault_file_path();
    if !path.exists() {
        return Ok(None);
    }

    let store = read_encrypted_store(&path)?;
    if let Some(secret) = store.get(key_id) {
        let mut cache = memory_cache().write().unwrap();
        cache.insert(key_id.to_string(), secret.clone());
        Ok(Some(secret.clone()))
    } else {
        Ok(None)
    }
}

pub fn has_secret(key_id: &str) -> Result<bool, String> {
    Ok(get_secret(key_id)?.is_some())
}

pub fn delete_secret(key_id: &str) -> Result<bool, String> {
    {
        let mut cache = memory_cache().write().unwrap();
        cache.remove(key_id);
    }

    let path = vault_file_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut store = read_encrypted_store(&path)?;
    let removed = store.remove(key_id).is_some();
    if removed {
        let json_bytes = serde_json::to_vec(&store).map_err(|e| e.to_string())?;
        let encrypted = win_dpapi::encrypt(&json_bytes)?;
        fs::write(path, encrypted).map_err(|e| e.to_string())?;
    }
    Ok(removed)
}

fn read_encrypted_store(path: &PathBuf) -> Result<HashMap<String, String>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    if data.is_empty() {
        return Ok(HashMap::new());
    }

    let decrypted = win_dpapi::decrypt(&data)?;
    serde_json::from_slice(&decrypted).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpapi_vault_lifecycle() {
        let test_key = "test_provider_sk_999";
        let test_secret = "sk-test-secret-value-xyz-123456789";

        // 1. Save
        assert!(save_secret(test_key, test_secret).is_ok());

        // 2. Check exists
        assert_eq!(has_secret(test_key).unwrap(), true);

        // 3. Read and compare
        let retrieved = get_secret(test_key).unwrap();
        assert_eq!(retrieved, Some(test_secret.to_string()));

        // 4. Delete
        assert_eq!(delete_secret(test_key).unwrap(), true);
        assert_eq!(has_secret(test_key).unwrap(), false);
        assert_eq!(get_secret(test_key).unwrap(), None);
    }
}
