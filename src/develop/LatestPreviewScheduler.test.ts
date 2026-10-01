import { expect, it } from 'vitest';
import { LatestPreviewScheduler } from './LatestPreviewScheduler';

function frameQueue() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    request: (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; },
    cancel: (id: number) => { callbacks.delete(id); },
    tick: () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback(0)); },
    get count() { return callbacks.size; },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('coalesces 100 same-frame updates into the latest render', async () => {
  const frames = frameQueue();
  const scheduler = new LatestPreviewScheduler(frames.request, frames.cancel);
  const rendered: number[] = [];
  for (let i = 0; i < 100; i++) scheduler.schedule(async () => { rendered.push(i); });
  expect(frames.count).toBe(1);
  frames.tick(); await settle();
  expect(rendered).toEqual([99]);
});

it('never overlaps jobs, invalidates stale output and renders the final pending state', async () => {
  const frames = frameQueue();
  const scheduler = new LatestPreviewScheduler(frames.request, frames.cancel);
  let finish!: () => void;
  const painted: string[] = [];
  scheduler.schedule(async isCurrent => { await new Promise<void>(resolve => { finish = resolve; }); if (isCurrent()) painted.push('old'); });
  frames.tick();
  scheduler.schedule(async () => { painted.push('intermediate'); });
  scheduler.schedule(async isCurrent => { if (isCurrent()) painted.push('final'); });
  expect(frames.count).toBe(0);
  finish(); await settle(); frames.tick(); await settle();
  expect(painted).toEqual(['final']);
});

it('cancels queued frames and prevents in-flight work from painting after disposal', async () => {
  const frames = frameQueue();
  const scheduler = new LatestPreviewScheduler(frames.request, frames.cancel);
  let finish!: () => void;
  const painted: string[] = [];
  scheduler.schedule(async isCurrent => { await new Promise<void>(resolve => { finish = resolve; }); if (isCurrent()) painted.push('late'); });
  frames.tick(); scheduler.cancel(); finish(); await settle();
  scheduler.schedule(async () => { painted.push('queued'); }); scheduler.cancel(); frames.tick();
  expect(painted).toEqual([]);
});
it('does not starve a slow render when animation frames request refreshes', async () => {
  const frames = frameQueue(); const scheduler = new LatestPreviewScheduler(frames.request, frames.cancel);
  let finish!: () => void; const painted: string[] = [];
  scheduler.schedule(async isCurrent => { await new Promise<void>(resolve => { finish = resolve; }); if (isCurrent()) painted.push('slow'); });
  frames.tick();
  for (let i = 0; i < 10; i++) scheduler.schedule(async () => { painted.push('animation'); }, false);
  finish(); await settle(); frames.tick(); await settle();
  expect(painted).toEqual(['slow', 'animation']);
});
