import type { PreviewDimensions } from '../ui/workspaces/develop/previewDimensions';

/** Serialized preview jobs share a canvas; teardown waits for their asynchronous resource reads. */
export class ReusablePreviewSurface {
  private canvas: HTMLCanvasElement | null = null;
  private active = 0;
  private disposed = false;
  private cpu = false;

  constructor(
    private create: () => HTMLCanvasElement = () => document.createElement('canvas'),
    private release: (canvas: HTMLCanvasElement) => void = canvas => { canvas.width = canvas.height = 0; },
  ) {}

  async render(size: PreviewDimensions, paint: (canvas: HTMLCanvasElement, forceCPU: boolean) => Promise<void>): Promise<HTMLCanvasElement> {
    if (this.disposed) throw new Error('Preview surface is disposed.');
    const canvas = this.canvas ?? (this.canvas = this.create());
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    ++this.active;
    try { await paint(canvas, this.cpu); return canvas; }
    finally { if (--this.active === 0 && this.disposed) this.releaseCanvas(); }
  }

  useCPU(): void {
    if (this.active) throw new Error('Cannot replace an active preview surface.');
    if (!this.cpu) { this.releaseCanvas(); this.cpu = true; }
  }

  dispose(): void {
    this.disposed = true;
    if (!this.active) this.releaseCanvas();
  }

  private releaseCanvas(): void {
    if (this.canvas) { this.release(this.canvas); this.canvas = null; }
  }
}
