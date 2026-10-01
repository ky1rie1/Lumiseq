import { expect, it } from 'vitest';
import { selectionBoundarySegments } from './selectionBoundary';

it('traces the real selected pixels rather than their rectangular bounds', () => {
  //  # .
  //  # #
  const segments = [...selectionBoundarySegments(Uint8ClampedArray.from([255, 0, 255, 255]), 2, 2)];
  expect(segments).toContainEqual([1, 0, 1, 1]);
  expect(segments).toContainEqual([1, 1, 2, 1]);
  expect(segments).not.toContainEqual([2, 0, 2, 1]);
});

it('treats soft mask values below half opacity as outside', () => {
  expect([...selectionBoundarySegments(Uint8ClampedArray.from([127, 128]), 2, 1)]).toEqual([
    [1, 0, 2, 0], [2, 0, 2, 1], [2, 1, 1, 1], [1, 1, 1, 0],
  ]);
});
