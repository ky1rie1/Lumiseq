// src/core/AppPaths.ts
//! Centralized AppPaths & Storage Manager (Stage 1A)
//! Canonical single source of truth for Roaming (%APPDATA%\AI-Creative-Studio) and Local (%LOCALAPPDATA%\AI-Creative-Studio).
//! Business code must NEVER construct APPDATA or LOCALAPPDATA paths manually.

export interface AppPathsConfig {
  roamingDataDir: string;
  localDataDir: string;
  cacheDir: string;
  logsDir: string;
  tempDir: string;
  modelsDir: string;
  presetsDir: string;
  recentProjectsFile: string;
  preferencesFile: string;
  buildCacheDir: string;
  cargoTargetDir: string;
  runtimeCacheDir: string;
  appDataDir: string; // Backward compatibility alias for localDataDir
}

export class AppPathsManager {
  private static instance: AppPathsManager;
  private paths: AppPathsConfig;
  private initialized = false;

  private constructor() {
    this.paths = this.computeDefaultPaths();
  }

  static getInstance(): AppPathsManager {
    if (!AppPathsManager.instance) {
      AppPathsManager.instance = new AppPathsManager();
    }
    return AppPathsManager.instance;
  }

  private computeDefaultPaths(): AppPathsConfig {
    const userProfile = (typeof process !== 'undefined' && process.env?.USERPROFILE) || 'C:\\Users\\Default';
    const localAppData = (typeof process !== 'undefined' && process.env?.LOCALAPPDATA) || `${userProfile}\\AppData\\Local`;
    const roamingAppData = (typeof process !== 'undefined' && process.env?.APPDATA) || `${userProfile}\\AppData\\Roaming`;

    const roamingDataDir = `${roamingAppData}\\AI-Creative-Studio`;
    const localDataDir = `${localAppData}\\AI-Creative-Studio`;
    const cacheDir = `${localDataDir}\\runtime-cache`;

    return {
      roamingDataDir,
      localDataDir,
      cacheDir,
      runtimeCacheDir: cacheDir,
      logsDir: `${localDataDir}\\logs`,
      tempDir: `${localDataDir}\\temp`,
      modelsDir: `${localDataDir}\\models`,
      presetsDir: `${roamingDataDir}\\presets`,
      recentProjectsFile: `${roamingDataDir}\\recent.json`,
      preferencesFile: `${roamingDataDir}\\preferences.json`,
      buildCacheDir: `${localDataDir}\\build-cache`,
      cargoTargetDir: `${localDataDir}\\cargo-target`,
      appDataDir: localDataDir,
    };
  }

  /**
   * Initializes paths directly from the native desktop host.
   */
  async initializeFromHost(paths: Partial<AppPathsConfig>): Promise<void> {
    this.paths = {
      ...this.paths,
      ...paths,
      runtimeCacheDir: paths.cacheDir || this.paths.cacheDir,
      appDataDir: paths.localDataDir || this.paths.localDataDir,
    };
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getPaths(): AppPathsConfig {
    return { ...this.paths };
  }

  getRoamingDataDir(): string {
    return this.paths.roamingDataDir;
  }

  getLocalDataDir(): string {
    return this.paths.localDataDir;
  }

  getCacheDir(): string {
    return this.paths.cacheDir;
  }

  getPresetsDir(): string {
    return this.paths.presetsDir;
  }

  getRecentProjectsFile(): string {
    return this.paths.recentProjectsFile;
  }

  getPreferencesFile(): string {
    return this.paths.preferencesFile;
  }

  getAppDataDir(): string {
    return this.paths.localDataDir;
  }

  getBuildCacheDir(): string {
    return this.paths.buildCacheDir;
  }

  getCargoTargetDir(): string {
    return this.paths.cargoTargetDir;
  }

  getRuntimeCacheDir(): string {
    return this.paths.cacheDir;
  }

  getModelsDir(): string {
    return this.paths.modelsDir;
  }

  getLogsDir(): string {
    return this.paths.logsDir;
  }

  getTempDir(): string {
    return this.paths.tempDir;
  }
}

export const defaultAppPaths = AppPathsManager.getInstance();
