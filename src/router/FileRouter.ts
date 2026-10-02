// src/router/FileRouter.ts
import { WorkspaceType } from '../types/common';

import rawFormats from '../config/rawFormats.json';
export const RAW_EXTENSIONS = new Set(rawFormats);

export const RASTER_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'
]);

export const PROJECT_EXTENSIONS = new Set([
  'aistudio', 'aiimg', 'psd', 'lsq', 'lumiseq'
]);

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length <= 1) return '';
  return parts[parts.length - 1].toLowerCase();
}

export function isRawFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return RAW_EXTENSIONS.has(ext);
}

export function isRasterFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return RASTER_EXTENSIONS.has(ext);
}

export function isProjectFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return PROJECT_EXTENSIONS.has(ext);
}

export interface FileRouteResult {
  targetWorkspace: WorkspaceType;
  fileType: 'raw' | 'raster' | 'project' | 'unknown';
  extension: string;
  recommendationNote?: string;
}

export function routeFile(filename: string): FileRouteResult {
  const ext = getFileExtension(filename);

  if (isRawFile(filename)) {
    return {
      targetWorkspace: 'develop',
      fileType: 'raw',
      extension: ext,
      recommendationNote: 'RAW digital negative detected. Entering non-destructive Develop Workspace.',
    };
  }

  if (isRasterFile(filename)) {
    return {
      targetWorkspace: 'edit',
      fileType: 'raster',
      extension: ext,
      recommendationNote: 'Standard image detected. Entering Edit Workspace. You can also develop it non-destructively.',
    };
  }

  if (isProjectFile(filename)) {
    return {
      targetWorkspace: 'edit',
      fileType: 'project',
      extension: ext,
      recommendationNote: 'Studio project bundle detected.',
    };
  }

  return {
    targetWorkspace: 'home',
    fileType: 'unknown',
    extension: ext,
    recommendationNote: 'Unsupported file format.',
  };
}
