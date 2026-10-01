/** Original synthetic input for browser verification; no external/private media. */
export async function createReferenceColorPattern(type = 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Reference canvas unavailable');
  const colors = ['#C83C46', '#32A064', '#386CC8', '#E0D8C8'];
  colors.forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect((index % 2) * 320, Math.floor(index / 2) * 240, 320, 240);
  });
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Reference image encoding failed'));
  }, type, 0.95));
}
