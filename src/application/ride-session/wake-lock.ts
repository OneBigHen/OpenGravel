/** Injected screen-wake-lock lifecycle (08 §8). */

export interface WakeLockLease {
  release(): Promise<void> | void;
}

export interface WakeLockPort {
  request(): Promise<WakeLockLease>;
}

export interface WakeLockState {
  readonly status:
    | "idle"
    | "requesting"
    | "active"
    | "released"
    | "unsupported"
    | "failed";
  readonly message: string | null;
}

export interface WakeLockCoordinator {
  snapshot(): WakeLockState;
  /** False means unavailable/failed; it is never a session failure. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export function createWakeLockCoordinator(
  port: WakeLockPort | null,
): WakeLockCoordinator {
  let lease: WakeLockLease | null = null;
  let pending: Promise<boolean> | null = null;
  let state: WakeLockState = {
    status: port === null ? "unsupported" : "idle",
    message: port === null ? "Screen wake lock is not supported on this device." : null,
  };

  async function request(): Promise<boolean> {
    if (port === null) return false;
    state = { status: "requesting", message: null };
    try {
      lease = await port.request();
      state = { status: "active", message: null };
      return true;
    } catch {
      lease = null;
      state = {
        status: "failed",
        message: "The screen may dim because wake lock is unavailable.",
      };
      return false;
    } finally {
      pending = null;
    }
  }

  return {
    snapshot(): WakeLockState {
      return state;
    },

    acquire(): Promise<boolean> {
      if (lease !== null) return Promise.resolve(true);
      if (pending !== null) return pending;
      pending = request();
      return pending;
    },

    async release(): Promise<void> {
      if (pending !== null) await pending;
      const current = lease;
      lease = null;
      if (current === null) return;
      try {
        await current.release();
        state = { status: "released", message: null };
      } catch {
        state = {
          status: "failed",
          message: "The screen wake lock could not be released cleanly.",
        };
      }
    },
  };
}
