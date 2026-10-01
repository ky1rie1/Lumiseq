/** Repairs short model dropouts inside similarly coloured subject pixels. */
export function repairMaskGaps(mask: Uint8ClampedArray, rgba: Uint8ClampedArray, width: number, height: number, radius = 3): Uint8ClampedArray {
  if (mask.length !== width * height || rgba.length !== mask.length * 4 || width < 1 || height < 1 || radius < 1 || radius > 8) {
    throw new Error('抠图连贯性数据无效。');
  }
  const result = new Uint8ClampedArray(mask);
  const strong = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] >= 192;
  const sameColor = (pixel: number, neighbor: number) => {
    for (let c = 0; c < 3; c++) if (Math.abs(rgba[pixel * 4 + c] - rgba[neighbor * 4 + c]) > 36) return false;
    return true;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (mask[index] >= 128 || rgba[index * 4 + 3] < 128) continue;
    const bridge = (dx: number, dy: number) => {
      let first = -1, second = -1;
      for (let distance = 1; distance <= radius; distance++) {
        if (first < 0 && strong(x - dx * distance, y - dy * distance)) first = (y - dy * distance) * width + x - dx * distance;
        if (second < 0 && strong(x + dx * distance, y + dy * distance)) second = (y + dy * distance) * width + x + dx * distance;
      }
      return first >= 0 && second >= 0 && sameColor(index, first) && sameColor(index, second);
    };
    if (bridge(1, 0) || bridge(0, 1)) result[index] = Math.max(mask[index], 208);
  }
  extendConnectedSubjectByColor(mask, rgba, result, width, height);
  return result;
}

/** Use colour evidence only when confident foreground and edge background are distinct. */
function extendConnectedSubjectByColor(mask: Uint8ClampedArray, rgba: Uint8ClampedArray, result: Uint8ClampedArray, width: number, height: number): void {
  const bins = 16 * 16 * 16;
  const fg = new Int32Array(bins), bg = new Int32Array(bins);
  const bin = (index: number) => (rgba[index * 4] >> 4) * 256 + (rgba[index * 4 + 1] >> 4) * 16 + (rgba[index * 4 + 2] >> 4);
  let minX = width, minY = height, maxX = -1, maxY = -1, fgCount = 0, bgCount = 0;
  const border = Math.max(1, Math.ceil(Math.min(width, height) * 0.07));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (rgba[index * 4 + 3] < 128) continue;
    if (mask[index] >= 192) {
      fg[bin(index)]++; fgCount++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else if (mask[index] <= 16 && (x < border || y < border || x >= width - border || y >= height - border)) {
      bg[bin(index)]++; bgCount++;
    }
  }
  if (fgCount < 16 || bgCount < 16) return;
  const support = (counts: Int32Array) => {
    const values = new Int32Array(bins);
    for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) {
      let total = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
        const nr = r + dr, ng = g + dg, nb = b + db;
        if (nr >= 0 && nr < 16 && ng >= 0 && ng < 16 && nb >= 0 && nb < 16) total += counts[nr * 256 + ng * 16 + nb];
      }
      values[r * 256 + g * 16 + b] = total;
    }
    return values;
  };
  const fgSupport = support(fg), bgSupport = support(bg);
  const pad = Math.max(4, Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.2));
  const x0 = Math.max(0, minX - pad), x1 = Math.min(width - 1, maxX + pad);
  const y0 = Math.max(0, minY - pad), y1 = Math.min(height - 1, maxY + pad);
  const eligible = new Uint8Array(mask.length), visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const index = y * width + x;
    if (rgba[index * 4 + 3] < 128) continue;
    const colour = bin(index);
    const foregroundShare = fgSupport[colour] / fgCount;
    const backgroundShare = bgSupport[colour] / bgCount;
    if (mask[index] >= 128 || (fgSupport[colour] >= 8 && foregroundShare >= 3 * backgroundShare + 0.005)) eligible[index] = 1;
    if (mask[index] >= 192) { visited[index] = 1; queue[tail++] = index; }
  }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    if (mask[index] < 128) result[index] = Math.max(result[index], 208);
    const visit = (candidate: number) => {
      if (eligible[candidate] && !visited[candidate]) { visited[candidate] = 1; queue[tail++] = candidate; }
    };
    if (x > x0) visit(index - 1);
    if (x < x1) visit(index + 1);
    if (y > y0) visit(index - width);
    if (y < y1) visit(index + width);
  }
}
