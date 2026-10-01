export interface RunBudgetOptions {
  maxSteps?: number; maxToolCalls?: number; maxImages?: number; maxDetailTiles?: number;
  maxRepairRounds?: number; requestTimeoutMs?: number; overallTimeoutMs?: number; complexGoal?: boolean;
}
export interface RunBudgetState { modelSteps: number; toolCalls: number; images: number; imageBytes: number; detailTiles: number; repairRounds: number; }
export class HarnessStop extends Error {
  constructor(public reason: string, public exhausted = false) { super(reason); }
}
function limit(value: number | undefined, ceiling: number): number {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Run budgets must be nonnegative integers');
  return Math.min(value, ceiling);
}
export class RunBudget {
  readonly state: RunBudgetState = { modelSteps: 0, toolCalls: 0, images: 0, imageBytes: 0, detailTiles: 0, repairRounds: 0 };
  readonly limits: Required<Omit<RunBudgetOptions, 'complexGoal'>>;
  readonly startedAt = Date.now();
  constructor(options: RunBudgetOptions = {}) {
    this.limits = { maxSteps: limit(options.maxSteps, 20), maxToolCalls: limit(options.maxToolCalls, 40), maxImages: limit(options.maxImages, 16),
      maxDetailTiles: limit(options.maxDetailTiles, options.complexGoal ? 16 : 4), maxRepairRounds: limit(options.maxRepairRounds, 2),
      requestTimeoutMs: limit(options.requestTimeoutMs, 120_000), overallTimeoutMs: limit(options.overallTimeoutMs, 600_000) };
  }
  checkTime(): void { if (Date.now() - this.startedAt >= this.limits.overallTimeoutMs) throw new HarnessStop('overall_timeout', true); }
  bindProviderTimeout(timeoutMs?:number):void {
    if(timeoutMs!==undefined)this.limits.requestTimeoutMs=Math.min(this.limits.requestTimeoutMs,limit(timeoutMs,120_000));
  }
  take(kind: 'modelSteps' | 'toolCalls' | 'images' | 'detailTiles' | 'repairRounds'): void {
    this.checkTime();
    const keys = { modelSteps: 'maxSteps', toolCalls: 'maxToolCalls', images: 'maxImages', detailTiles: 'maxDetailTiles', repairRounds: 'maxRepairRounds' } as const;
    if (this.state[kind] >= this.limits[keys[kind]]) throw new HarnessStop(`${keys[kind]}_exhausted`, true);
    this.state[kind]++;
  }
  /** Enforces timeout even for connectors which resolve late or ignore their signal. */
  async request<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, countModelStep = true): Promise<T> {
    if (countModelStep) this.take('modelSteps'); else this.checkTime();
    const controller = new AbortController();
    const remaining = this.limits.overallTimeoutMs - (Date.now() - this.startedAt);
    const overall = remaining <= this.limits.requestTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined, onAbort!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => { controller.abort(); reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); };
      parent.addEventListener('abort', onAbort, { once: true });
      if (parent.aborted) onAbort();
      timer = setTimeout(() => { controller.abort(); reject(new HarnessStop(overall ? 'overall_timeout' : 'provider_timeout', overall)); }, Math.min(remaining, this.limits.requestTimeoutMs));
    });
    try { return await Promise.race([operation(controller.signal), stopped]); }
    finally { clearTimeout(timer); parent.removeEventListener('abort', onAbort); }
  }
}
