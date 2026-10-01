// src-tauri/src/security/mod.rs
pub mod vault;

pub use vault::{delete_secret, get_secret, has_secret, save_secret};
