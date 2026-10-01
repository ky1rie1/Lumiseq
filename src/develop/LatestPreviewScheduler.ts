type PreviewJob = (isCurrent: () => boolean) => Promise<void>;

/** One asynchronous render at a time, keeping only the latest pending frame. */
export class LatestPreviewScheduler {
  private generation = 0;
  private pending: { job: PreviewJob; generation: number } | null = null;
  private frame: number | null = null;
  private running = false;

  constructor(
    private request: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
    private cancelFrame: (id: number) => void = id => cancelAnimationFrame(id),
  ) {}

  schedule(job: PreviewJob, invalidateRunning = true): void {
    if (invalidateRunning) ++this.generation;
    this.pending = { job, generation: this.generation };
    this.queueFrame();
  }

  cancel(): void {
    ++this.generation;
    this.pending = null;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }

  private queueFrame(): void {
    if (this.running || this.frame !== null || !this.pending) return;
    this.frame = this.request(() => {
      this.frame = null;
      const pending = this.pending;
      if (!pending) return;
      this.pending = null;
      this.running = true;
      const isCurrent = () => pending.generation === this.generation;
      // Callers handle render failures locally so stale failures cannot update the UI.
      void pending.job(isCurrent).finally(() => {
        this.running = false;
        this.queueFrame();
      });
    });
  }
}
