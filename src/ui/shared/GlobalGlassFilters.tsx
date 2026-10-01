import { useEffect, useRef } from 'react';
import { generateDisplacementMapData, LiquidGlassState } from './liquidGlassShader';
import { useAppearanceStore } from '../../stores/useAppearanceStore';

/**
 * Global SVG filter definitions providing Apple-grade liquid glass optical refraction
 * across all glass surfaces and materials in AI Creative Studio.
 * References: Shu Ding (https://github.com/shuding/liquid-glass)
 */
export function GlobalGlassFilters() {
  const glass = useAppearanceStore(s => s.glass);
  const reduceMotion = useAppearanceStore(s => s.reduceMotion);

  const surfaceMapRef = useRef<SVGFEImageElement>(null);
  const floatingMapRef = useRef<SVGFEImageElement>(null);
  const panelMapRef = useRef<SVGFEImageElement>(null);
  const lensMapRef = useRef<SVGFEImageElement>(null);

  useEffect(() => {
    if (glass === 'off') return;

    const dummyState: LiquidGlassState = {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: false,
      pointerDown: false,
      ripplePhase: 0,
      rippleAmplitude: 0,
      flowTime: 0,
    };

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Surface filter map (cards, modals: aspect ratio ~1.55)
    canvas.width = 128;
    canvas.height = 80;
    const surfaceData = generateDisplacementMapData(128, 80, dummyState, {
      width: 140,
      height: 90,
      shape: 'rounded-rect',
      radius: 0.18,
      bevelWidth: 0.22,
    });
    ctx.putImageData(new ImageData(surfaceData.data, 128, 80), 0, 0);
    surfaceMapRef.current?.setAttribute('href', canvas.toDataURL('image/png'));

    // 2. Floating filter map (floating pill taskbars & badges: aspect ratio ~4.0)
    canvas.width = 160;
    canvas.height = 64;
    const floatingData = generateDisplacementMapData(160, 64, dummyState, {
      width: 240,
      height: 60,
      shape: 'pill',
      bevelWidth: 0.28,
    });
    ctx.putImageData(new ImageData(floatingData.data, 160, 64), 0, 0);
    floatingMapRef.current?.setAttribute('href', canvas.toDataURL('image/png'));

    // 3. Panel filter map (sidebars, inspection overlays: aspect ratio ~1.2)
    canvas.width = 128;
    canvas.height = 96;
    const panelData = generateDisplacementMapData(128, 96, dummyState, {
      width: 120,
      height: 100,
      shape: 'rounded-rect',
      radius: 0.12,
      bevelWidth: 0.18,
    });
    ctx.putImageData(new ImageData(panelData.data, 128, 96), 0, 0);
    panelMapRef.current?.setAttribute('href', canvas.toDataURL('image/png'));

    // 4. Circular Lens filter map (pure circle 1.0 for sculpture aperture & lenses)
    canvas.width = 96;
    canvas.height = 96;
    const lensData = generateDisplacementMapData(96, 96, dummyState, {
      width: 96,
      height: 96,
      shape: 'circle',
      bevelWidth: 0.35,
    });
    ctx.putImageData(new ImageData(lensData.data, 96, 96), 0, 0);
    lensMapRef.current?.setAttribute('href', canvas.toDataURL('image/png'));
  }, [glass, reduceMotion]);

  if (glass === 'off') {
    return null;
  }

  return (
    <svg
      id="liquid-glass-global-svg-defs"
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: 0,
        zIndex: -1,
      }}
    >
      <defs>
        {/* Surface Refraction Filter (Cards, Modals, Menus) */}
        <filter
          id="liquid-glass-surface-filter"
          filterUnits="objectBoundingBox"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            ref={surfaceMapRef}
            id="liquid-glass-surface-map"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="surface_map"
          />
          {/* Chromatic Dispersion Red channel */}
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="red_src"
          />
          <feDisplacementMap
            in="red_src"
            in2="surface_map"
            scale="18"
            xChannelSelector="R"
            yChannelSelector="G"
            result="red_disp"
          />
          {/* Green channel */}
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="green_src"
          />
          <feDisplacementMap
            in="green_src"
            in2="surface_map"
            scale="15"
            xChannelSelector="R"
            yChannelSelector="G"
            result="green_disp"
          />
          {/* Blue channel */}
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="blue_src"
          />
          <feDisplacementMap
            in="blue_src"
            in2="surface_map"
            scale="12"
            xChannelSelector="R"
            yChannelSelector="G"
            result="blue_disp"
          />
          {/* Prismatic Recombination */}
          <feBlend in="red_disp" in2="green_disp" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue_disp" mode="screen" result="refracted" />
        </filter>

        {/* Floating Refraction Filter (Selection bar, Floating badges) */}
        <filter
          id="liquid-glass-floating-filter"
          filterUnits="objectBoundingBox"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            ref={floatingMapRef}
            id="liquid-glass-floating-map"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="floating_map"
          />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="red_src_fl"
          />
          <feDisplacementMap
            in="red_src_fl"
            in2="floating_map"
            scale="24"
            xChannelSelector="R"
            yChannelSelector="G"
            result="red_disp_fl"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="green_src_fl"
          />
          <feDisplacementMap
            in="green_src_fl"
            in2="floating_map"
            scale="20"
            xChannelSelector="R"
            yChannelSelector="G"
            result="green_disp_fl"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="blue_src_fl"
          />
          <feDisplacementMap
            in="blue_src_fl"
            in2="floating_map"
            scale="16"
            xChannelSelector="R"
            yChannelSelector="G"
            result="blue_disp_fl"
          />
          <feBlend in="red_disp_fl" in2="green_disp_fl" mode="screen" result="rg_fl" />
          <feBlend in="rg_fl" in2="blue_disp_fl" mode="screen" result="refracted_fl" />
        </filter>

        {/* Panel Refraction Filter */}
        <filter
          id="liquid-glass-panel-filter"
          filterUnits="objectBoundingBox"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            ref={panelMapRef}
            id="liquid-glass-panel-map"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="panel_map"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="panel_map"
            scale="10"
            xChannelSelector="R"
            yChannelSelector="G"
            result="refracted_panel"
          />
        </filter>

        {/* Circular Lens Refraction Filter (Sculpture Aperture / Eye) */}
        <filter
          id="liquid-glass-lens-filter"
          filterUnits="objectBoundingBox"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            ref={lensMapRef}
            id="liquid-glass-lens-map"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="lens_map"
          />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="red_src_lens"
          />
          <feDisplacementMap
            in="red_src_lens"
            in2="lens_map"
            scale="30"
            xChannelSelector="R"
            yChannelSelector="G"
            result="red_disp_lens"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="green_src_lens"
          />
          <feDisplacementMap
            in="green_src_lens"
            in2="lens_map"
            scale="25"
            xChannelSelector="R"
            yChannelSelector="G"
            result="green_disp_lens"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            in="SourceGraphic"
            result="blue_src_lens"
          />
          <feDisplacementMap
            in="blue_src_lens"
            in2="lens_map"
            scale="20"
            xChannelSelector="R"
            yChannelSelector="G"
            result="blue_disp_lens"
          />
          <feBlend in="red_disp_lens" in2="green_disp_lens" mode="screen" result="rg_lens" />
          <feBlend in="rg_lens" in2="blue_disp_lens" mode="screen" result="refracted_lens" />
        </filter>
      </defs>
    </svg>
  );
}
