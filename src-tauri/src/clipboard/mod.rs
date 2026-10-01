// src-tauri/src/clipboard/mod.rs
//! Windows Native Clipboard Integration via arboard.
//! Provides robust image and text clipboard operations without crashing on format mismatches or locked handles.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardImageDto {
    pub width: usize,
    pub height: usize,
    pub rgba_bytes: Vec<u8>,
}

pub fn read_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard access error: {}", e))?;
    clipboard.get_text().map_err(|e| format!("Clipboard text read error: {}", e))
}

pub fn write_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard access error: {}", e))?;
    clipboard.set_text(text).map_err(|e| format!("Clipboard text write error: {}", e))
}

pub fn read_image() -> Result<Option<ClipboardImageDto>, String> {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[clipboard] Failed to open system clipboard: {}", e);
            return Ok(None);
        }
    };

    match clipboard.get_image() {
        Ok(img) => Ok(Some(ClipboardImageDto {
            width: img.width,
            height: img.height,
            rgba_bytes: img.bytes.into_owned(),
        })),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => {
            eprintln!("[clipboard] Non-fatal image read failure: {}", e);
            Ok(None)
        }
    }
}

pub fn write_image(width: usize, height: usize, rgba_bytes: Vec<u8>) -> Result<(), String> {
    if width == 0 || height == 0 || rgba_bytes.len() != width * height * 4 {
        return Err("Invalid image dimensions or byte length".to_string());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard access error: {}", e))?;
    clipboard.set_image(arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::Borrowed(&rgba_bytes),
    }).map_err(|e| format!("Clipboard image write error: {}", e))
}
