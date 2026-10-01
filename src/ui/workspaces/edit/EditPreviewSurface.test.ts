import { expect, it } from 'vitest';
import { EditPreviewSurface } from './EditPreviewSurface';

it('reuses one backing canvas for repeated edits and presents only current frames', async () => {
  let created = 0;
  let released = 0;
  const surface = new EditPreviewSurface(
    () => { created++; return { width: 0, height: 0 } as HTMLCanvasElement; },
    () => { released++; },
  );
  const presented: string[] = [];

  for (let index = 0; index < 100; index++) {
    await surface.paint(
      { width: 1280, height: 720 },
      async () => {},
      () => presented.push(String(index)),
      () => true,
    );
  }
  expect(created).toBe(1);
  expect(presented).toHaveLength(100);

  await surface.paint(
    { width: 1280, height: 720 },
    async () => {},
    () => presented.push('stale'),
    () => false,
  );
  expect(presented).not.toContain('stale');
  surface.dispose();
  expect(released).toBe(1);
});

it('keeps the active canvas alive until an asynchronous paint finishes during teardown', async () => {
  let finish!: () => void;
  let released = 0;
  const surface = new EditPreviewSurface(
    () => ({ width: 0, height: 0 } as HTMLCanvasElement),
    () => { released++; },
  );
  const presented: string[] = [];
  const job = surface.paint(
    { width: 800, height: 600 },
    () => new Promise<void>(resolve => { finish = resolve; }),
    () => presented.push('late'),
    () => false,
  );
  surface.dispose();
  expect(released).toBe(0);
  finish();
  await job;
  expect(released).toBe(1);
  expect(presented).toEqual([]);
});
