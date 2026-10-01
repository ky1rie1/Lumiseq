import type { PreviewDimensions } from '../develop/previewDimensions';
import { ReusablePreviewSurface } from '../../../develop/ReusablePreviewSurface';

export class EditPreviewSurface {
  private readonly surface: ReusablePreviewSurface;

  constructor(
    create?: () => HTMLCanvasElement,
    release?: (canvas: HTMLCanvasElement) => void,
  ) {
    this.surface = new ReusablePreviewSurface(create, release);
  }

  async paint(
    size: PreviewDimensions,
    draw: (canvas: HTMLCanvasElement) => Promise<void>,
    present: (canvas: HTMLCanvasElement) => void,
    isCurrent: () => boolean,
  ): Promise<void> {
    await this.surface.render(size, async canvas => {
      await draw(canvas);
      if (isCurrent()) present(canvas);
    });
  }

  dispose(): void { this.surface.dispose(); }
}
