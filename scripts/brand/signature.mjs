// Each signature starts with the preferred L stem and shares its lower sweep
// with an S. All segment joins have aligned Bezier endpoint tangents.
export function sharedSignature(stem, radius, waist, upperX, { lowerX = 82, tipX = 98, tailRise = 6 } = {}) {
  // The S bowls use circular quarter arcs so the inside offset never folds
  // into a pointed cusp. Radius exceeds the maximum offset plus half-width.
  const k = radius * 0.5522847498;
  const lowerY = waist + radius, upperY = waist - radius;
  const bottom = [lowerX, waist + 2 * radius];
  const end = stem.at(-1)[3], prev = stem.at(-1)[2];
  const lead = end.map((v, i) => v + (v - prev[i]) * .5);
  const bridge = (lowerX - upperX) / 3;
  return [...stem,
    [end, lead, [lowerX - 9, bottom[1]], bottom],
    [bottom, [lowerX + k, bottom[1]], [lowerX + radius, lowerY + k], [lowerX + radius, lowerY]],
    [[lowerX + radius, lowerY], [lowerX + radius, lowerY - k], [lowerX + k, waist], [lowerX, waist]],
    [[lowerX, waist], [lowerX - bridge, waist], [upperX + bridge, waist], [upperX, waist]],
    [[upperX, waist], [upperX - k, waist], [upperX - radius, upperY + k], [upperX - radius, upperY]],
    [[upperX - radius, upperY], [upperX - radius, upperY - k], [upperX - k, waist - 2 * radius], [upperX, waist - 2 * radius]],
    [[upperX, waist - 2 * radius], [upperX + 8, waist - 2 * radius], [tipX - 8, waist - 2 * radius + tailRise / 2], [tipX, waist - 2 * radius + tailRise]],
  ];
}
