/**
 * The crash-alert countdown (issue #12 follower safety): what happens between
 * "the detector suspects a crash" and "the people watching the ride know".
 *
 * A suspicion is never an alarm by itself. The rider gets `CRASH_COUNTDOWN_MS`
 * (60 s) to say they are OK — the screen, voice and vibration are the ride
 * screen's business; this module only owns the state and the timer. Two exits:
 *
 * - **`dismissed`** — the rider tapped "I'm OK" inside the countdown. Nothing
 *   is sent. The detector withholds the next suspicion for its own debounce.
 * - **`escalated`** — the countdown ran out (or the rider chose "Alert now").
 *   This is the event the ride screen turns into a live-follower alert with
 *   the rider's location, a voice prompt and so on.
 *
 * After escalation the rider can still say "I'm OK now" — that is
 * `cancelled-after-alert`, not `dismissed`: the alert already went out, and
 * the ride screen has to retract or stand down *because* followers were told.
 * Keeping the two apart is what stops the UI from claiming nothing was sent.
 *
 * The reducer is pure and clock-injected: every function takes `nowMs`, and the
 * only imperative thing in the module is the small controller that arms a
 * timer through the injected scheduler. No `Date.now`, no `setTimeout` and no
 * listener list live in the reducer, so the whole flow can be replayed in a
 * test without waiting a minute.
 */

import type { SuspectedCrash } from "@/domain/safety/crash-detector";

/** How long the rider has to say "I'm OK" before followers are alerted. */
export const CRASH_COUNTDOWN_MS = 60_000;

/**
 * `idle` — nothing suspected.
 * `countdown` — suspected, waiting for the rider.
 * `escalated` — the alert is out.
 * `dismissed` — the rider said they are OK in time; nothing was sent.
 * `cancelled-after-alert` — the alert went out and the rider then said they
 * are OK; the ride screen must retract it.
 */
export type CrashAlertPhase = "idle" | "countdown" | "escalated" | "dismissed" | "cancelled-after-alert";

export interface CrashAlertState {
  readonly phase: CrashAlertPhase;
  /** The suspicion this flow is about; `null` only in `idle`. */
  readonly suspected: SuspectedCrash | null;
  readonly countdownStartedAtMs: number | null;
  readonly countdownEndsAtMs: number | null;
}

export const INITIAL_CRASH_ALERT_STATE: CrashAlertState = {
  phase: "idle",
  suspected: null,
  countdownStartedAtMs: null,
  countdownEndsAtMs: null,
};

/** The ride screen's hook into the flow: one event per real transition. */
export type CrashAlertEvent =
  | {
      readonly type: "countdown-started";
      readonly suspected: SuspectedCrash;
      readonly atMs: number;
      readonly countdownMs: number;
      readonly countdownEndsAtMs: number;
    }
  | { readonly type: "dismissed"; readonly suspected: SuspectedCrash; readonly atMs: number }
  | { readonly type: "escalated"; readonly suspected: SuspectedCrash; readonly atMs: number }
  | {
      readonly type: "cancelled-after-alert";
      readonly suspected: SuspectedCrash;
      readonly atMs: number;
    };

export type CrashAlertEventType = CrashAlertEvent["type"];

export interface CrashAlertTransition {
  readonly state: CrashAlertState;
  readonly events: readonly CrashAlertEvent[];
}

function unchanged(state: CrashAlertState): CrashAlertTransition {
  return { state, events: [] };
}

function clearCountdown(state: CrashAlertState, phase: CrashAlertPhase): CrashAlertState {
  return {
    phase,
    suspected: state.suspected,
    countdownStartedAtMs: state.countdownStartedAtMs,
    countdownEndsAtMs: state.countdownEndsAtMs,
  };
}

/**
 * A suspicion arrived. Starts the countdown only from a resting phase — while
 * one is already counting down, or already escalated, a second suspicion is
 * ignored so the rider never gets two timers or a re-armed alarm.
 */
export function startCrashCountdown(
  state: CrashAlertState,
  suspected: SuspectedCrash,
  nowMs: number,
): CrashAlertTransition {
  if (state.phase === "countdown" || state.phase === "escalated") return unchanged(state);
  if (!Number.isFinite(nowMs)) return unchanged(state);
  const countdownEndsAtMs = nowMs + CRASH_COUNTDOWN_MS;
  return {
    state: {
      phase: "countdown",
      suspected,
      countdownStartedAtMs: nowMs,
      countdownEndsAtMs,
    },
    events: [
      {
        type: "countdown-started",
        suspected,
        atMs: nowMs,
        countdownMs: CRASH_COUNTDOWN_MS,
        countdownEndsAtMs,
      },
    ],
  };
}

/** "I'm OK" inside the countdown: nothing is sent. Only `countdown` can dismiss. */
export function dismissCrashAlert(state: CrashAlertState, nowMs: number): CrashAlertTransition {
  if (state.phase !== "countdown" || state.suspected === null) return unchanged(state);
  if (!Number.isFinite(nowMs)) return unchanged(state);
  return {
    state: clearCountdown(state, "dismissed"),
    events: [{ type: "dismissed", suspected: state.suspected, atMs: nowMs }],
  };
}

/**
 * The countdown reached its deadline. Deadline-guarded in the reducer itself:
 * an early timer cannot escalate, so a clock adjustment or a replayed event
 * never turns into an alert before the rider had their full minute.
 */
export function timeOutCrashCountdown(state: CrashAlertState, nowMs: number): CrashAlertTransition {
  if (state.phase !== "countdown" || state.suspected === null) return unchanged(state);
  if (state.countdownEndsAtMs === null || !Number.isFinite(nowMs)) return unchanged(state);
  if (nowMs < state.countdownEndsAtMs) return unchanged(state);
  return {
    state: clearCountdown(state, "escalated"),
    events: [{ type: "escalated", suspected: state.suspected, atMs: nowMs }],
  };
}

/** "Alert now": the rider chose to escalate without waiting out the countdown. */
export function escalateCrashAlertNow(state: CrashAlertState, nowMs: number): CrashAlertTransition {
  if (state.phase !== "countdown" || state.suspected === null) return unchanged(state);
  if (!Number.isFinite(nowMs)) return unchanged(state);
  return {
    state: clearCountdown(state, "escalated"),
    events: [{ type: "escalated", suspected: state.suspected, atMs: nowMs }],
  };
}

/**
 * "I'm OK now" after escalation. The alert already went out, so this is
 * `cancelled-after-alert` — a distinct event the ride screen must act on.
 */
export function cancelCrashAlertAfterEscalation(
  state: CrashAlertState,
  nowMs: number,
): CrashAlertTransition {
  if (state.phase !== "escalated" || state.suspected === null) return unchanged(state);
  if (!Number.isFinite(nowMs)) return unchanged(state);
  return {
    state: clearCountdown(state, "cancelled-after-alert"),
    events: [{ type: "cancelled-after-alert", suspected: state.suspected, atMs: nowMs }],
  };
}

export interface CrashAlertSnapshot {
  readonly phase: CrashAlertPhase;
  readonly suspected: SuspectedCrash | null;
  /** Whole seconds the rider still has; `null` outside a live countdown. */
  readonly secondsRemaining: number | null;
}

/** What the overlay reads at `nowMs`: phase plus the countdown digits. */
export function crashAlertSnapshot(state: CrashAlertState, nowMs: number): CrashAlertSnapshot {
  const secondsRemaining =
    state.phase === "countdown" && state.countdownEndsAtMs !== null && Number.isFinite(nowMs)
      ? Math.max(0, Math.ceil((state.countdownEndsAtMs - nowMs) / 1_000))
      : null;
  return { phase: state.phase, suspected: state.suspected, secondsRemaining };
}

/** Injected timer seam: the browser's clock in production, a fake in tests. */
export interface CrashAlertScheduler {
  now(): number;
  schedule(work: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface CrashAlertControllerOptions {
  readonly scheduler?: CrashAlertScheduler;
  /** Every transition, in order, for the ride screen to act on. */
  readonly onEvent?: (event: CrashAlertEvent) => void;
}

export interface CrashAlertController {
  snapshot(): CrashAlertSnapshot;
  state(): CrashAlertState;
  /** Offers a suspicion; returns the events this call emitted (none if a flow is live). */
  suspect(suspected: SuspectedCrash): readonly CrashAlertEvent[];
  dismiss(): readonly CrashAlertEvent[];
  alertNow(): readonly CrashAlertEvent[];
  cancelAfterAlert(): readonly CrashAlertEvent[];
  /** Ends the flow without an event, for a ride that ended or a screen teardown. */
  reset(): void;
  dispose(): void;
}

const BROWSER_SCHEDULER: CrashAlertScheduler = {
  now: () => Date.now(),
  schedule: (work, delayMs) => setTimeout(work, delayMs),
  cancel: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * The imperative half: holds the state, arms exactly one escalation timer while
 * the countdown is live, and forwards each transition to `onEvent`. Everything
 * it does is the reducer above plus scheduling, so a ride screen can own one
 * of these without owning the rules.
 */
export function createCrashAlertController(options: CrashAlertControllerOptions = {}): CrashAlertController {
  const scheduler = options.scheduler ?? BROWSER_SCHEDULER;
  let state = INITIAL_CRASH_ALERT_STATE;
  let timer: unknown = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer === null) return;
    scheduler.cancel(timer);
    timer = null;
  }

  function armTimer(): void {
    clearTimer();
    if (state.phase !== "countdown" || state.countdownEndsAtMs === null) return;
    const delayMs = Math.max(0, state.countdownEndsAtMs - scheduler.now());
    timer = scheduler.schedule(tick, delayMs);
  }

  function tick(): void {
    timer = null;
    if (disposed || state.phase !== "countdown") return;
    const result = timeOutCrashCountdown(state, scheduler.now());
    // A timer that fired early (or a clock that stepped back) leaves the
    // countdown live: re-arm for the time actually left rather than stall.
    if (result.events.length === 0 && state.phase === "countdown" && state.countdownEndsAtMs !== null) {
      timer = scheduler.schedule(tick, Math.max(0, state.countdownEndsAtMs - scheduler.now()));
      return;
    }
    commit(result);
  }

  function commit(result: CrashAlertTransition): readonly CrashAlertEvent[] {
    if (result.state !== state) {
      state = result.state;
      armTimer();
    }
    for (const event of result.events) options.onEvent?.(event);
    return result.events;
  }

  return {
    snapshot(): CrashAlertSnapshot {
      return crashAlertSnapshot(state, scheduler.now());
    },
    state(): CrashAlertState {
      return state;
    },
    suspect(suspected: SuspectedCrash): readonly CrashAlertEvent[] {
      if (disposed) return [];
      return commit(startCrashCountdown(state, suspected, scheduler.now()));
    },
    dismiss(): readonly CrashAlertEvent[] {
      if (disposed) return [];
      return commit(dismissCrashAlert(state, scheduler.now()));
    },
    alertNow(): readonly CrashAlertEvent[] {
      if (disposed) return [];
      return commit(escalateCrashAlertNow(state, scheduler.now()));
    },
    cancelAfterAlert(): readonly CrashAlertEvent[] {
      if (disposed) return [];
      return commit(cancelCrashAlertAfterEscalation(state, scheduler.now()));
    },
    reset(): void {
      clearTimer();
      state = INITIAL_CRASH_ALERT_STATE;
    },
    dispose(): void {
      disposed = true;
      clearTimer();
    },
  };
}
