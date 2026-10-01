// src/color/ColorManager.ts

export type ColorSpaceName =
  | 'raw-sensor'
  | 'linear-working-rgb'
  | 'sRGB'
  | 'display-p3'
  | 'adobe-rgb'
  | 'prophoto-rgb';

export interface IColorManager {
  readonly sourceColorSpace: ColorSpaceName;
  readonly workingColorSpace: ColorSpaceName;
  readonly displayColorSpace: ColorSpaceName;

  /** Convert linear color vector to display color space */
  linearToDisplay(rgb: [number, number, number]): [number, number, number];

  /** Convert display color vector to linear working space */
  displayToLinear(rgb: [number, number, number]): [number, number, number];

  /** Multiply 3x3 camera matrix */
  applyCameraMatrix(camRgb: [number, number, number], matrix: number[][]): [number, number, number];
}

export class ColorManager implements IColorManager {
  readonly sourceColorSpace: ColorSpaceName = 'raw-sensor';
  readonly workingColorSpace: ColorSpaceName = 'linear-working-rgb';
  readonly displayColorSpace: ColorSpaceName = 'sRGB';

  /** Linear to standard sRGB display transfer function */
  linearToDisplay(rgb: [number, number, number]): [number, number, number] {
    return [
      this.linearChannelToSrgb(rgb[0]),
      this.linearChannelToSrgb(rgb[1]),
      this.linearChannelToSrgb(rgb[2]),
    ];
  }

  /** Display sRGB to linear working space */
  displayToLinear(rgb: [number, number, number]): [number, number, number] {
    return [
      this.srgbChannelToLinear(rgb[0]),
      this.srgbChannelToLinear(rgb[1]),
      this.srgbChannelToLinear(rgb[2]),
    ];
  }

  private linearChannelToSrgb(c: number): number {
    const val = Math.max(0, Math.min(1.0, c));
    if (val >= 1.0) return 1.0;
    return val <= 0.0031308
      ? val * 12.92
      : 1.055 * Math.pow(val, 1.0 / 2.4) - 0.055;
  }

  private srgbChannelToLinear(c: number): number {
    const val = Math.max(0, c);
    return val <= 0.04045
      ? val / 12.92
      : Math.pow((val + 0.055) / 1.055, 2.4);
  }

  applyCameraMatrix(camRgb: [number, number, number], matrix: number[][]): [number, number, number] {
    if (!matrix || matrix.length < 3) return camRgb;
    const r = matrix[0][0] * camRgb[0] + (matrix[0][1] || 0) * camRgb[1] + (matrix[0][2] || 0) * camRgb[2];
    const g = matrix[1][0] * camRgb[0] + (matrix[1][1] || 0) * camRgb[1] + (matrix[1][2] || 0) * camRgb[2];
    const b = matrix[2][0] * camRgb[0] + (matrix[2][1] || 0) * camRgb[1] + (matrix[2][2] || 0) * camRgb[2];
    return [r, g, b];
  }
}

export const defaultColorManager = new ColorManager();
