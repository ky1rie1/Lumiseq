// src/types/colorPipeline.ts
//! Explicit Image Color State and Pipeline Modeling

export type ImageColorState =
  | 'sensor-mosaic'             // Raw sensor Bayer/X-Trans mosaic data
  | 'sensor-linear-rgb'         // Linear sensor RGB (demosaiced, but uncalibrated/no WB)
  | 'camera-balanced-linear'    // Sensor data with camera As-Shot white balance applied
  | 'working-linear'            // Linear working color space (Linear sRGB / linear Display P3)
  | 'display-encoded';          // Gamma / Transfer function applied (e.g. sRGB encoded JPEG preview or raster bitmap)

export type WorkingColorSpace = 'camera' | 'xyz' | 'linear-srgb' | 'srgb' | 'unknown';

export interface ImageColorPipelineState {
  colorState: ImageColorState;
  whiteBalanceApplied: boolean;
  cameraMatrixApplied: boolean;
  toneMappingApplied: boolean;
  transferFunctionApplied: boolean;
  colorSpace: WorkingColorSpace;
}

/**
 * Creates initial pipeline state based on source kind.
 * Explicitly distinguishes embedded preview from raw sensor decode.
 */
export function createColorPipelineState(params: {
  isRaw: boolean;
  isEmbeddedPreview?: boolean;
  isSensorLinear?: boolean;
  /** Browser-decoded JPEG/PNG source, including native RAW's encoded preview. */
  isDisplayEncoded?: boolean;
}): ImageColorPipelineState {
  if (params.isDisplayEncoded && !params.isEmbeddedPreview) {
    return {
      colorState: 'display-encoded', whiteBalanceApplied: true, cameraMatrixApplied: true,
      toneMappingApplied: !params.isRaw, transferFunctionApplied: true, colorSpace: 'srgb',
    };
  }
  if (!params.isRaw) {
    // Normal raster images (JPEG, PNG, WebP) are already display-encoded sRGB
    return {
      colorState: 'display-encoded',
      whiteBalanceApplied: true,
      cameraMatrixApplied: true,
      toneMappingApplied: true,
      transferFunctionApplied: true,
      colorSpace: 'srgb',
    };
  }

  if (params.isEmbeddedPreview) {
    // Embedded JPEG preview inside RAW file was processed by camera ISP:
    // It already has camera WB, matrix, and display encoding!
    return {
      colorState: 'display-encoded',
      whiteBalanceApplied: true,
      cameraMatrixApplied: true,
      toneMappingApplied: true,
      transferFunctionApplied: true,
      colorSpace: 'srgb',
    };
  }

  if (params.isSensorLinear) {
    // Native LibRaw linear sensor decode: 16-bit linear sensor data without camera WB
    return {
      colorState: 'sensor-linear-rgb',
      whiteBalanceApplied: false,
      cameraMatrixApplied: false,
      toneMappingApplied: false,
      transferFunctionApplied: false,
      colorSpace: 'camera',
    };
  }

  // A RAW extension alone says nothing about decode, white balance or transfer.
  return {
    colorState: 'sensor-mosaic',
    whiteBalanceApplied: false,
    cameraMatrixApplied: false,
    toneMappingApplied: false,
    transferFunctionApplied: false,
    colorSpace: 'camera',
  };
}
