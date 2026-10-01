import { TextEffects } from '../types/edit';

/** Bounded document-pixel values prevent accidental giant effect buffers. */
export function validateTextEffects(effects: TextEffects): void {
  const number = (value: number, min: number, max: number, name: string) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid text ${name} (${min}–${max}).`);
  };
  const style = (value: { enabled: boolean; color: string }) => {
    if (typeof value.enabled !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(value.color)) throw new Error('Text effect requires a toggle and six-digit hex color.');
  };
  if (effects.stroke !== undefined) { style(effects.stroke); number(effects.stroke.width, 0, 256, 'stroke width'); }
  if (effects.shadow !== undefined) {
    style(effects.shadow);
    number(effects.shadow.opacity, 0, 1, 'shadow opacity');
    number(effects.shadow.blur, 0, 256, 'shadow blur');
    number(effects.shadow.offsetX, -2048, 2048, 'shadow X');
    number(effects.shadow.offsetY, -2048, 2048, 'shadow Y');
  }
}
