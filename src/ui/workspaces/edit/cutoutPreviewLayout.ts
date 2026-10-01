/** Center the fitted preview; grow the scroll surface for magnified image edges. */
export function cutoutPreviewLayout(width: number, height: number, frameWidth: number, frameHeight: number, zoom: number) {
  const scale = Math.min(Math.max(1, frameWidth - 48) / width, Math.max(1, frameHeight - 48) / height) * zoom;
  const displayWidth = Math.round(width * scale), displayHeight = Math.round(height * scale);
  return { width: displayWidth, height: displayHeight, contentWidth: Math.max(frameWidth, displayWidth + 48), contentHeight: Math.max(frameHeight, displayHeight + 48) };
}
