// tests/ColorPipeline.test.ts
import { describe, it, expect } from 'vitest';
import { createColorPipelineState } from '../src/types/colorPipeline';

describe('ImageColorPipelineState & White Balance Architecture', () => {
  it('should initialize raster images as display-encoded without applying raw WB', () => {
    const state = createColorPipelineState({ isRaw: false });
    expect(state.colorState).toBe('display-encoded');
    expect(state.whiteBalanceApplied).toBe(true);
    expect(state.cameraMatrixApplied).toBe(true);
    expect(state.transferFunctionApplied).toBe(true);
    expect(state.colorSpace).toBe('srgb');
  });

  it('should treat embedded JPEG preview of RAW as display-encoded to prevent double WB', () => {
    const state = createColorPipelineState({ isRaw: true, isEmbeddedPreview: true });
    expect(state.colorState).toBe('display-encoded');
    expect(state.whiteBalanceApplied).toBe(true); // Flagged so shader won't double-multiply sensor multipliers
    expect(state.transferFunctionApplied).toBe(true);
    expect(state.colorSpace).toBe('srgb');
  });

  it('should treat native RAW linear sensor decode as sensor-linear-rgb requiring WB', () => {
    const state = createColorPipelineState({ isRaw: true, isSensorLinear: true });
    expect(state.colorState).toBe('sensor-linear-rgb');
    expect(state.whiteBalanceApplied).toBe(false); // Sensor WB must be applied exactly once
    expect(state.cameraMatrixApplied).toBe(false);
    expect(state.transferFunctionApplied).toBe(false);
    expect(state.colorSpace).toBe('camera');
  });
});
