/** Native window commands stay independent of React and preserve the app's close guard. */
export interface ChromeWindow {
  isMaximized(): Promise<boolean>;
  onResized(callback: () => void): Promise<() => void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
}
export type WindowCommand = 'minimize' | 'toggleMaximize' | 'close' | 'startDragging';

export class WindowChromeController {
  private disposed = false;
  private revision = 0;
  private unlisten?: () => void;

  constructor(
    private readonly window: ChromeWindow,
    private readonly onMaximized: (maximized: boolean) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  async connect(): Promise<void> {
    try {
      const unlisten = await this.window.onResized(() => { void this.refresh(); });
      if (this.disposed) { unlisten(); return; }
      this.unlisten = unlisten;
      await this.refresh();
    } catch (error) { this.report(error); }
  }

  private report(error: unknown): void {
    if (!this.disposed) this.onError(error);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.revision;
    try {
      const maximized = await this.window.isMaximized();
      if (!this.disposed && revision === this.revision) this.onMaximized(maximized);
    } catch (error) { this.report(error); }
  }

  async run(command: WindowCommand): Promise<void> {
    if (this.disposed) return;
    try {
      // close() dispatches onCloseRequested; destroy() would bypass unsaved changes.
      await this.window[command]();
      if (command === 'toggleMaximize') await this.refresh();
    } catch (error) { this.report(error); }
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.unlisten?.();
    this.unlisten = undefined;
  }
}
