// src/platform/TauriPlatformBridge.ts
import {
  IPlatformBridge,
  OpenFileOptions,
  SaveFileOptions,
  SelectedFile,
  NativeRawMetadata,
  NativeRawDecodeResult,
  AppPaths,
  ClipboardImage,
} from './IPlatformBridge';
import { APP_NAME } from '../core/brand';
import { defaultAssetManager } from '../assets/AssetManager';
import { buildNativeDevelopPayload } from '../app/nativeDevelopPayload';
import { DevelopSettings } from '../types/develop';
import { defaultAppPaths } from '../core/AppPaths';

export class TauriPlatformBridge implements IPlatformBridge {
  readonly isDesktop = true;

  async openFileDialog(options?: OpenFileOptions): Promise<SelectedFile | null> {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');

      const selected = await dialog.open({
        title: options?.title || `打开照片或项目 · ${APP_NAME}`,
        multiple: false,
        directory: false,
        filters: options?.filters?.map((f) => ({
          name: f.name,
          extensions: f.extensions,
        })),
      });

      if (!selected || typeof selected !== 'string') {
        return null;
      }

      const fileInfo = await invoke<{
        file_name: string;
        path: string;
        size_bytes: number;
        is_raw: boolean;
      }>('inspect_local_file', { path: selected });

      const binaryBytes = await invoke<number[]>('read_local_binary_file', { path: selected });
      const uint8 = new Uint8Array(binaryBytes);
      const blob = new Blob([uint8]);

      return {
        name: fileInfo.file_name,
        path: fileInfo.path,
        sizeBytes: fileInfo.size_bytes,
        blob,
      };
    } catch (err) {
      throw err;
    }
  }

  async saveFileDialog(options?: SaveFileOptions): Promise<string | null> {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const selected = await dialog.save({
        title: options?.title || `保存文件 · ${APP_NAME}`,
        defaultPath: options?.defaultPath,
        filters: options?.filters?.map((f) => ({
          name: f.name,
          extensions: f.extensions,
        })),
      });

      return selected;
    } catch (err) {
      throw err;
    }
  }

  async readBinaryFile(filePath: string): Promise<Uint8Array> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = await invoke<number[]>('read_local_binary_file', { path: filePath });
      return new Uint8Array(bytes);
    }
    const fs = await import('node:fs/promises').catch(() => null);
    if (fs) {
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer);
    }
    throw new Error('readBinaryFile is not supported in this environment');
  }

  async writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_local_binary_file', { path: filePath, bytes: Array.from(bytes) });
      return;
    }
    const fs = await import('node:fs/promises').catch(() => null);
    if (fs) {
      const pathModule = await import('node:path');
      await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, bytes);
      return;
    }
    throw new Error('writeBinaryFile is not supported in this environment');
  }

  async getAppPaths(): Promise<AppPaths> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dto = await invoke<{
          roaming_data_dir: string;
          local_data_dir: string;
          cache_dir: string;
          logs_dir: string;
          temp_dir: string;
          models_dir: string;
          presets_dir: string;
          recent_projects_file: string;
        }>('get_app_paths');
        return {
          roamingDataDir: dto.roaming_data_dir,
          localDataDir: dto.local_data_dir,
          cacheDir: dto.cache_dir,
          logsDir: dto.logs_dir,
          tempDir: dto.temp_dir,
          modelsDir: dto.models_dir,
          presetsDir: dto.presets_dir,
          recentProjectsFile: dto.recent_projects_file,
        };
      } catch (err) {
        console.warn('Failed to query native app paths, using AppPaths fallback:', err);
      }
    }
    const p = defaultAppPaths.getPaths();
    return {
      roamingDataDir: p.roamingDataDir,
      localDataDir: p.localDataDir,
      cacheDir: p.cacheDir,
      logsDir: p.logsDir,
      tempDir: p.tempDir,
      modelsDir: p.modelsDir,
      presetsDir: p.presetsDir,
      recentProjectsFile: p.recentProjectsFile,
    };
  }

  async readTextFile(filePath: string): Promise<string> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('read_text_file', { path: filePath });
    }
    const fs = await import('node:fs/promises').catch(() => null);
    if (fs) return await fs.readFile(filePath, 'utf8');
    throw new Error('readTextFile is not supported in this environment');
  }

  async writeTextFileAtomic(filePath: string, content: string): Promise<void> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_text_file_atomic', { path: filePath, content });
      return;
    }
    const fs = await import('node:fs/promises').catch(() => null);
    if (fs) {
      const pathModule = await import('node:path');
      await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      return;
    }
    throw new Error('writeTextFileAtomic is not supported in this environment');
  }

  async listDirFiles(dirPath: string, extensionFilter?: string): Promise<string[]> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string[]>('list_dir_files', { dirPath, extensionFilter });
    }
    const fs = await import('node:fs/promises').catch(() => null);
    if (fs) {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
          .filter(e => e.isFile() && (!extensionFilter || e.name.toLowerCase().endsWith(`.${extensionFilter.toLowerCase()}`)))
          .map(e => `${dirPath}/${e.name}`);
      } catch {
        return [];
      }
    }
    return [];
  }

  async deleteFile(filePath: string): Promise<boolean> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('delete_file', { path: filePath });
    }
    const fs = await import('node:fs/promises').catch(() => null);
    if (fs) {
      try {
        await fs.unlink(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async readClipboardText(): Promise<string> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('clipboard_read_text');
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      return await navigator.clipboard.readText();
    }
    return '';
  }

  async writeClipboardText(text: string): Promise<void> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clipboard_write_text', { text });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }

  async readClipboardImage(): Promise<ClipboardImage | null> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dto = await invoke<{ width: number; height: number; rgba_bytes: number[] } | null>('clipboard_read_image');
        if (!dto) return null;
        return {
          width: dto.width,
          height: dto.height,
          rgbaBytes: new Uint8Array(dto.rgba_bytes),
        };
      } catch (err) {
        console.warn('Failed to read image from native clipboard:', err);
        return null;
      }
    }
    return null;
  }

  async writeClipboardImage(width: number, height: number, rgbaBytes: Uint8Array): Promise<void> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clipboard_write_image', {
        width,
        height,
        rgbaBytes: Array.from(rgbaBytes),
      });
    }
  }

  async getRawMetadata(filePath: string): Promise<NativeRawMetadata | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<NativeRawMetadata>('get_raw_metadata', { path: filePath });
    } catch (err) {
      console.warn('Failed to get RAW metadata via Tauri IPC:', err);
      return null;
    }
  }

  async extractRawThumbnail(filePath: string): Promise<Uint8Array | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = await invoke<number[]>('extract_raw_thumbnail', { path: filePath });
      return new Uint8Array(bytes);
    } catch (err) {
      console.warn('Failed to extract RAW thumbnail via Tauri IPC:', err);
      return null;
    }
  }

  async decodeRawImage(
    jobId: string,
    filePath: string,
    quality?: 'Fast' | 'Balanced' | 'High',
    processingVersion?: 1 | 2,
    correctionMode?: 'camera' | 'uncorrected'
  ): Promise<NativeRawDecodeResult | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<NativeRawDecodeResult>('decode_raw_image', {
        jobId,
        path: filePath,
        quality,
        processingVersion,
        correctionMode,
      });
    } catch (err) {
      console.warn('Failed to decode RAW image via Tauri IPC:', err);
      return null;
    }
  }

  async cancelRawDecode(jobId: string): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_raw_decode', { jobId });
    } catch (err) {
      console.warn('Failed to cancel RAW decode:', err);
    }
  }

  async releaseRawAsset(assetId: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('release_raw_asset', { assetId });
  }

  async getRawDisplayTile(assetId: string, x: number, y: number, width: number, height: number): Promise<Uint8Array> {
    const { invoke } = await import('@tauri-apps/api/core');
    const bytes = await invoke<number[]>('get_raw_display_tile', { assetId, x, y, width, height });
    return new Uint8Array(bytes);
  }

  async getRawLinearSample(assetId: string): Promise<number[][]> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<number[][]>('get_raw_linear_sample', { assetId });
  }

  async getRawLinearPreview(assetId: string): Promise<import('./rawLinearPixels').RawLinearPixels> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { decodeRawLinearPixels } = await import('./rawLinearPixels');
    return decodeRawLinearPixels(await invoke<ArrayBuffer>('get_raw_linear_preview', { assetId }));
  }

  async getRawLinearTile(assetId: string, x: number, y: number, width: number, height: number): Promise<import('./rawLinearPixels').RawLinearPixels> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { decodeRawLinearPixels } = await import('./rawLinearPixels');
    return decodeRawLinearPixels(await invoke<ArrayBuffer>('get_raw_linear_tile', { assetId, x, y, width, height }));
  }

  async getRawSpatialAnalysis(assetId: string, settings: import('../app/nativeDevelopPayload').NativeDevelopPayload): Promise<import('../app/rawSpatialAnalysis').RawSpatialAnalysis> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_raw_spatial_analysis', { assetId, settings });
  }

  async exportRawDevelop(
    assetId: string,
    settings: DevelopSettings,
    options: any,
    outputPath: string
  ): Promise<string | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const nativeSettings = await buildNativeDevelopPayload(settings, defaultAssetManager);
      return await invoke<string>('export_raw_develop', {
        assetId,
        settings: nativeSettings,
        options: {
          format: options.format,
          quality: options.quality,
          width: options.width,
          height: options.height,
          output_profile: options.outputProfile ?? 'srgb',
        },
        outputPath,
      });
    } catch (err) {
      console.error('Failed to export raw develop via native Rust engine:', err);
      throw err;
    }
  }

  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  async saveSecureSecret(keyId: string, secret: string): Promise<void> {
    if (!this.isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_secure_secret', { keyId, secret });
    } catch (err) {
      console.error('Failed to save secure secret via DPAPI vault:', err);
      throw err;
    }
  }

  async getSecureSecret(keyId: string): Promise<string | null> {
    if (!this.isTauri()) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string | null>('get_secure_secret', { keyId });
    } catch (err) {
      console.error('Failed to get secure secret via DPAPI vault:', err);
      return null;
    }
  }

  async hasSecureSecret(keyId: string): Promise<boolean> {
    if (!this.isTauri()) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('has_secure_secret', { keyId });
    } catch (err) {
      console.error('Failed to check secure secret via DPAPI vault:', err);
      return false;
    }
  }

  async deleteSecureSecret(keyId: string): Promise<boolean> {
    if (!this.isTauri()) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('delete_secure_secret', { keyId });
    } catch (err) {
      console.error('Failed to delete secure secret via DPAPI vault:', err);
      return false;
    }
  }

  async getStartupArgs(): Promise<string[]> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string[]>('get_startup_args');
      } catch (err) {
        console.warn('Failed to retrieve startup CLI arguments:', err);
        return [];
      }
    }
    return [];
  }

  async writeDiagnosticLog(category: string, message: string): Promise<void> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('write_diagnostic_log', { category, message });
        return;
      } catch (err) {
        console.warn('Failed to write diagnostic log via Tauri:', err);
      }
    }
    console.log(`[${category}] ${message}`);
  }

  async revealPathInExplorer(path: string): Promise<void> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('reveal_path_in_explorer', { path });
        return;
      } catch (err) {
        console.warn('Failed to reveal path in explorer via Tauri:', err);
      }
    }
  }

  getPlatformInfo() {
    return { isDesktop: true, platform: 'windows-tauri' };
  }
}
