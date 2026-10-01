// src/platform/IPlatformBridge.ts

export interface OpenFileFilter {
  name: string;
  extensions: string[];
}

export interface OpenFileOptions {
  title?: string;
  filters?: OpenFileFilter[];
  multiple?: boolean;
  directory?: boolean;
}

export interface SaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: OpenFileFilter[];
}

export interface SelectedFile {
  name: string;
  path?: string; // Absolute file path on desktop (Windows native)
  sizeBytes: number;
  blob: Blob;
}

export interface NativeRawMetadata {
  camera_make: string;
  camera_model: string;
  lens_model?: string;
  iso?: number;
  shutter_speed?: string;
  aperture?: string;
  focal_length?: string;
  capture_time?: string;
  width: number;
  height: number;
  orientation: number;
  white_balance_multipliers: [number, number, number, number];
  daylight_multipliers?: [number, number, number, number];
  color_matrix: number[][];
  black_levels: [number, number, number, number];
  white_levels: [number, number, number, number];
  cfa_pattern: string;
  bits_per_sample: number;
  has_embedded_preview: boolean;
  gps_latitude?: number;
  gps_longitude?: number;
}

export interface NativeRawDecodeResult {
  asset_id: string;
  width: number;
  height: number;
  pixel_format: string;
  metadata: NativeRawMetadata;
  preview_png_bytes?: number[];
}

export interface AppPaths {
  roamingDataDir: string;
  localDataDir: string;
  cacheDir: string;
  logsDir: string;
  tempDir: string;
  modelsDir: string;
  presetsDir: string;
  recentProjectsFile: string;
}

export interface ClipboardImage {
  width: number;
  height: number;
  rgbaBytes: Uint8Array;
}

export interface IPlatformBridge {
  readonly isDesktop: boolean;

  /** Open native Windows file dialog to select RAW or raster images */
  openFileDialog(options?: OpenFileOptions): Promise<SelectedFile | null>;

  /** Open native Windows save file dialog */
  saveFileDialog(options?: SaveFileOptions): Promise<string | null>;

  /** Read binary file from native disk path */
  readBinaryFile(filePath: string): Promise<Uint8Array>;

  /** Write exported bytes to a native disk path (desktop only). */
  writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void>;

  /** Get centralized AppData and LocalAppData paths from native host */
  getAppPaths(): Promise<AppPaths>;

  /** Read UTF-8 text from native file path */
  readTextFile(filePath: string): Promise<string>;

  /** Write text file atomically via temporary sibling file + atomic replace */
  writeTextFileAtomic(filePath: string, content: string): Promise<void>;

  /** List file paths inside directory with optional extension filter */
  listDirFiles(dirPath: string, extensionFilter?: string): Promise<string[]>;

  /** Delete a file if it exists */
  deleteFile(filePath: string): Promise<boolean>;

  /** Read UTF-8 plain text from system clipboard */
  readClipboardText(): Promise<string>;

  /** Write UTF-8 plain text to system clipboard */
  writeClipboardText(text: string): Promise<void>;

  /** Read image bitmap from system clipboard (Windows CF_DIB / CF_DIBV5 / PNG) */
  readClipboardImage(): Promise<ClipboardImage | null>;

  /** Write RGBA bitmap to system clipboard */
  writeClipboardImage(width: number, height: number, rgbaBytes: Uint8Array): Promise<void>;

  /** Stage 1: Read rich camera and sensor metadata from RAW */
  getRawMetadata(filePath: string): Promise<NativeRawMetadata | null>;

  /** Stage 2: Fast extraction of embedded JPEG thumbnail from RAW file container */
  extractRawThumbnail(filePath: string): Promise<Uint8Array | null>;

  /** Stage 3: Full background high-precision 16-bit RAW demosaicing and decoding */
  decodeRawImage(jobId: string, filePath: string, quality?: 'Fast' | 'Balanced' | 'High'): Promise<NativeRawDecodeResult | null>;

  /** Lossless-encoded display pixels for a bounded region of the registered RAW. */
  getRawDisplayTile?(assetId: string, x: number, y: number, width: number, height: number): Promise<Uint8Array>;

  /** Unedited RGBA16 source grid as linear sRGB, at most 16,384 RGB pixels. */
  getRawLinearSample?(assetId: string): Promise<number[][]>;

  /** Whole-source haze coefficients and native-resolution noise estimate, not a crop estimate. */
  getRawSpatialAnalysis?(assetId: string, settings: import('../app/nativeDevelopPayload').NativeDevelopPayload): Promise<import('../app/rawSpatialAnalysis').RawSpatialAnalysis>;

  /** Cancel an ongoing background RAW decode job */
  cancelRawDecode(jobId: string): Promise<void>;

  /** Release the caller's owned reference to a decoded native RAW asset. */
  releaseRawAsset(assetId: string): Promise<void>;

  /** Native full-resolution export written directly to local disk */
  exportRawDevelop(assetId: string, settings: any, options: any, outputPath: string): Promise<string | null>;

  /** Save encrypted secret into DPAPI secure vault */
  saveSecureSecret(keyId: string, secret: string): Promise<void>;

  /** Retrieve decrypted secret from secure vault */
  getSecureSecret(keyId: string): Promise<string | null>;

  /** Check if secret exists in secure vault without retrieving plaintext */
  hasSecureSecret(keyId: string): Promise<boolean>;

  /** Delete secret from secure vault */
  deleteSecureSecret(keyId: string): Promise<boolean>;

  /** Retrieve CLI startup arguments passed on Windows application launch */
  getStartupArgs(): Promise<string[]>;

  /** Append diagnostic or crash entry to native log file with auto-rotation */
  writeDiagnosticLog(category: string, message: string): Promise<void>;

  /** Reveal target file or folder in Windows Explorer */
  revealPathInExplorer(path: string): Promise<void>;

  /** Get platform environment info */
  getPlatformInfo(): { isDesktop: boolean; platform: string };
}
