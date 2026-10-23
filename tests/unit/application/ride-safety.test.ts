/**
 * Ride safety (issue #12 follower safety): the live link and crash detection
 * held together.
 *
 * These tests drive the real detector and the real countdown controller through
 * `createRideSafety`, with a scripted live session and a fake scheduler — so the
 * whole path from "two accelerometer samples and a stopped GPS fix" to
 * `live.raiseAlert("possible-crash")` is exercised without a phone, a network or
 * a real minute.
 *
 * The detector's own rules are covered in `tests/unit/domain/crash-detector`;
 * what matters here is the wiring: detection only runs while sharing, the
 * countdown is the rider's escape hatch, and only the countdown running out (or
 * "Alert now") reaches followers.
 */

import { describe, expect, it, vi } from "vitest";

import type { LiveShareSession, LiveShareSnapshot, LiveShareStatus } from "@/application/live/live-share";
import { CRASH_COUNTDOWN_MS, type CrashAlertScheduler } from "@/application/safety/crash-alert";
import { createRideSafety, type RideSafety, type RideSafetyFix } from "@/application/safety/ride-safety";
import type { LiveAlertReason } from "@/domain/live/types";

const FOLLOW_URL = "https://opengravel.example/follow/tok_1";
const LAT = 45.5;
const LON = -122.6;
const METERS_PER_DEGREE_LAT = 111_320;
/** The impact, just after the last fast fix: the detector reads fixed atMs only. */
const IMPACT_AT_MS = 20_016;
/** The confirming fix: 20 s of stopped fixes after the crash began at 22 s. */
const CONFIRMED_AT_MS = 42_000;

interface FakeLive {
  readonly session: LiveShareSession;
  readonly accept: ReturnType<typeof vi.fn>;
  readonly start: ReturnType<typeof vi.fn>;
  readonly raiseAlert: ReturnType<typeof vi.fn>;
  readonly clearAlert: ReturnType<typeof vi.fn>;
  readonly finish: ReturnType<typeof vi.fn>;
  readonly restore: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  /** Change what the rider's screen is sharing, as the live session would. */
  setStatus(status: LiveShareStatus): void;
}

function fakeLive(status: LiveShareStatus = "sharing"): FakeLive {
  let state: LiveShareSnapshot = {
    status,
    followUrl: status === "sharing" ? FOLLOW_URL : null,
    alert: null,
    lastSentAt: null,
    pending: 0,
    error: null,
  };
  const listeners = new Set<(snapshot: LiveShareSnapshot) => void>();
  const publish = (patch: Partial<LiveShareSnapshot>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const start = vi.fn(async (input: { readonly riderName: string; readonly route?: unknown }) => {
    void input;
    publish({ status: "sharing", followUrl: FOLLOW_URL });
    return FOLLOW_URL;
  });
  const accept = vi.fn();
  const raiseAlert = vi.fn(async (reason: LiveAlertReason) => {
    publish({ alert: reason });
  });
  const clearAlert = vi.fn(async () => {
    publish({ alert: null });
  });
  const finish = vi.fn(async () => {
    publish({ status: "off", followUrl: null, alert: null });
  });
  const restore = vi.fn();
  const dispose = vi.fn();

  return {
    session: {
      snapshot: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      start,
      accept,
      raiseAlert,
      clearAlert,
      finish,
      restore,
      dispose,
    },
    accept,
    start,
    raiseAlert,
    clearAlert,
    finish,
    restore,
    dispose,
    setStatus(next) {
      publish({ status: next, followUrl: next === "sharing" ? FOLLOW_URL : null });
    },
  };
}

interface FakeClock {
  readonly scheduler: CrashAlertScheduler;
  set(ms: number): void;
  /** Move the clock and run every timer that came due (re-arms included). */
  advance(byMs: number): void;
  pending(): number;
}

function fakeClock(startMs = 0): FakeClock {
  let now = startMs;
  let nextHandle = 1;
  const timers = new Map<number, { readonly atMs: number; readonly work: () => void }>();
  return {
    scheduler: {
      now: () => now,
      schedule(work, delayMs) {
        const handle = nextHandle;
        nextHandle += 1;
        timers.set(handle, { atMs: now + delayMs, work });
        return handle;
      },
      cancel(handle) {
        timers.delete(handle as number);
      },
    },
    set(ms) {
      now = ms;
    },
    advance(byMs) {
      now += byMs;
      let fired = true;
      while (fired) {
        fired = false;
        for (const [handle, timer] of [...timers]) {
          if (timer.atMs > now) continue;
          timers.delete(handle);
          timer.work();
          fired = true;
        }
      }
    },
    pending: () => timers.size,
  };
}

interface Harness extends FakeLive {
  readonly safety: RideSafety;
  readonly announce: ReturnType<typeof vi.fn>;
  readonly clock: FakeClock;
}

function harness(status: LiveShareStatus = "sharing"): Harness {
  const live = fakeLive(status);
  const clock = fakeClock();
  const announce = vi.fn();
  const safety = createRideSafety({ live: live.session, scheduler: clock.scheduler, announce });
  return { ...live, safety, announce, clock };
}

function fix(atMs: number, speedMps: number | null, offsetMeters = 0): RideSafetyFix {
  return {
    atMs,
    lat: LAT + offsetMeters / METERS_PER_DEGREE_LAT,
    lon: LON,
    speedMps,
    headingDeg: null,
    accuracyM: 5,
  };
}

/** Gravity at rest, along the device's Z axis. */
function rest(atMs: number) {
  return { atMs, x: 0, y: 0, z: 9.81 };
}

/** A spike measured in g, above the 3.5 g sustained-impact gate. */
function spike(atMs: number, g = 4) {
  return { atMs, x: 0, y: 0, z: g * 9.81 };
}

/** Ride at 12 m/s for 20 s, hit something, then come to rest for 20 s. */
function simulateCrash(safety: RideSafety, clock: FakeClock): void {
  for (let second = 0; second < 20; second += 1) {
    safety.acceptFix(fix(second * 1_000, 12));
  }
  // A two-sample spike 16 ms apart, inside the 100 ms impact window.
  safety.acceptMotion(spike(IMPACT_AT_MS));
  safety.acceptMotion(spike(IMPACT_AT_MS + 16));
  clock.set(IMPACT_AT_MS + 16);
  for (let atMs = 22_000; atMs <= CONFIRMED_AT_MS; atMs += 1_000) {
    clock.set(atMs);
    safety.acceptFix(fix(atMs, 0));
  }
}

describe("crash detection only runs while sharing", () => {
  it("never suspects a crash when the rider is not sharing", () => {
    const h = harness("off");
    simulateCrash(h.safety, h.clock);

    expect(h.safety.snapshot().crash.phase).toBe("idle");
    expect(h.clock.pending()).toBe(0);
    expect(h.announce).not.toHaveBeenCalled();
    expect(h.raiseAlert).not.toHaveBeenCalled();
  });

  it("ignores motion samples until the link is live", () => {
    const h = harness("starting");
    h.safety.acceptMotion(spike(IMPACT_AT_MS));
    expect(h.safety.crashNow().phase).toBe("idle");
  });
});

describe("a suspected crash opens the countdown", () => {
  it("asks the rider before anything reaches followers", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);

    expect(h.safety.snapshot().crash.phase).toBe("countdown");
    expect(h.safety.crashNow().secondsRemaining).toBe(CRASH_COUNTDOWN_MS / 1_000);
    expect(h.raiseAlert).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenCalledWith(expect.stringContaining("I'm OK"));
  });

  it("sends nothing when the rider says they are OK in time", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);

    h.safety.imOkay();

    expect(h.safety.snapshot().crash.phase).toBe("dismissed");
    expect(h.raiseAlert).not.toHaveBeenCalled();
    h.clock.advance(CRASH_COUNTDOWN_MS * 2);
    expect(h.raiseAlert).not.toHaveBeenCalled();
    expect(h.clock.pending()).toBe(0);
  });

  it("escalates when the countdown runs out, and tells followers why", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);

    h.clock.advance(CRASH_COUNTDOWN_MS);

    expect(h.safety.snapshot().crash.phase).toBe("escalated");
    expect(h.raiseAlert).toHaveBeenCalledTimes(1);
    expect(h.raiseAlert).toHaveBeenCalledWith("possible-crash");
    expect(h.announce).toHaveBeenCalledTimes(2);
    expect(h.announce).toHaveBeenLastCalledWith(expect.stringContaining("Alerting your followers"));
  });

  it("escalates immediately on Alert now", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);

    h.safety.alertNow();

    expect(h.safety.snapshot().crash.phase).toBe("escalated");
    expect(h.raiseAlert).toHaveBeenCalledWith("possible-crash");
  });

  it("retracts the alert when the rider says they are OK now", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);
    h.safety.alertNow();

    h.safety.imOkayNow();

    expect(h.safety.snapshot().crash.phase).toBe("cancelled-after-alert");
    expect(h.clearAlert).toHaveBeenCalledTimes(1);
  });

  it("does not escalate after the rider says they are OK now", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);
    h.safety.alertNow();
    h.safety.imOkayNow();

    h.clock.advance(CRASH_COUNTDOWN_MS * 2);

    expect(h.raiseAlert).toHaveBeenCalledTimes(1);
  });
});

describe("the snapshot contract", () => {
  it("returns the same object until something changes", () => {
    const h = harness();
    const first = h.safety.snapshot();
    expect(h.safety.snapshot()).toBe(first);
    expect(h.safety.snapshot()).toBe(first);

    h.setStatus("off");
    const second = h.safety.snapshot();
    expect(second).not.toBe(first);
    expect(second.live.status).toBe("off");
    expect(h.safety.snapshot()).toBe(second);
  });

  it("hands subscribers the new snapshot and stops after dispose", () => {
    const h = harness();
    const listener = vi.fn();
    const unsubscribe = h.safety.subscribe(listener);

    simulateCrash(h.safety, h.clock);
    expect(listener).toHaveBeenCalled();
    const lastCall = listener.mock.calls.at(-1)?.[0] as { crash: { phase: string } };
    expect(lastCall.crash.phase).toBe("countdown");

    unsubscribe();
    listener.mockClear();
    h.setStatus("off");
    expect(listener).not.toHaveBeenCalled();

    h.safety.dispose();
    expect(h.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("sharing and suspending", () => {
  it("starts and stops sharing through the live session", async () => {
    const h = harness("off");

    await expect(h.safety.startSharing({ riderName: "Sam" })).resolves.toBe(FOLLOW_URL);
    expect(h.start).toHaveBeenCalledWith({ riderName: "Sam" });
    expect(h.safety.snapshot().live.status).toBe("sharing");

    await h.safety.stopSharing();
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.safety.snapshot().live.status).toBe("off");
  });

  it("resets a live countdown when the screen is suspended", () => {
    const h = harness();
    simulateCrash(h.safety, h.clock);
    expect(h.safety.snapshot().crash.phase).toBe("countdown");

    h.safety.suspend();

    expect(h.dispose).toHaveBeenCalledTimes(1);
    // The overlay must not survive a teardown it did not see the end of.
    expect(h.safety.snapshot().crash.phase).toBe("idle");
    expect(h.clock.pending()).toBe(0);

    h.clock.advance(CRASH_COUNTDOWN_MS * 2);
    expect(h.raiseAlert).not.toHaveBeenCalled();
  });

  it("restores the shared link after mount and detects crashes again", () => {
    const h = harness();
    h.safety.suspend();

    h.safety.restore();

    expect(h.restore).toHaveBeenCalledTimes(1);
    simulateCrash(h.safety, h.clock);
    expect(h.safety.snapshot().crash.phase).toBe("countdown");
  });

  it("forwards every GPS fix to the live session", () => {
    const h = harness();
    h.safety.acceptFix(fix(1_000, 12));
    expect(h.accept).toHaveBeenCalledWith({
      atMs: 1_000,
      lat: LAT,
      lon: LON,
      speedMps: 12,
      headingDeg: null,
      accuracyM: 5,
    });
  });

  it("leaves an ordinary ride silent", () => {
    const h = harness();
    for (let second = 0; second < 40; second += 1) {
      h.safety.acceptFix(fix(second * 1_000, 12));
      h.safety.acceptMotion(rest(second * 1_000));
    }

    expect(h.safety.snapshot().crash.phase).toBe("idle");
    expect(h.announce).not.toHaveBeenCalled();
    expect(h.raiseAlert).not.toHaveBeenCalled();
  });
});
