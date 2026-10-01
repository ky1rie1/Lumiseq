/** Original synthetic large-image input. Contains no private photographs. */
export const AI_HARNESS_PATTERN = {
  width: 6000,
  height: 4000,
  colors: { red: '#c83c46', green: '#32a064', blue: '#386cc8', ivory: '#e0d8c8' },
  sample: { x: 1800, y: 1400, rgb: [50, 160, 100] as const },
  detail: { x: 1500, y: 1000, width: 1200, height: 800 },
  smallText: { text: 'LS37', x: 1850, baselineY: 1490, fontPixels: 12 },
  edge: { x: 2050, y: 1100, width: 2, height: 500 },
} as const;

export function createAiHarnessPattern(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = AI_HARNESS_PATTERN.width;
  canvas.height = AI_HARNESS_PATTERN.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot render the synthetic AI harness input.');
  const { colors, smallText, edge } = AI_HARNESS_PATTERN;
  context.fillStyle = colors.ivory;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colors.red;
  context.fillRect(0, 0, 3000, 2000);
  context.fillStyle = colors.blue;
  context.fillRect(0, 2000, 3000, 2000);
  context.fillStyle = colors.green;
  context.fillRect(1500, 1000, 1200, 800);
  context.fillStyle = '#101010';
  context.fillRect(edge.x, edge.y, edge.width, edge.height);
  context.font = `${smallText.fontPixels}px sans-serif`;
  context.textBaseline = 'alphabetic';
  context.fillText(smallText.text, smallText.x, smallText.baselineY);
  context.font = '72px sans-serif';
  for (const [text, x, y] of [['TL', 100, 150], ['TR', 5700, 150], ['BL', 100, 3900], ['BR', 5700, 3900]] as const) {
    context.fillStyle = '#101010';
    context.fillText(text, x, y);
  }
  return canvas;
}
