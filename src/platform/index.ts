// src/platform/index.ts
//! 影序 Studio 纯桌面端平台桥接模块。
//! 本应用是纯桌面端专业应用，统一使用 Tauri 原生桥接。

import { IPlatformBridge } from './IPlatformBridge';
import { TauriPlatformBridge } from './TauriPlatformBridge';

let cachedBridge: IPlatformBridge | null = null;

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window
  );
}

export function getPlatformBridge(): IPlatformBridge {
  if (cachedBridge) return cachedBridge;
  cachedBridge = new TauriPlatformBridge();
  return cachedBridge;
}

export const defaultPlatformBridge = getPlatformBridge();

export * from './IPlatformBridge';
export * from './TauriPlatformBridge';
