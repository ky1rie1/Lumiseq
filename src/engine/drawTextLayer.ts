import { TextLayer } from '../types/edit';
import { validateTextEffects } from '../text/TextEffects';

export function textEffectInsets(layer: TextLayer): { left: number; right: number; top: number; bottom: number } {
  validateTextEffects(layer);
  const stroke = layer.stroke?.enabled ? Math.ceil(layer.stroke.width / 2) : 0;
  const shadow = layer.shadow?.enabled && layer.shadow.opacity > 0 ? layer.shadow : undefined;
  const blur = shadow ? Math.ceil(shadow.blur * 3) + stroke : 0;
  return { left: Math.max(stroke, blur - (shadow?.offsetX ?? 0)), right: Math.max(stroke, blur + (shadow?.offsetX ?? 0)),
    top: Math.max(stroke, blur - (shadow?.offsetY ?? 0)), bottom: Math.max(stroke, blur + (shadow?.offsetY ?? 0)) };
}

/** Shared by the preview, raster exports and PSD raster representations. */
export function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer): void {
  validateTextEffects(layer);
  if (!Number.isFinite(layer.fontSize) || layer.fontSize <= 0 || !Number.isFinite(layer.letterSpacing) || (layer.lineHeight !== undefined && (!Number.isFinite(layer.lineHeight) || layer.lineHeight <= 0))) throw new Error('Invalid text typography.');
  ctx.save();
  try {
    ctx.font = `${layer.fontStyle ?? 'normal'} ${layer.fontWeight ?? 'normal'} ${layer.fontSize}px ${layer.fontFamily}`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const alpha = ctx.globalAlpha;
    const lines = layer.text.split(/\r\n|\r|\n/);
    const draw = (stroke: boolean, dx = 0, dy = 0) => lines.forEach((line, index) => {
      const glyphs = Array.from(line);
      const width = ctx.measureText(line).width + Math.max(0, glyphs.length - 1) * layer.letterSpacing;
      let x = (layer.align === 'center' ? layer.transform.width / 2 - width / 2 : layer.align === 'right' ? layer.transform.width - width : 0) + dx;
      const y = index * layer.fontSize * (layer.lineHeight ?? 1.2) + dy;
      const paint = (s: string, at: number) => stroke ? ctx.strokeText(s, at, y) : ctx.fillText(s, at, y);
      if (!layer.letterSpacing) paint(line, x);
      else for (const glyph of glyphs) { paint(glyph, x); x += ctx.measureText(glyph).width + layer.letterSpacing; }
    });
    if (layer.shadow?.enabled && layer.shadow.opacity > 0) {
      ctx.fillStyle = layer.shadow.color; ctx.globalAlpha = alpha * layer.shadow.opacity;
      ctx.filter = layer.shadow.blur ? `blur(${layer.shadow.blur}px)` : 'none';
      draw(false, layer.shadow.offsetX, layer.shadow.offsetY);
    }
    ctx.filter = 'none'; ctx.globalAlpha = alpha;
    if (layer.stroke?.enabled && layer.stroke.width > 0) { ctx.strokeStyle = layer.stroke.color; ctx.lineWidth = layer.stroke.width; draw(true); }
    ctx.fillStyle = layer.color; draw(false);
  } finally { ctx.restore(); }
}
