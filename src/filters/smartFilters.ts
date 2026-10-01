import type { SmartFilter, SmartFilterSettings, SmartFilterType } from '../types/edit';

export const SMART_FILTER_LABELS: Record<SmartFilterType, string> = {
  gaussian_blur: '高斯模糊',
  unsharp_mask: '智能锐化',
  noise_reduction: '降噪',
};

export const SMART_FILTER_TYPES = Object.freeze(Object.keys(SMART_FILTER_LABELS) as SmartFilterType[]);

const clamp = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
};

export function isSmartFilterType(value: unknown): value is SmartFilterType {
  return typeof value === 'string' && SMART_FILTER_TYPES.includes(value as SmartFilterType);
}

export function defaultSmartFilterSettings(type: SmartFilterType): SmartFilterSettings {
  if (type === 'gaussian_blur') return { radius: 4 };
  if (type === 'unsharp_mask') return { radius: 2, amount: 1, threshold: 4 };
  return { radius: 2, strength: 0.45, preserveEdges: 0.7 };
}

function normalizeSettings(type: SmartFilterType, settings: unknown): SmartFilterSettings {
  const value = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  if (type === 'gaussian_blur') return { radius: Math.round(clamp(value.radius, 0, 64, 4)) };
  if (type === 'unsharp_mask') return {
    radius: Math.round(clamp(value.radius, 1, 32, 2)),
    amount: clamp(value.amount, 0, 4, 1),
    threshold: Math.round(clamp(value.threshold, 0, 255, 4)),
  };
  return {
    radius: Math.round(clamp(value.radius, 1, 16, 2)),
    strength: clamp(value.strength, 0, 1, 0.45),
    preserveEdges: clamp(value.preserveEdges, 0, 1, 0.7),
  };
}

export function createSmartFilter(type: SmartFilterType, overrides: Partial<SmartFilter> = {}): SmartFilter {
  return normalizeSmartFilter({
    id: overrides.id || `filter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    name: overrides.name || SMART_FILTER_LABELS[type],
    enabled: overrides.enabled ?? true,
    opacity: overrides.opacity ?? 1,
    settings: overrides.settings || defaultSmartFilterSettings(type),
  });
}

export function normalizeSmartFilter(filter: SmartFilter): SmartFilter {
  if (!isSmartFilterType(filter.type)) throw new Error(`Unsupported smart filter type: ${String(filter.type)}`);
  const id = typeof filter.id === 'string' && filter.id.trim() ? filter.id.trim() : `filter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    type: filter.type,
    name: typeof filter.name === 'string' && filter.name.trim() ? filter.name.trim().slice(0, 80) : SMART_FILTER_LABELS[filter.type],
    enabled: filter.enabled !== false,
    opacity: clamp(filter.opacity, 0, 1, 1),
    settings: normalizeSettings(filter.type, filter.settings),
  };
}

function blurPass(source: Float64Array, width: number, height: number, radius: number, horizontal: boolean): Float64Array {
  const output = new Float64Array(source.length);
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  for (let line = 0; line < outer; line++) {
    let sum = 0;
    let count = 0;
    for (let position = -radius; position <= radius; position++) {
      if (position < 0 || position >= inner) continue;
      const index = horizontal ? line * width + position : position * width + line;
      sum += source[index]; count++;
    }
    for (let position = 0; position < inner; position++) {
      const index = horizontal ? line * width + position : position * width + line;
      output[index] = count ? sum / count : source[index];
      const leaving = position - radius;
      const entering = position + radius + 1;
      if (leaving >= 0) {
        const leaveIndex = horizontal ? line * width + leaving : leaving * width + line;
        sum -= source[leaveIndex]; count--;
      }
      if (entering < inner) {
        const enterIndex = horizontal ? line * width + entering : entering * width + line;
        sum += source[enterIndex]; count++;
      }
    }
  }
  return output;
}

function blurAlphaAware(input: Uint8ClampedArray, width: number, height: number, radius: number, passes = 1): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(input);
  const channels: Float64Array[] = Array.from({ length: 4 }, () => new Float64Array(width * height));
  for (let pixel = 0; pixel < width * height; pixel++) {
    const alpha = input[pixel * 4 + 3];
    channels[3][pixel] = alpha;
    for (let channel = 0; channel < 3; channel++) channels[channel][pixel] = input[pixel * 4 + channel] * alpha / 255;
  }
  for (let pass = 0; pass < passes; pass++) {
    for (let channel = 0; channel < 4; channel++) {
      channels[channel] = blurPass(blurPass(channels[channel], width, height, radius, true), width, height, radius, false);
    }
  }
  const output = new Uint8ClampedArray(input.length);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const alpha = channels[3][pixel];
    output[pixel * 4 + 3] = Math.round(alpha);
    if (alpha <= 1e-6) continue;
    for (let channel = 0; channel < 3; channel++) output[pixel * 4 + channel] = Math.round(channels[channel][pixel] * 255 / alpha);
  }
  return output;
}

function applyFilter(input: Uint8ClampedArray, width: number, height: number, filter: SmartFilter): Uint8ClampedArray {
  if (filter.type === 'gaussian_blur') {
    const { radius } = filter.settings as { radius: number };
    return blurAlphaAware(input, width, height, radius, radius > 2 ? 2 : 1);
  }
  if (filter.type === 'unsharp_mask') {
    const { radius, amount, threshold } = filter.settings as { radius: number; amount: number; threshold: number };
    const blurred = blurAlphaAware(input, width, height, radius);
    const output = new Uint8ClampedArray(input);
    for (let i = 0; i < input.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        const delta = input[i + channel] - blurred[i + channel];
        output[i + channel] = Math.abs(delta) < threshold ? input[i + channel] : Math.round(input[i + channel] + amount * delta);
      }
    }
    return output;
  }
  const { radius, strength, preserveEdges } = filter.settings as { radius: number; strength: number; preserveEdges: number };
  const blurred = blurAlphaAware(input, width, height, radius);
  const output = new Uint8ClampedArray(input.length);
  for (let i = 0; i < input.length; i += 4) {
    const sourceLuma = input[i] * 0.2126 + input[i + 1] * 0.7152 + input[i + 2] * 0.0722;
    const blurredLuma = blurred[i] * 0.2126 + blurred[i + 1] * 0.7152 + blurred[i + 2] * 0.0722;
    const edgeProtection = preserveEdges * Math.min(1, Math.abs(sourceLuma - blurredLuma) / 64);
    const mix = strength * (1 - edgeProtection);
    for (let channel = 0; channel < 3; channel++) output[i + channel] = Math.round(input[i + channel] * (1 - mix) + blurred[i + channel] * mix);
    output[i + 3] = input[i + 3];
  }
  return output;
}

function blendFilterResult(before: Uint8ClampedArray, after: Uint8ClampedArray, opacity: number): Uint8ClampedArray {
  if (opacity >= 1) return after;
  const output = new Uint8ClampedArray(before.length);
  for (let i = 0; i < before.length; i += 4) {
    const beforeWeight = before[i + 3] * (1 - opacity);
    const afterWeight = after[i + 3] * opacity;
    const alpha = beforeWeight + afterWeight;
    output[i + 3] = Math.round(alpha);
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      output[i + channel] = Math.round((before[i + channel] * beforeWeight + after[i + channel] * afterWeight) / alpha);
    }
  }
  return output;
}

export function applySmartFilterStack(input: Uint8ClampedArray, width: number, height: number, filters: readonly SmartFilter[]): Uint8ClampedArray {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || input.length !== width * height * 4) throw new Error('Smart filter pixel dimensions are invalid.');
  let current: Uint8ClampedArray = new Uint8ClampedArray(input);
  for (const candidate of filters) {
    const filter = normalizeSmartFilter(candidate);
    if (!filter.enabled || filter.opacity <= 0) continue;
    current = blendFilterResult(current, applyFilter(current, width, height, filter), filter.opacity);
  }
  return current;
}
