import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAssetManager } from '../assets/AssetManager';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { WebGLImageEngine } from './WebGLImageEngine';

function fakeWebGL(compileOkay = true) {
  const uploadedMasks: Uint8ClampedArray[] = [];
  const uniforms = new Map<string, number>();
  const vectors = new Map<string, number[]>();
  const imageUploads: boolean[] = [];
  const shaderSources: string[] = [];
  let flipY = false;
  let quadVertices: number[] = [];
  let drawCount = 0;
  const gl = new Proxy({
    TEXTURE_2D: 1, TEXTURE0: 100, TEXTURE1: 101, TEXTURE2: 102,
    RGBA: 2, RED: 3, R8: 4, UNSIGNED_BYTE: 5,
    FRAMEBUFFER: 6, COLOR_ATTACHMENT0: 7, ARRAY_BUFFER: 8,
    STATIC_DRAW: 9, FLOAT: 10, TRIANGLE_STRIP: 11,
    CLAMP_TO_EDGE: 12, LINEAR: 13, TEXTURE_WRAP_S: 14,
    TEXTURE_WRAP_T: 15, TEXTURE_MIN_FILTER: 16, TEXTURE_MAG_FILTER: 17,
    VERTEX_SHADER: 18, FRAGMENT_SHADER: 19, UNPACK_ALIGNMENT: 20, UNPACK_FLIP_Y_WEBGL: 23,
    COMPILE_STATUS: 21, LINK_STATUS: 22, FRAMEBUFFER_COMPLETE: 24,
    checkFramebufferStatus: () => 24,
    NO_ERROR: 0, RGBA32F: 25, HALF_FLOAT: 26,
    getExtension: (name: string) => ['EXT_color_buffer_float','OES_texture_float_linear'].includes(name) ? {} : null, getError: () => 0,
    readPixels: (...args: unknown[]) => (args[6] as Float32Array).set([1.0001234, -.125, .000001, 1]),
    createTexture: () => ({}), createFramebuffer: () => ({}),
    createBuffer: () => ({}), createShader: () => ({}), createProgram: () => ({}),
    getShaderParameter: () => compileOkay,
    getShaderInfoLog: () => 'broken shader',
    getProgramParameter: () => compileOkay,
    getAttribLocation: () => 0,
    getUniformLocation: (_program: unknown, name: string) => name,
    uniform1f: (name: string, value: number) => uniforms.set(name, value),
    uniform1i: (name: string, value: number) => uniforms.set(name, value),
    uniform4f: (name: string, a: number, b: number, c: number, d: number) => vectors.set(name, [a, b, c, d]),
    pixelStorei: (name: number, value: number | boolean) => { if (name === 23) flipY = Boolean(value); },
    bufferData: (_target: number, data: Float32Array) => { quadVertices = Array.from(data); },
    shaderSource: (_shader: unknown, source: string) => shaderSources.push(source),
    drawArrays: () => { drawCount++; },
    texImage2D: (...args: unknown[]) => {
      const data = args.at(-1);
      if (data instanceof Uint8ClampedArray) uploadedMasks.push(data);
      if (data && typeof data === 'object' && 'width' in data && 'height' in data) imageUploads.push(flipY);
    },
  }, {
    get(target, key) {
      return Reflect.get(target, key) ?? (() => undefined);
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, uploadedMasks, uniforms, vectors, imageUploads, shaderSources, get quadVertices() { return quadVertices; }, get drawCount() { return drawCount; } };
}

async function loadedEngine() {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2 }));
  const engine = new WebGLImageEngine();
  await engine.loadAsset('source', new Blob(['image']));
  return engine;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('develop mask rendering', () => {
  it('passes native tile coordinates through to the full-photo display pass', async () => {
    const engine = await loadedEngine(); const gpu = fakeWebGL();
    const canvas = { width: 2, height: 2, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;
    await engine.renderDevelop('source', createDefaultDevelopSettings(true), canvas, undefined, {
      sourceRect: { x: 1500, y: 500, width: 1200, height: 800, sourceWidth: 6000, sourceHeight: 4000 },
    });
    expect(gpu.vectors.get('u_source_rect')).toEqual([0.25, 0.125, 0.2, 0.2]);
  });
  it('never reapplies camera white balance to decoded display pixels in custom mode', async () => {
    const engine = await loadedEngine(); const gpu = fakeWebGL();
    const canvas = { width: 2, height: 2, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;
    const settings = createDefaultDevelopSettings(true);
    settings.whiteBalance = { mode: 'custom', temperature: 5500, tint: 0, cameraMultipliers: [2.4, 1, 1.7, 1] };
    await engine.renderDevelop('source', settings, canvas);
    expect(gpu.uniforms.get('u_white_balance_applied')).toBe(1);
    expect(gpu.uniforms.get('u_curve_enabled')).toBe(0);
    expect(gpu.uniforms.get('u_hsl_enabled')).toBe(0);
  });
  it('CPU contrast changes luminance while retaining linear channel ratios', async () => {
    const engine = await loadedEngine(); let output = new Uint8ClampedArray();
    const context = { clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([180, 120, 60, 255]) }), putImageData: (image: ImageData) => { output = image.data; } };
    const canvas = { width: 1, height: 1, getContext: (name: string) => name === '2d' ? context : null } as unknown as HTMLCanvasElement;
    const settings = createDefaultDevelopSettings(false); settings.contrast = 50;
    await engine.renderDevelop('source', settings, canvas, undefined, { forceCPU: true });
    const linear = (v: number) => v / 255 <= .04045 ? v / 255 / 12.92 : ((v / 255 + .055) / 1.055) ** 2.4;
    expect(linear(output[0]) / linear(output[1])).toBeCloseTo(linear(180) / linear(120), 1);
    expect(linear(output[2]) / linear(output[1])).toBeCloseTo(linear(60) / linear(120), 2);
  });
  it('CPU custom white balance is a relative chromatic adaptation with an exact neutral setting', async () => {
    const engine = await loadedEngine(); let output: number[] = [];
    const context = { clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([120, 120, 120, 255]) }), putImageData: (image: ImageData) => { output = [...image.data]; } };
    const canvas = { width: 1, height: 1, getContext: (name: string) => name === '2d' ? context : null } as unknown as HTMLCanvasElement;
    const settings = createDefaultDevelopSettings(true); settings.whiteBalance = { mode: 'custom', temperature: 9500, tint: 0 };
    await engine.renderDevelop('source', settings, canvas, undefined, { forceCPU: true });
    expect(output[0]).toBeGreaterThan(120); expect(output[2]).toBeLessThan(120);
    settings.whiteBalance.temperature = 5500;
    await engine.renderDevelop('source', settings, canvas, undefined, { forceCPU: true });
    expect(output).toEqual([120,120,120,255]);
  });
  it('reports the actual CPU render after GPU failure and applies basic adjustments to pixels', async () => {
    const engine = await loadedEngine();
    expect(engine.getRenderingStatus().backend).toBe('uninitialized');
    const gpu = fakeWebGL(false);
    const failedCanvas = { width: 1, height: 1, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;
    await expect(engine.renderDevelop('source', createDefaultDevelopSettings(false), failedCanvas)).rejects.toThrow(/shader/i);
    expect(engine.getRenderingStatus()).toEqual({ backend: 'uninitialized', fallbackReason: 'Develop vertex shader failed: broken shader' });
    let pixels: number[] = [];
    const context = { clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([100, 100, 100, 255]) }), putImageData: (image: ImageData) => { pixels = [...image.data]; } };
    const canvas = { width: 1, height: 1, getContext: (name: string) => name === '2d' ? context : null } as unknown as HTMLCanvasElement;
    const settings = createDefaultDevelopSettings(false); settings.exposure = 1;
    await engine.renderDevelop('source', settings, canvas, undefined, { forceCPU: true, fallbackReason: 'broken shader' });
    expect(pixels[0]).toBeGreaterThan(100); expect(pixels[3]).toBe(255);
    expect(engine.getRenderingStatus()).toEqual({ backend: 'canvas2d', fallbackReason: 'broken shader' });
  });

  it('rejects unsupported CPU adjustments and pixel read errors instead of claiming a successful fallback', async () => {
    const engine = await loadedEngine();
    const context = { clearRect() {}, drawImage() {}, getImageData: () => { throw new Error('pixel read failed'); } };
    const canvas = { width: 1, height: 1, getContext: (name: string) => name === '2d' ? context : null } as unknown as HTMLCanvasElement;
    const settings = createDefaultDevelopSettings(false); settings.optics.vignetteAmount = 20;
    await expect(engine.renderDevelop('source', settings, canvas)).rejects.toThrow(/WebGL.*vignette|vignette.*WebGL/i);
    settings.optics.vignetteAmount = 0;
    await expect(engine.renderDevelop('source', settings, canvas)).rejects.toThrow(/pixel read failed/);
    expect(engine.getRenderingStatus().backend).toBe('uninitialized');
  });

  it('recovers export shader failure on a fresh CPU canvas at the requested output dimensions', async () => {
    const engine = await loadedEngine(); const gpu = fakeWebGL(false);
    let created = 0; let exposed = 0;
    const context = { clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([100, 100, 100, 255]) }), putImageData: (image: ImageData) => { exposed = image.data[0]; } };
    const gpuCanvas = { width: 0, height: 0, getContext: () => gpu.gl };
    const cpuCanvas = { width: 0, height: 0, getContext: (name: string) => name === '2d' ? context : null, toBlob: (done: (blob: Blob) => void) => done(new Blob(['CPU export'])) };
    vi.stubGlobal('document', { createElement: () => ++created === 1 ? gpuCanvas : cpuCanvas });
    const settings = createDefaultDevelopSettings(false); settings.exposure = 1;
    const result = await engine.exportDevelopImage('source', settings, { width: 6, height: 8, format: 'png' });
    expect(await result.text()).toBe('CPU export'); expect(cpuCanvas.width).toBe(6); expect(cpuCanvas.height).toBe(8);
    expect(exposed).toBeGreaterThan(100); expect(engine.getRenderingStatus().backend).toBe('canvas2d');
  });
  it('retains shaders across alternating preview and export contexts until explicit release', async () => {
    const engine = await loadedEngine(); const a = fakeWebGL(); const b = fakeWebGL();
    const canvasA = { width: 2, height: 2, getContext: () => a.gl } as unknown as HTMLCanvasElement;
    const canvasB = { width: 2, height: 2, getContext: () => b.gl } as unknown as HTMLCanvasElement;
    for (let i = 0; i < 4; i++) {
      await engine.renderDevelop('source', createDefaultDevelopSettings(false), canvasA);
      await engine.renderDevelop('source', createDefaultDevelopSettings(false), canvasB);
    }
    expect(a.shaderSources).toHaveLength(10); expect(b.shaderSources).toHaveLength(10);
    engine.releaseDevelopContext(canvasA);
    await engine.renderDevelop('source', createDefaultDevelopSettings(false), canvasA);
    expect(a.shaderSources).toHaveLength(20); expect(b.shaderSources).toHaveLength(10);
  });
  it('keeps uploaded photos upright through GPU passes and aligns mask top rows', async () => {
    const engine = await loadedEngine();
    const gpu = fakeWebGL();
    const canvas = { width: 2, height: 2, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;

    await engine.renderDevelop('source', createDefaultDevelopSettings(false), canvas);

    expect(gpu.quadVertices).toEqual([
      -1, -1, 0, 0, 1, -1, 1, 0,
      -1, 1, 0, 1, 1, 1, 1, 1,
    ]);
    expect(gpu.imageUploads).toEqual([false]);
    expect(gpu.shaderSources.some(source => source.includes('texture(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y))'))).toBe(true);
    expect(gpu.shaderSources.some(source => source.includes('texture(u_mask, vec2(globalCoord.x, 1.0 - globalCoord.y))'))).toBe(true);
  });

  it('runs one local adjustment pass using the registered mask bytes', async () => {
    const engine = await loadedEngine();
    const mask = await defaultAssetManager.registerMask(new Uint8ClampedArray([0, 64, 128, 255]), 2, 2);
    const settings = createDefaultDevelopSettings(false);
    settings.masks = [{ id: 'm1', name: 'local', maskAssetId: mask.id, kind: 'linear', geometry: {}, inverted: true, opacity: 0.5, exposure: 1, temperature: 20 }];
    const gpu = fakeWebGL();
    const canvas = { width: 2, height: 2, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;

    try {
      await engine.renderDevelop('source', settings, canvas);
      expect(gpu.drawCount).toBe(5);
      expect(gpu.uploadedMasks).toHaveLength(1);
      expect(Array.from(gpu.uploadedMasks[0])).toEqual([0, 64, 128, 255]);
      expect(gpu.uniforms.get('u_opacity')).toBe(0.5);
      expect(gpu.uniforms.get('u_exposure')).toBe(1);
      expect(gpu.uniforms.get('u_temperature')).toBe(20);
    } finally {
      defaultAssetManager.releaseAsset(mask.id);
    }
  });

  it('rejects a missing mask instead of silently exporting an unmasked image', async () => {
    const engine = await loadedEngine();
    const settings = createDefaultDevelopSettings(false);
    settings.masks = [{ id: 'missing', name: 'missing', maskAssetId: 'missing-mask', kind: 'brush', geometry: {}, inverted: false, opacity: 1, exposure: 1 }];
    const gpu = fakeWebGL();
    const canvas = { width: 2, height: 2, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;

    await expect(engine.renderDevelop('source', settings, canvas)).rejects.toThrow(/missing-mask/);
    expect(gpu.drawCount).toBe(0);
  });

  it('rejects a failed shader compilation instead of drawing a blank result', async () => {
    const engine = await loadedEngine();
    const gpu = fakeWebGL(false);
    const canvas = { width: 2, height: 2, getContext: () => gpu.gl } as unknown as HTMLCanvasElement;

    await expect(engine.renderDevelop('source', createDefaultDevelopSettings(false), canvas)).rejects.toThrow(/shader/i);
    expect(gpu.drawCount).toBe(0);
  });

  it('uses the same mask pass for frontend image export', async () => {
    const engine = await loadedEngine();
    const mask = await defaultAssetManager.registerMask(new Uint8ClampedArray([255, 0, 0, 255]), 2, 2);
    const settings = createDefaultDevelopSettings(false);
    settings.masks = [{ id: 'm1', name: 'local', maskAssetId: mask.id, kind: 'linear', geometry: {}, inverted: false, opacity: 1, exposure: 1 }];
    const gpu = fakeWebGL();
    const canvas = { width: 0, height: 0, getContext: () => gpu.gl, toBlob: (done: (blob: Blob) => void) => done(new Blob(['export'])) } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: () => canvas });

    try {
      const result = await engine.exportDevelopImage('source', settings, { format: 'png' });
      expect(await result.text()).toBe('export');
      expect(gpu.drawCount).toBe(5);
      expect(gpu.uploadedMasks).toHaveLength(1);
      expect(canvas.width).toBe(2);
      expect(canvas.height).toBe(2);
    } finally {
      defaultAssetManager.releaseAsset(mask.id);
    }
  });

  it('loads a cold source before choosing frontend export dimensions', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2 }));
    const source = await defaultAssetManager.registerBlob(new Blob(['image']), 'image', 'source', { width: 2, height: 2 });
    const mask = await defaultAssetManager.registerMask(new Uint8ClampedArray([255, 0, 0, 255]), 2, 2);
    const settings = createDefaultDevelopSettings(false);
    settings.masks = [{ id: 'm1', name: 'local', maskAssetId: mask.id, kind: 'linear', geometry: {}, inverted: false, opacity: 1, exposure: 1 }];
    const gpu = fakeWebGL();
    const canvas = { width: 0, height: 0, getContext: () => gpu.gl, toBlob: (done: (blob: Blob) => void) => done(new Blob(['export'])) } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: () => canvas });

    try {
      await new WebGLImageEngine().exportDevelopImage(source.id, settings, { format: 'png' });
      expect(canvas.width).toBe(2);
      expect(canvas.height).toBe(2);
      expect(gpu.drawCount).toBe(5);
    } finally {
      defaultAssetManager.releaseAsset(source.id);
      defaultAssetManager.releaseAsset(mask.id);
    }
  });
});
