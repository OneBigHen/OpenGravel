/**
 * Defers optional telemetry work until after the page is interactive.
 *
 * The hosted SDK (and especially its session recorder) is not part of the
 * critical path: nothing the rider does depends on it. Scheduling the first
 * import for an idle moment after the window `load` event keeps the SDK chunk
 * and its main-thread cost out of the initial load (13 §1: telemetry never
 * blocks a core flow).
 *
 * `requestIdleCallback` is used when the browser has it, with a bounded
 * `timeout` so a page that never goes idle still loads telemetry eventually.
 * Browsers without it fall back to a plain timer.
 */

/** Schedules `run` for after the page is interactive; returns a cancel function. */
export type TelemetryIdleScheduler = (run: () => void) => () => void;

/** Upper bound for requestIdleCallback's timeout: telemetry loads at most this long after `load`. */
const IDLE_TIMEOUT_MS = 4000;
/** Fallback delay for browsers without requestIdleCallback. */
const FALLBACK_DELAY_MS = 3000;

export const scheduleAfterInteractive: TelemetryIdleScheduler = (run) => {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let idleHandle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (idleHandle !== null) {
      try {
        window.cancelIdleCallback(idleHandle);
      } catch {
        // Telemetry cannot interrupt the application.
      }
      idleHandle = null;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const fire = (): void => {
    if (cancelled) return;
    cancelled = true;
    clear();
    run();
  };

  const scheduleIdle = (): void => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(fire, { timeout: IDLE_TIMEOUT_MS });
    } else {
      timer = setTimeout(fire, FALLBACK_DELAY_MS);
    }
  };

  // Never compete with hydration or the initial route render: wait for the
  // window load event before looking for an idle moment.
  if (document.readyState === "complete") {
    scheduleIdle();
  } else {
    window.addEventListener("load", scheduleIdle, { once: true });
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    window.removeEventListener("load", scheduleIdle);
    clear();
  };
};
