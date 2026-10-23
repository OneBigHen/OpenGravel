import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAfterInteractive } from "@/infrastructure/telemetry/idle-scheduler";

/**
 * The deferred telemetry scheduler: the SDK import must not run during the
 * initial load, must still run eventually on a page that never goes idle, and
 * must be cancellable (consent withdrawal / unmount).
 */

const originalIdle = window.requestIdleCallback;
const originalCancelIdle = window.cancelIdleCallback;

function withoutIdleCallback(): void {
  // jsdom has no requestIdleCallback; force the fallback path explicitly.
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, writable: true, value: undefined });
}

function setReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, "readyState", { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
  withoutIdleCallback();
  setReadyState("complete");
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, writable: true, value: originalIdle });
  Object.defineProperty(window, "cancelIdleCallback", { configurable: true, writable: true, value: originalCancelIdle });
});

describe("scheduleAfterInteractive", () => {
  it("does not run during the initial load and falls back to a timer without requestIdleCallback", () => {
    const run = vi.fn();
    scheduleAfterInteractive(run);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending deferral", () => {
    const run = vi.fn();
    const cancel = scheduleAfterInteractive(run);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses requestIdleCallback with a bounded timeout when the browser has it", () => {
    const pending: { idle: ((deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) | null } = { idle: null };
    const requestIdleCallback = vi.fn((callback, options?: { timeout?: number }) => {
      pending.idle = callback;
      expect(options).toEqual({ timeout: 4000 });
      return 42;
    });
    const cancelIdleCallback = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", { configurable: true, writable: true, value: requestIdleCallback });
    Object.defineProperty(window, "cancelIdleCallback", { configurable: true, writable: true, value: cancelIdleCallback });
    const run = vi.fn();
    scheduleAfterInteractive(run);
    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    pending.idle?.({ didTimeout: true, timeRemaining: () => 0 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancels an idle callback when disposed before the idle moment", () => {
    const pending: { idle: ((deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) | null } = { idle: null };
    Object.defineProperty(window, "requestIdleCallback", { configurable: true, writable: true, value: (callback: typeof pending.idle) => { pending.idle = callback; return 42; } });
    const cancelIdleCallback = vi.fn();
    Object.defineProperty(window, "cancelIdleCallback", { configurable: true, writable: true, value: cancelIdleCallback });
    const run = vi.fn();
    const cancel = scheduleAfterInteractive(run);
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
    pending.idle?.({ didTimeout: false, timeRemaining: () => 50 });
    expect(run).not.toHaveBeenCalled();
  });

  it("waits for the window load event before deferring", () => {
    setReadyState("interactive");
    const run = vi.fn();
    scheduleAfterInteractive(run);
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
