import { expect, it } from 'vitest';
import { ReusablePreviewSurface } from './ReusablePreviewSurface';

it('reuses one detached canvas across 100 serial main and comparison paints', async () => {
  let created = 0; let released = 0;
  const surface = new ReusablePreviewSurface(() => { created++; return { width: 0, height: 0 } as HTMLCanvasElement; }, () => { released++; });
  const targets: HTMLCanvasElement[] = [];
  for (let i = 0; i < 100; i++) await surface.render({ width: i < 50 ? 720 : 1080, height: 480 }, async canvas => { targets.push(canvas); });
  expect(created).toBe(1); expect(new Set(targets).size).toBe(1); expect(released).toBe(0);
  surface.dispose(); surface.dispose(); expect(released).toBe(1);
});

it('defers release until an in-flight render finishes after workspace teardown', async () => {
  let released = 0; let finish!: () => void;
  const surface = new ReusablePreviewSurface(() => ({ width: 1, height: 1 } as HTMLCanvasElement), () => { released++; });
  const job = surface.render({ width: 720, height: 480 }, async () => { await new Promise<void>(resolve => { finish = resolve; }); });
  surface.dispose(); expect(released).toBe(0); finish(); await job; expect(released).toBe(1);
  await expect(surface.render({ width: 1, height: 1 }, async () => {})).rejects.toThrow(/disposed/);
});

it('replaces a failed GPU surface once and keeps the CPU surface for later paints', async () => {
  let created = 0; let released = 0; const modes: boolean[] = [];
  const surface = new ReusablePreviewSurface(() => { created++; return { width: 1, height: 1 } as HTMLCanvasElement; }, () => { released++; });
  await surface.render({ width: 720, height: 480 }, async (_canvas, cpu) => { modes.push(cpu); });
  surface.useCPU();
  await surface.render({ width: 720, height: 480 }, async (_canvas, cpu) => { modes.push(cpu); });
  await surface.render({ width: 720, height: 480 }, async (_canvas, cpu) => { modes.push(cpu); });
  expect(modes).toEqual([false, true, true]); expect(created).toBe(2); expect(released).toBe(1);
  surface.dispose(); expect(released).toBe(2);
});
