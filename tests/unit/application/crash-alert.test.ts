/**
 * The crash-alert countdown (issue #12 follower safety): the pure transitions
 * and the small controller that arms the escalation timer through an injected
 * clock. Nothing here waits a real minute.
 */

import { describe, expect, it, vi } from "vitest";

import {
  cancelCrashAlertAfterEscalation,
  CRASH_COUNTDOWN_MS,
  crashAlertSnapshot,
  createCrashAlertController,
  dismissCrashAlert,
  escalateCrashAlertNow,
  INITIAL_CRASH_ALERT_STATE,
  startCrashCountdown,
  timeOutCrashCountdown,
  type CrashAlertEvent,
  type CrashAlertScheduler,
} from "@/application/safety/crash-alert";
import type { SuspectedCrash } from "@/domain/safety/crash-detector";

const SUSPECTED: SuspectedCrash = {
  type: "suspected",
  atMs: 10_000,
  location: { lat: 45.5, lon: -122.6 },
};

function countingState(nowMs = 20_000) {
  const result = startCrashCountdown(INITIAL_CRASH_ALERT_STATE, SUSPECTED, nowMs);
  expect(result.events).toHaveLength(1);
  return result.state;
}

interface FakeScheduler extends CrashAlertScheduler {
  advance(byMs: number): void;
  /** Fires the next timer without moving the clock, as an early timer would. */
  fireEarliest(): void;
  readonly scheduled: () => number;
}

function fakeScheduler(startMs = 0): FakeScheduler {
  let now = startMs;
  let nextHandle = 1;
  const timers = new Map<number, { readonly atMs: number; readonly work: () => void }>();
  return {
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
    advance(byMs) {
      now += byMs;
      // A fired timer may schedule the re-arm, so keep draining what is due.
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.atMs <= now)
          .sort((first, second) => first[1].atMs - second[1].atMs);
        const next = due[0];
        if (next === undefined) return;
        timers.delete(next[0]);
        next[1].work();
      }
    },
    fireEarliest() {
      const earliest = [...timers.entries()].sort(
        (first, second) => first[1].atMs - second[1].atMs,
      )[0];
      if (earliest === undefined) return;
      timers.delete(earliest[0]);
      earliest[1].work();
    },
    scheduled: () => timers.size,
  };
}

describe("countdown reducer", () => {
  it("starts a 60 s countdown from idle and says so once", () => {
    const result = startCrashCountdown(INITIAL_CRASH_ALERT_STATE, SUSPECTED, 20_000);
    expect(result.state.phase).toBe("countdown");
    expect(result.state.countdownEndsAtMs).toBe(20_000 + CRASH_COUNTDOWN_MS);
    expect(result.events).toEqual([
      {
        type: "countdown-started",
        suspected: SUSPECTED,
        atMs: 20_000,
        countdownMs: CRASH_COUNTDOWN_MS,
        countdownEndsAtMs: 80_000,
      },
    ]);
    expect(crashAlertSnapshot(result.state, 20_000).secondsRemaining).toBe(60);
  });

  it("ignores a second suspicion while counting down or after escalation", () => {
    const state = countingState();
    expect(startCrashCountdown(state, SUSPECTED, 25_000).events).toEqual([]);

    const escalated = timeOutCrashCountdown(state, 80_000).state;
    expect(escalated.phase).toBe("escalated");
    expect(startCrashCountdown(escalated, SUSPECTED, 90_000).events).toEqual([]);
  });

  it("dismisses only from the countdown, and escalates only after the deadline", () => {
    const state = countingState();
    expect(dismissCrashAlert(state, 30_000)).toEqual({
      state: { ...state, phase: "dismissed" },
      events: [{ type: "dismissed", suspected: SUSPECTED, atMs: 30_000 }],
    });

    const tooEarly = timeOutCrashCountdown(state, 79_999);
    expect(tooEarly.events).toEqual([]);
    expect(tooEarly.state.phase).toBe("countdown");

    const onTime = timeOutCrashCountdown(state, 80_000);
    expect(onTime.state.phase).toBe("escalated");
    expect(onTime.events).toEqual([{ type: "escalated", suspected: SUSPECTED, atMs: 80_000 }]);
  });

  it("never dismisses or re-times an escalated alert, and can cancel it after the fact", () => {
    const escalated = timeOutCrashCountdown(countingState(), 80_000).state;
    expect(dismissCrashAlert(escalated, 81_000).events).toEqual([]);
    expect(escalateCrashAlertNow(escalated, 81_000).events).toEqual([]);

    const cancelled = cancelCrashAlertAfterEscalation(escalated, 90_000);
    expect(cancelled.state.phase).toBe("cancelled-after-alert");
    expect(cancelled.events).toEqual([
      { type: "cancelled-after-alert", suspected: SUSPECTED, atMs: 90_000 },
    ]);
  });

  it("cannot cancel what was never escalated", () => {
    expect(cancelCrashAlertAfterEscalation(countingState(), 30_000).events).toEqual([]);
    expect(cancelCrashAlertAfterEscalation(INITIAL_CRASH_ALERT_STATE, 30_000).events).toEqual([]);
  });

  it("lets the rider alert now, which is an escalation, not a dismissal", () => {
    const result = escalateCrashAlertNow(countingState(), 21_000);
    expect(result.state.phase).toBe("escalated");
    expect(result.events).toEqual([{ type: "escalated", suspected: SUSPECTED, atMs: 21_000 }]);
  });

  it("rounds the remaining seconds up and reports null outside the countdown", () => {
    const state = countingState(20_000);
    expect(crashAlertSnapshot(state, 20_000).secondsRemaining).toBe(60);
    expect(crashAlertSnapshot(state, 20_500).secondsRemaining).toBe(60);
    expect(crashAlertSnapshot(state, 20_999).secondsRemaining).toBe(60);
    expect(crashAlertSnapshot(state, 79_500).secondsRemaining).toBe(1);
    expect(crashAlertSnapshot(state, 90_000).secondsRemaining).toBe(0);
    const dismissed = dismissCrashAlert(state, 25_000).state;
    expect(crashAlertSnapshot(dismissed, 26_000).secondsRemaining).toBeNull();
  });
});

describe("countdown controller", () => {
  it("escalates on its own when the timer runs out", () => {
    const scheduler = fakeScheduler(2_000);
    const events: CrashAlertEvent[] = [];
    const controller = createCrashAlertController({ scheduler, onEvent: (event) => events.push(event) });

    controller.suspect(SUSPECTED);
    expect(controller.snapshot().phase).toBe("countdown");
    expect(controller.snapshot().secondsRemaining).toBe(60);

    scheduler.advance(59_000);
    expect(controller.snapshot().phase).toBe("countdown");

    scheduler.advance(1_000);
    expect(controller.snapshot().phase).toBe("escalated");
    expect(events.map((event) => event.type)).toEqual(["countdown-started", "escalated"]);
    expect(controller.snapshot().secondsRemaining).toBeNull();
  });

  it("cancels the timer when the rider says they are OK", () => {
    const scheduler = fakeScheduler();
    const events: CrashAlertEvent[] = [];
    const controller = createCrashAlertController({ scheduler, onEvent: (event) => events.push(event) });

    controller.suspect(SUSPECTED);
    expect(scheduler.scheduled()).toBe(1);

    controller.dismiss();
    expect(controller.snapshot().phase).toBe("dismissed");
    expect(scheduler.scheduled()).toBe(0);

    scheduler.advance(CRASH_COUNTDOWN_MS * 2);
    expect(events.map((event) => event.type)).toEqual(["countdown-started", "dismissed"]);
  });

  it("escalates immediately on Alert now and cancels the pending timer", () => {
    const scheduler = fakeScheduler();
    const controller = createCrashAlertController({ scheduler });
    controller.suspect(SUSPECTED);
    expect(controller.alertNow().map((event) => event.type)).toEqual(["escalated"]);
    expect(scheduler.scheduled()).toBe(0);
    expect(controller.snapshot().phase).toBe("escalated");

    expect(controller.cancelAfterAlert().map((event) => event.type)).toEqual(["cancelled-after-alert"]);
  });

  it("re-arms when a timer fires early instead of stalling the countdown", () => {
    const scheduler = fakeScheduler();
    const events: string[] = [];
    const controller = createCrashAlertController({
      scheduler,
      onEvent: (event) => events.push(event.type),
    });
    controller.suspect(SUSPECTED);

    // The timer fires at t=0, a minute before the deadline: no escalation, and
    // the countdown is re-armed for the time actually left.
    scheduler.fireEarliest();
    expect(controller.snapshot().phase).toBe("countdown");
    expect(scheduler.scheduled()).toBe(1);

    scheduler.advance(CRASH_COUNTDOWN_MS);
    expect(events).toEqual(["countdown-started", "escalated"]);
    expect(controller.snapshot().phase).toBe("escalated");
  });

  it("reset and dispose both silence the timer", () => {
    const scheduler = fakeScheduler();
    const controller = createCrashAlertController({ scheduler });
    controller.suspect(SUSPECTED);
    controller.reset();
    expect(scheduler.scheduled()).toBe(0);
    expect(controller.snapshot().phase).toBe("idle");

    controller.suspect(SUSPECTED);
    controller.dispose();
    expect(scheduler.scheduled()).toBe(0);
    // A disposed controller is inert: it neither emits nor changes state.
    expect(controller.suspect(SUSPECTED)).toEqual([]);
    expect(controller.snapshot().phase).toBe("countdown");
  });

  it("forwards each transition in order and returns it to the caller", () => {
    const scheduler = fakeScheduler();
    const seen = vi.fn();
    const controller = createCrashAlertController({ scheduler, onEvent: seen });
    const returned = controller.suspect(SUSPECTED);
    expect(returned.map((event) => event.type)).toEqual(["countdown-started"]);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(controller.suspect(SUSPECTED)).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
