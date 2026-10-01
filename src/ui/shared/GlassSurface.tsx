import type { HTMLAttributes } from 'react';

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'floating' | 'panel';
  shape?: 'rounded-rect' | 'circle' | 'pill';
  refractionScale?: number; chromatic?: boolean; interactive?: boolean; harmonicFlow?: boolean;
}

/** A CSS surface has no canvas encoding, observer or animation loop. */
export function GlassSurface({className='',children,variant='surface',shape: _shape,
  refractionScale: _scale,chromatic: _chromatic,interactive: _interactive,harmonicFlow: _flow,...props}: GlassSurfaceProps) {
  const surfaceClass=variant==='floating'?'glass-floating':variant==='panel'?'glass-panel':'glass-surface';
  return <div {...props} className={surfaceClass + ' ' + className}>{children}</div>;
}
