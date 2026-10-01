import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsModal } from '../src/ui/settings/DiagnosticsModal';
import { defaultProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import { defaultImageEngine } from '../src/engine/WebGLImageEngine';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('settings diagnostics', () => {
  it('keeps diagnostics available for an active unsupported legacy provider', () => {
    vi.stubGlobal('window', {});
    vi.spyOn(defaultProviderRegistry, 'getActiveConfig').mockReturnValue({
      id: 'legacy-rest', name: 'Legacy REST', type: 'custom-rest', model: 'old-model',
      baseUrl: 'https://example.test', enabled: true, isDefault: false,
    });
    vi.spyOn(defaultProviderRegistry, 'getProvider').mockImplementation(() => {
      throw new Error('Unsupported provider protocol: custom-rest');
    });

    const html = renderToStaticMarkup(<DiagnosticsModal isOpen embedded onClose={() => {}} />);

    expect(html).toContain('Legacy REST');
    expect(html).toContain('当前协议不支持对话');
    expect(html).toContain('复制脱敏诊断');
  });

  it('distinguishes the recent develop backend from editing composition', () => {
    vi.stubGlobal('window', {});
    vi.spyOn(defaultImageEngine, 'getRenderingStatus').mockReturnValue({ backend: 'webgl2' });

    const html = renderToStaticMarkup(<DiagnosticsModal isOpen embedded onClose={() => {}} />);

    expect(html).toContain('最近调色渲染后端');
    expect(html).toContain('WebGL 2 GPU');
    expect(html).toContain('编辑合成后端');
    expect(html).toContain('Canvas 2D');
  });
});
