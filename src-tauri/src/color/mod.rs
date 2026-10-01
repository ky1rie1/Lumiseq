// src-tauri/src/color/mod.rs
pub mod profile;
pub mod transform;
pub mod display;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorSpace {
    RawSensor,
    LinearWorkingRgb,
    SrgbDisplay,
    DisplayP3,
    AdobeRgb,
    ProPhotoRgb,
}
