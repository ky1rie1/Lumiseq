import { expect, it } from 'vitest';
import { LocalSegmentationProvider } from './LocalSegmentationProvider';
it('reports the actual heuristic algorithm instead of a model that never ran', async () => {
  const provider = new LocalSegmentationProvider();
  const result = await provider.segmentSubject({ data: new Uint8ClampedArray(16), width: 2, height: 2 } as ImageData);
  expect(result.model.toLowerCase()).toContain('heuristic');
  expect(result.provider).toBe('heuristic-local');
  expect(result.confidence).toBe(0);
});
