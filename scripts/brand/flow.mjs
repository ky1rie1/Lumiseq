// Original flowing line studies for Lumiseq. Curves are editable Bezier geometry.
const ivory = '#eeeae1';

function curve(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const p = [0, 1].map(i => u ** 3 * p0[i] + 3 * u ** 2 * t * p1[i] + 3 * u * t ** 2 * p2[i] + t ** 3 * p3[i]);
  const d = [0, 1].map(i => 3 * u ** 2 * (p1[i] - p0[i]) + 6 * u * t * (p2[i] - p1[i]) + 3 * t ** 2 * (p3[i] - p2[i]));
  const len = Math.hypot(...d);
  return { p, normal: [-d[1] / len, d[0] / len] };
}

// Offset each edge along the curve normal to produce a tapered, closed ribbon.
// The filled silhouette works without blur, shadows, or colored backplates.
export function ribbon(segments, { start = 3, end = 1, peak = 6, offset = 0, color = ivory, rotate = 0, widthAt, offsetAt, roundCaps = false } = {}) {
  const left = [], right = [];
  for (let s = 0; s < segments.length; s++) {
    for (let j = 0; j <= 60; j++) {
      if (s > 0 && j === 0) continue;
      const t = j / 60;
      const globalT = (s + t) / segments.length;
      const width = widthAt ? widthAt(globalT) : start * (1 - globalT) + end * globalT + peak * Math.sin(Math.PI * globalT) ** 0.85;
      const effectiveOffset = offsetAt ? offsetAt(globalT) : offset;
      const { p, normal } = curve(...segments[s], t);
      const edge = side => p.map((v, i) => v + normal[i] * (effectiveOffset + side * width / 2));
      left.push(edge(1)); right.push(edge(-1));
    }
  }
  const fmt = p => p.map(n => n.toFixed(3)).join(' ');
  const reversedRight = right.reverse();
  let d = `M${[...left, ...reversedRight].map(fmt).join('L')}Z`;
  if (roundCaps) {
    const firstRadius = Math.hypot(left[0][0] - reversedRight.at(-1)[0], left[0][1] - reversedRight.at(-1)[1]) / 2;
    const lastRadius = Math.hypot(left.at(-1)[0] - reversedRight[0][0], left.at(-1)[1] - reversedRight[0][1]) / 2;
    d = `M${left.map(fmt).join('L')}A${lastRadius.toFixed(3)} ${lastRadius.toFixed(3)} 0 0 0 ${fmt(reversedRight[0])}L${reversedRight.slice(1).map(fmt).join('L')}A${firstRadius.toFixed(3)} ${firstRadius.toFixed(3)} 0 0 0 ${fmt(left[0])}Z`;
  }
  return `<path d="${d}" fill="${color}"${rotate ? ` transform="rotate(${rotate} 64 64)"` : ''}/>`;
}
