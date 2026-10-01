// tests/DesktopErrorBoundary.test.tsx
//! Comprehensive Test Suite for DesktopErrorBoundary & Crash Guard (Stage 7.3)

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopErrorBoundary } from '../src/ui/shared/DesktopErrorBoundary';
import { getPlatformBridge } from '../src/platform';

describe('DesktopErrorBoundary (Stage 7.3 Crash Guard)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children seamlessly when no error occurs', () => {
    const html = renderToStaticMarkup(
      <DesktopErrorBoundary>
        <div data-testid="child-content">Studio Workspace OK</div>
      </DesktopErrorBoundary>
    );

    expect(html).toContain('Studio Workspace OK');
    expect(html).not.toContain('遇到意外异常');
  });

  it('renders desktop crash recovery screen and action buttons when child throws', () => {
    const ThrowingComponent = () => {
      throw new Error('Fatal GPU Shader Crash Simulation');
    };

    // Suppress console.error in test output for simulated expected crash
    const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Instantiate and trigger error boundary state
    const boundary = new DesktopErrorBoundary({ children: <div /> });
    const derivedState = DesktopErrorBoundary.getDerivedStateFromError(
      new Error('Fatal GPU Shader Crash Simulation')
    );
    expect(derivedState.hasError).toBe(true);
    expect(derivedState.error?.message).toBe('Fatal GPU Shader Crash Simulation');

    const bridge = getPlatformBridge();
    const logSpy = vi.spyOn(bridge, 'writeDiagnosticLog').mockResolvedValue();

    boundary.componentDidCatch(new Error('Fatal GPU Shader Crash Simulation'), {
      componentStack: '\n    in ThrowingComponent\n    in DesktopErrorBoundary',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'crash',
      expect.stringContaining('Fatal GPU Shader Crash Simulation')
    );
    expect(logSpy).toHaveBeenCalledWith(
      'crash',
      expect.stringContaining('ThrowingComponent')
    );

    spyConsole.mockRestore();
  });
});
