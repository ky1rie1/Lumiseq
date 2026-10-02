use crate::assets::NativeImageAsset;
use super::types::{PixelFormat, RawError};

/// Borrowed, immutable working pixels. Float RGB may be signed and exceed one.
pub(super) struct LinearSource<'a> {
    asset: &'a NativeImageAsset,
    stride: usize,
}

impl<'a> LinearSource<'a> {
    pub fn new(asset: &'a NativeImageAsset) -> Result<Self, RawError> {
        let stride = match asset.pixel_format {
            PixelFormat::RGBA16 => 8,
            PixelFormat::RGBA32F => 16,
            _ => return Err(RawError::DecodeFailed("Unsupported RAW working pixel format".into())),
        };
        if asset.width == 0 || asset.height == 0
            || asset.width.checked_mul(asset.height).is_none_or(|n| n > 150_000_000)
            || asset.width.checked_mul(asset.height).and_then(|n| n.checked_mul(stride)) != Some(asset.buffer.len()) {
            return Err(RawError::DecodeFailed("Invalid native RAW working source".into()));
        }
        Ok(Self { asset, stride })
    }

    pub fn is_float(&self) -> bool { self.stride == 16 }
    pub fn stride(&self) -> usize { self.stride }
    pub fn bytes(&self) -> &'a [u8] { &self.asset.buffer }

    pub fn pixel(&self, index: usize) -> Result<[f32; 4], RawError> {
        let start = index.checked_mul(self.stride).ok_or_else(|| RawError::DecodeFailed("RAW pixel offset overflow".into()))?;
        let end = start.checked_add(self.stride).ok_or_else(|| RawError::DecodeFailed("RAW pixel offset overflow".into()))?;
        let bytes = self.asset.buffer.get(start..end).ok_or_else(|| RawError::DecodeFailed("RAW pixel outside source".into()))?;
        let pixel = if self.is_float() {
            std::array::from_fn(|c| f32::from_le_bytes(bytes[c*4..c*4+4].try_into().unwrap()))
        } else {
            std::array::from_fn(|c| u16::from_le_bytes(bytes[c*2..c*2+2].try_into().unwrap()) as f32 / 65535.0)
        };
        if pixel.iter().any(|n| !n.is_finite()) || !(0.0..=1.0).contains(&pixel[3]) {
            return Err(RawError::DecodeFailed("Nonfinite RAW source or invalid alpha".into()));
        }
        Ok(pixel)
    }
}
