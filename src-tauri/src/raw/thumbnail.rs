// src-tauri/src/raw/thumbnail.rs
use crate::raw::types::RawError;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Fast Stage 2 extractor for embedded JPEG previews in RAW containers.
/// Quickly scans for standard embedded JPEG (0xFF, 0xD8 .. 0xFF, 0xD9) in header / sub-IFDs.
pub fn extract_embedded_thumbnail(file_path: &str) -> Result<Vec<u8>, RawError> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(RawError::CorruptFile(format!("File does not exist: {}", file_path)));
    }

    let mut file = File::open(path).map_err(|e| RawError::PermissionDenied(e.to_string()))?;
    let file_len = file.metadata().map_err(|e| RawError::DecodeFailed(e.to_string()))?.len() as usize;

    // Read up to 8MB or entire file if smaller to find embedded preview
    let scan_size = std::cmp::min(file_len, 8 * 1024 * 1024);
    let mut buffer = vec![0u8; scan_size];
    file.read_exact(&mut buffer).map_err(|e| RawError::DecodeFailed(e.to_string()))?;

    // Search for largest valid JPEG stream inside the header / container
    let mut best_start: Option<usize> = None;
    let mut best_len: usize = 0;

    let mut i = 0;
    while i + 3 < buffer.len() {
        // JPEG SOI marker: 0xFF, 0xD8, 0xFF
        if buffer[i] == 0xFF && buffer[i + 1] == 0xD8 && buffer[i + 2] == 0xFF {
            let start = i;
            // Scan ahead for EOI marker: 0xFF, 0xD9
            let mut j = start + 3;
            let mut found_eoi = false;
            while j + 1 < buffer.len() {
                if buffer[j] == 0xFF && buffer[j + 1] == 0xD9 {
                    let len = j + 2 - start;
                    if len > best_len && len > 5000 { // Only consider meaningful thumbnails (>5KB)
                        best_len = len;
                        best_start = Some(start);
                    }
                    found_eoi = true;
                    i = j + 2;
                    break;
                }
                j += 1;
            }
            if !found_eoi {
                break;
            }
        } else {
            i += 1;
        }
    }

    if let (Some(start), len) = (best_start, best_len) {
        return Ok(buffer[start..start + len].to_vec());
    }

    // If not found in first 8MB, check last 4MB (some formats store preview near the end of file)
    if file_len > 8 * 1024 * 1024 {
        let tail_scan = 4 * 1024 * 1024;
        let seek_pos = (file_len - tail_scan) as u64;
        if file.seek(SeekFrom::Start(seek_pos)).is_ok() {
            let mut tail_buffer = vec![0u8; tail_scan];
            if file.read_exact(&mut tail_buffer).is_ok() {
                let mut ti = 0;
                while ti + 3 < tail_buffer.len() {
                    if tail_buffer[ti] == 0xFF && tail_buffer[ti + 1] == 0xD8 && tail_buffer[ti + 2] == 0xFF {
                        let start = ti;
                        let mut tj = start + 3;
                        while tj + 1 < tail_buffer.len() {
                            if tail_buffer[tj] == 0xFF && tail_buffer[tj + 1] == 0xD9 {
                                let len = tj + 2 - start;
                                if len > 5000 {
                                    return Ok(tail_buffer[start..start + len].to_vec());
                                }
                            }
                            tj += 1;
                        }
                    }
                    ti += 1;
                }
            }
        }
    }

    Err(RawError::DecodeFailed("No embedded JPEG preview found in RAW file".to_string()))
}
