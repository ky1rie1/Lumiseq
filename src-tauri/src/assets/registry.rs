// src-tauri/src/assets/registry.rs
use crate::raw::types::{PixelFormat, RawMetadata};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

#[derive(Debug, Clone)]
pub struct NativeImageAsset {
    pub id: String,
    pub width: usize,
    pub height: usize,
    pub pixel_format: PixelFormat,
    pub buffer: Vec<u8>,
    pub metadata: Option<RawMetadata>,
    pub ref_count: usize,
    pub created_at: u64,
}

pub struct NativeAssetRegistry {
    assets: RwLock<HashMap<String, NativeImageAsset>>,
}

impl NativeAssetRegistry {
    pub fn new() -> Self {
        Self {
            assets: RwLock::new(HashMap::new()),
        }
    }

    pub fn register(&self, asset: NativeImageAsset) {
        let mut map = self.assets.write().unwrap();
        map.insert(asset.id.clone(), asset);
    }

    pub fn get(&self, id: &str) -> Option<NativeImageAsset> {
        let map = self.assets.read().unwrap();
        map.get(id).cloned()
    }

    pub fn with_asset<R>(&self, id: &str, read: impl FnOnce(&NativeImageAsset) -> R) -> Option<R> {
        let map = self.assets.read().unwrap();
        map.get(id).map(read)
    }

    pub fn retain(&self, id: &str) -> bool {
        let mut map = self.assets.write().unwrap();
        if let Some(asset) = map.get_mut(id) {
            asset.ref_count += 1;
            true
        } else {
            false
        }
    }

    pub fn release(&self, id: &str) -> bool {
        let mut map = self.assets.write().unwrap();
        if let Some(asset) = map.get_mut(id) {
            if asset.ref_count > 1 {
                asset.ref_count -= 1;
                false
            } else {
                map.remove(id);
                true
            }
        } else {
            false
        }
    }

    pub fn count(&self) -> usize {
        let map = self.assets.read().unwrap();
        map.len()
    }
}

pub fn global_asset_registry() -> &'static Arc<NativeAssetRegistry> {
    static REGISTRY: OnceLock<Arc<NativeAssetRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Arc::new(NativeAssetRegistry::new()))
}
