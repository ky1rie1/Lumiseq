/** Deterministic Canvas/ImageBitmap substitute at the unavailable Node browser boundary. */
export class SelectionCanvas {
  width = 1; height = 1; pixels = new Uint8ClampedArray(4);
  private tx = 0; private ty = 0; private sx = 1; private sy = 1;
  private stack: number[][] = [];
  fillStyle = ''; globalAlpha = 1; globalCompositeOperation = 'source-over';
  getContext() { return this; }
  save() { this.stack.push([this.tx, this.ty, this.sx, this.sy]); }
  restore() { [this.tx, this.ty, this.sx, this.sy] = this.stack.pop()!; }
  translate(x: number, y: number) { this.tx += x * this.sx; this.ty += y * this.sy; }
  scale(x: number, y: number) { this.sx *= x; this.sy *= y; }
  rotate() { /* Fixtures have no rotation; real transform rotation has separate renderer tests. */ }
  clearRect() { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); }
  fillRect() { if (this.fillStyle === 'rgba(0,0,0,0)' || this.fillStyle === 'transparent') return; throw new Error('Expected transparent composite background'); }
  createImageData(width: number, height: number) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  putImageData(image: { data: Uint8ClampedArray }) { this.pixels = new Uint8ClampedArray(image.data); }
  getImageData() { return { width: this.width, height: this.height, data: new Uint8ClampedArray(this.pixels) }; }
  drawImage(source: SelectionCanvas, x: number, y: number, width = source.width, height = source.height) {
    if (this.pixels.length !== this.width * this.height * 4) this.clearRect();
    for (let j = 0; j < this.height; j++) for (let i = 0; i < this.width; i++) {
      const u = ((i - this.tx) / this.sx - x) / width, v = ((j - this.ty) / this.sy - y) / height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const from = (Math.floor(v * source.height) * source.width + Math.floor(u * source.width)) * 4;
      if (!source.pixels[from + 3]) continue;
      this.pixels.set(source.pixels.subarray(from, from + 4), (j * this.width + i) * 4);
    }
  }
}
