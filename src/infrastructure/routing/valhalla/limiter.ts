/**
 * A server-side pacing gate: at most one upstream call per `intervalMs`.
 *
 * The FOSSGIS public Valhalla server asks for no more than one request a second.
 * Calls are given start slots in arrival order; a call that would have to wait
 * longer than `maxWaitMs` is refused at once (the rider sees "busy") rather than
 * left queued behind a burst.
 */

export class LimiterBusyError extends Error {
  constructor() {
    super("rate limiter queue is full");
    this.name = "LimiterBusyError";
  }
}

export interface IntervalLimiter {
  /** Resolves when the caller may start; rejects with `LimiterBusyError` or the signal's reason. */
  acquire(signal?: AbortSignal): Promise<void>;
}

export function createIntervalLimiter(options: {
  readonly intervalMs: number;
  readonly maxWaitMs: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): IntervalLimiter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  let nextSlot = Number.NEGATIVE_INFINITY;
  return {
    async acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) throw signal.reason;
      const time = now();
      const start = Math.max(time, nextSlot);
      const wait = start - time;
      if (wait > options.maxWaitMs) throw new LimiterBusyError();
      nextSlot = start + options.intervalMs;
      if (wait > 0) await sleep(wait, signal);
    },
  };
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
