/** Emits clockwise boundary edges for pixels selected at 50% opacity or more. */
export function* selectionBoundarySegments(mask: Uint8ClampedArray, width: number, height: number): Generator<[number, number, number, number]> {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] >= 128;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) yield [x, y, x + 1, y];
      if (!inside(x + 1, y)) yield [x + 1, y, x + 1, y + 1];
      if (!inside(x, y + 1)) yield [x + 1, y + 1, x, y + 1];
      if (!inside(x - 1, y)) yield [x, y + 1, x, y];
    }
  }
}

/** Joins pixel boundary edges into continuous paths so dash phase moves along the contour. */
export function buildSelectionOutline(mask: Uint8ClampedArray, width: number, height: number): Path2D {
  const segments = [...selectionBoundarySegments(mask, width, height)];
  const starts = new Map<string, number[]>();
  segments.forEach(([x, y], index) => {
    const key = `${x},${y}`;
    const list = starts.get(key) ?? [];
    list.push(index);
    starts.set(key, list);
  });
  const used = new Uint8Array(segments.length);
  const path = new Path2D();
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    let index = i;
    const [startX, startY] = segments[index];
    path.moveTo(startX, startY);
    while (!used[index]) {
      used[index] = 1;
      const [, , endX, endY] = segments[index];
      path.lineTo(endX, endY);
      const next = starts.get(`${endX},${endY}`)?.find(candidate => !used[candidate]);
      if (next === undefined) break;
      index = next;
    }
    path.closePath();
  }
  return path;
}
