/**
 * Crash suspicion from the two streams a ride already has (issue #12 follower
 * safety): the phone's accelerometer (including gravity) and its GPS fixes.
 *
 * The detector is a pure, deterministic state machine. It reads no clock and
 * no random source: every sample and every fix carries its own `atMs`, so the
 * same two streams always produce the same suspicion (or none). The ride
 * screen holds the thin `createCrashDetector()` harness, whose `stateFor(nowMs)`
 * reports what the detector would show at a given instant without mutating
 * anything.
 *
 * ## What it is allowed to say
 *
 * Only `suspected` — never "crashed". A spike plus a stop is *evidence worth a
 * countdown*, not a diagnosis: the rider confirms or the countdown escalates
 * (`application/safety/crash-alert`). The rule is deliberately conservative in
 * both directions:
 *
 * - **Silence is not evidence of safety.** Unknown speed (a `null` GPS speed,
 *   a fix gap) never counts as "riding" and never confirms a stop, so a gap in
 *   coverage produces no suspicion rather than a made-up one.
 * - **A suspicion is never repeated in a hurry.** After the rider dismisses
 *   one, the next cannot be raised for `DISMISS_DEBOUNCE_MS`.
 *
 * ## Trigger, in order
 *
 * 1. **Riding.** A GPS fix at or above `RIDING_SPEED_MPS` (8 m/s, ~18 mph)
 *    within `RIDING_WINDOW_MS` before the impact. A phone handled at a
 *    standstill (`< HANDLING_SPEED_MPS`, 3 m/s, for that whole window) can
 *    never trigger: that gate is checked first and wins.
 * 2. **Impact.** Either a sustained spike — `IMPACT_G` (3.5 g) on at least
 *    `IMPACT_MIN_SAMPLES` (2) consecutive samples inside
 *    `IMPACT_SAMPLE_WINDOW_MS` — or a free fall (`FREE_FALL_G`, 0.3 g, for at
 *    least `FREE_FALL_MIN_MS`) landed with `FREE_FALL_IMPACT_G` (2.5 g) within
 *    `FREE_FALL_IMPACT_WINDOW_MS`. The free-fall path exists because a phone
 *    that leaves the mount in a crash lands with one sharp sample that a
 *    two-sample rule would miss.
 * 3. **Stop, and stay stopped.** A stopped fix (speed at or below
 *    `STOP_SPEED_MPS`, or movement under `STOP_MOVEMENT_METERS` when the
 *    device gave no speed) starting within `STOP_WINDOW_AFTER_IMPACT_MS` of
 *    the impact, held for `STOP_CONFIRM_MS`. A spike followed by continued
 *    riding (`> CONTINUED_RIDING_SPEED_MPS` within
 *    `CONTINUED_RIDING_WINDOW_MS`) is a pothole, not a crash, and aborts the
 *    suspicion outright.
 *
 * The confirmed-suspicion timestamp is the confirming fix's `atMs`, not the
 * impact's: the alert is raised when the evidence is complete, and the event
 * carries the last known position.
 *
 * ## Stated limits
 *
 * - **A slow tip-over never triggers.** Below the 8 m/s riding gate there is
 *   no crash suspicion at all, even if the phone clearly hit the ground: a
 *   walking-pace drop is indistinguishable from a phone dropped at a light.
 *   This is a documented limit of the riding gate, not an oversight.
 * - **A crash that never comes to rest inside the stop window is missed.** If
 *   the rider slides on above `STOP_SPEED_MPS` for more than
 *   `STOP_WINDOW_AFTER_IMPACT_MS`, the gate expires. Alerting on "moving
 *   after an impact" would need a different, far noisier rule.
 * - **Fix gaps are bridged by distance, not by evidence.** A gap ending within
 *   `STOP_MOVEMENT_METERS` of the stop anchor counts as stopped, because the
 *   endpoints bound the movement; a gap ending farther away aborts. Movement
 *   inside the gap is unknown, and unknown is never reported as stopped.
 * - **Reported accuracy is carried but not gated on.** A fix's `accuracyM` is
 *   available to callers, but this first version decides on speed and movement
 *   only; a poor-accuracy fix reporting zero speed can still confirm the stop.
 * - **The phone's own axis frame is irrelevant.** Only the magnitude of the
 *   acceleration vector is read, so the mount's orientation (the lean module's
 *   calibration problem) never affects detection.
 */

import { haversine } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";

/** Standard gravity, the unit the g thresholds below are named in. */
export const STANDARD_GRAVITY_MPS2 = 9.81;

/** The riding gate: at least this fast, this recently, before an impact counts. */
export const RIDING_SPEED_MPS = 8;
export const RIDING_WINDOW_MS = 20_000;

/** Below this for the whole riding window, the phone was being handled, not ridden. */
export const HANDLING_SPEED_MPS = 3;

/** The sustained-spike impact rule. */
export const IMPACT_G = 3.5;
export const IMPACT_ACCELERATION_MPS2 = IMPACT_G * STANDARD_GRAVITY_MPS2;
export const IMPACT_MIN_SAMPLES = 2;
export const IMPACT_SAMPLE_WINDOW_MS = 100;

/** The free-fall-then-landing impact rule. */
export const FREE_FALL_G = 0.3;
export const FREE_FALL_ACCELERATION_MPS2 = FREE_FALL_G * STANDARD_GRAVITY_MPS2;
export const FREE_FALL_MIN_MS = 300;
export const FREE_FALL_IMPACT_G = 2.5;
export const FREE_FALL_IMPACT_ACCELERATION_MPS2 = FREE_FALL_IMPACT_G * STANDARD_GRAVITY_MPS2;
export const FREE_FALL_IMPACT_WINDOW_MS = 1_000;

/** The stop gate. */
export const STOP_SPEED_MPS = 1.5;
export const STOP_WINDOW_AFTER_IMPACT_MS = 15_000;
export const STOP_MOVEMENT_METERS = 15;
export const STOP_CONFIRM_MS = 20_000;

/** A spike followed by this much speed inside this window is continued riding. */
export const CONTINUED_RIDING_SPEED_MPS = 6;
export const CONTINUED_RIDING_WINDOW_MS = 15_000;

/** How long after a dismissal the next suspicion is withheld. */
export const DISMISS_DEBOUNCE_MS = 120_000;

/** Motion history long enough to find a free-fall run before a landing spike. */
const MOTION_HISTORY_MS = FREE_FALL_MIN_MS + FREE_FALL_IMPACT_WINDOW_MS + 250;
/** Defensive caps: a pathological stream must not grow the state without bound. */
const MAX_MOTION_SAMPLES = 512;
const MAX_FIXES = 512;

/** One accelerometer reading, including gravity, in m/s². */
export interface MotionSample {
  readonly atMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One GPS fix. `speedMps` is `null` when the device reported no speed. */
export interface GpsFix {
  readonly atMs: number;
  readonly lat: number;
  readonly lon: number;
  readonly speedMps: number | null;
  /** Horizontal accuracy in metres as reported; carried for callers, not gated on. */
  readonly accuracyM: number | null;
}

/** The one thing the detector is allowed to raise. */
export interface SuspectedCrash {
  readonly type: "suspected";
  readonly atMs: number;
  readonly location: Coordinate;
}

export type CrashDetectorEvent = SuspectedCrash;

/**
 * `watching` — armed, nothing suspected.
 * `post-impact` — a gated impact happened; waiting for a stop.
 * `confirming-stop` — a stopped fix was seen; waiting out `STOP_CONFIRM_MS`.
 * `suspected` — the stop held long enough and `suspected` was emitted.
 */
export type CrashDetectorPhase = "watching" | "post-impact" | "confirming-stop" | "suspected";

export interface CrashDetectorState {
  readonly phase: CrashDetectorPhase;
  /** Recent fixes, oldest first, covering the riding window. */
  readonly fixes: readonly GpsFix[];
  /** Recent motion samples, oldest first, covering the free-fall lookback. */
  readonly motion: readonly MotionSample[];
  readonly lastFixAtMs: number | null;
  readonly lastMotionAtMs: number | null;
  /** First sample of the current run at or above the impact threshold. */
  readonly impactRunStartedAtMs: number | null;
  /** Length of that run; reset to 0 by any sample below the threshold. */
  readonly impactRunSamples: number;
  readonly impactAtMs: number | null;
  /** Last position known at or before the impact. */
  readonly impactLocation: Coordinate | null;
  readonly stoppedSinceMs: number | null;
  /** Position the movement-based stop test measures from. */
  readonly stopAnchor: Coordinate | null;
  readonly suspected: SuspectedCrash | null;
  readonly dismissedAtMs: number | null;
}

export const INITIAL_CRASH_DETECTOR_STATE: CrashDetectorState = {
  phase: "watching",
  fixes: [],
  motion: [],
  lastFixAtMs: null,
  lastMotionAtMs: null,
  impactRunStartedAtMs: null,
  impactRunSamples: 0,
  impactAtMs: null,
  impactLocation: null,
  stoppedSinceMs: null,
  stopAnchor: null,
  suspected: null,
  dismissedAtMs: null,
};

export interface CrashDetectionResult {
  readonly state: CrashDetectorState;
  readonly events: readonly CrashDetectorEvent[];
}

function magnitude(sample: MotionSample): number {
  return Math.hypot(sample.x, sample.y, sample.z);
}

function isFiniteSample(sample: MotionSample): boolean {
  return (
    Number.isFinite(sample.atMs) &&
    Number.isFinite(sample.x) &&
    Number.isFinite(sample.y) &&
    Number.isFinite(sample.z)
  );
}

function isFiniteFix(fix: GpsFix): boolean {
  return Number.isFinite(fix.atMs) && Number.isFinite(fix.lat) && Number.isFinite(fix.lon);
}

/** A null, NaN or infinite speed is unknown, never zero. */
function knownSpeed(fix: GpsFix): number | null {
  return fix.speedMps !== null && Number.isFinite(fix.speedMps) ? fix.speedMps : null;
}

function coordinateOf(fix: GpsFix): Coordinate {
  return { lat: fix.lat, lon: fix.lon };
}

function withinRidingWindow(fix: GpsFix, atMs: number): boolean {
  return fix.atMs <= atMs && fix.atMs >= atMs - RIDING_WINDOW_MS;
}

/** The riding gate: a known speed at or above 8 m/s in the 20 s before the impact. */
function ridingEvidence(fixes: readonly GpsFix[], atMs: number): boolean {
  return fixes.some((fix) => {
    const speed = knownSpeed(fix);
    return speed !== null && speed >= RIDING_SPEED_MPS && withinRidingWindow(fix, atMs);
  });
}

/**
 * Whether the phone was being handled rather than ridden: every speed known in
 * the window is below 3 m/s. Checked ahead of the riding gate so the rule
 * stands on its own; a fix at riding speed already disproves it, which is
 * exactly why a phone dropped at a standstill can never read as a crash.
 */
function phoneWasBeingHandled(fixes: readonly GpsFix[], atMs: number): boolean {
  const speeds = fixes
    .filter((fix) => withinRidingWindow(fix, atMs))
    .map(knownSpeed)
    .filter((speed): speed is number => speed !== null);
  return speeds.length > 0 && speeds.every((speed) => speed < HANDLING_SPEED_MPS);
}

/** The last position known at or before `atMs`, from the retained window. */
function lastLocationBefore(fixes: readonly GpsFix[], atMs: number): Coordinate | null {
  for (let index = fixes.length - 1; index >= 0; index -= 1) {
    const fix = fixes[index] as GpsFix;
    if (fix.atMs <= atMs) return coordinateOf(fix);
  }
  return null;
}

/**
 * Whether the most recent consecutive free-fall run in `samples` lasted long
 * enough and ended within the landing window of `spikeAtMs`. The spike itself
 * is part of `samples`, so samples at or after it are skipped.
 */
function landedFromFreeFall(samples: readonly MotionSample[], spikeAtMs: number): boolean {
  let runEnd: MotionSample | null = null;
  let runStart: MotionSample | null = null;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index] as MotionSample;
    if (sample.atMs >= spikeAtMs) continue;
    if (magnitude(sample) < FREE_FALL_ACCELERATION_MPS2) {
      if (runEnd === null) runEnd = sample;
      runStart = sample;
    } else if (runEnd !== null) {
      break;
    }
  }
  if (runEnd === null || runStart === null) return false;
  return (
    runEnd.atMs - runStart.atMs >= FREE_FALL_MIN_MS &&
    spikeAtMs - runEnd.atMs >= 0 &&
    spikeAtMs - runEnd.atMs <= FREE_FALL_IMPACT_WINDOW_MS
  );
}

/**
 * One accelerometer sample folded in. Returns the next state plus any
 * suspicion this sample completed (only the confirming fix can emit one, so
 * this is always empty today, but the shape stays uniform for callers).
 */
export function applyMotionSample(state: CrashDetectorState, sample: MotionSample): CrashDetectionResult {
  if (!isFiniteSample(sample)) return { state, events: [] };
  if (state.lastMotionAtMs !== null && sample.atMs <= state.lastMotionAtMs) return { state, events: [] };

  const motion = [...state.motion, sample]
    .filter((entry) => entry.atMs >= sample.atMs - MOTION_HISTORY_MS)
    .slice(-MAX_MOTION_SAMPLES);
  const accel = magnitude(sample);

  let impactRunStartedAtMs = state.impactRunStartedAtMs;
  let impactRunSamples = state.impactRunSamples;
  if (accel >= IMPACT_ACCELERATION_MPS2) {
    const runContinues =
      impactRunStartedAtMs !== null && sample.atMs - impactRunStartedAtMs <= IMPACT_SAMPLE_WINDOW_MS;
    impactRunStartedAtMs = runContinues ? impactRunStartedAtMs : sample.atMs;
    impactRunSamples = runContinues ? impactRunSamples + 1 : 1;
  } else {
    impactRunStartedAtMs = null;
    impactRunSamples = 0;
  }

  const sustained = impactRunSamples >= IMPACT_MIN_SAMPLES;
  const landed = accel >= FREE_FALL_IMPACT_ACCELERATION_MPS2 && landedFromFreeFall(motion, sample.atMs);
  const next: CrashDetectorState = {
    ...state,
    motion,
    lastMotionAtMs: sample.atMs,
    impactRunStartedAtMs,
    impactRunSamples,
  };

  if (state.phase !== "watching" || (!sustained && !landed)) return { state: next, events: [] };

  // The riding gate must hold, and a phone being handled below 3 m/s cannot be
  // mistaken for one being ridden — both read the same retained fixes. The
  // dismissal debounce is deliberately not checked here: a suspicion is only
  // raised ~20 s later, and the emission check in `applyGpsFix` is what keeps
  // the two-minute promise.
  if (phoneWasBeingHandled(state.fixes, sample.atMs)) return { state: next, events: [] };
  if (!ridingEvidence(state.fixes, sample.atMs)) return { state: next, events: [] };

  const impactLocation = lastLocationBefore(state.fixes, sample.atMs);
  if (impactLocation === null) return { state: next, events: [] };

  return {
    state: {
      ...next,
      phase: "post-impact",
      impactAtMs: sample.atMs,
      impactLocation,
      stoppedSinceMs: null,
      stopAnchor: null,
    },
    events: [],
  };
}

/**
 * Whether this fix reads as stopped: a known speed at or below 1.5 m/s, or —
 * when the device reported no speed — under 15 m of movement from the position
 * the stop began at (the impact position until a stop begins).
 */
function fixIsStopped(state: CrashDetectorState, fix: GpsFix): boolean {
  const speed = knownSpeed(fix);
  if (speed !== null) return Math.abs(speed) <= STOP_SPEED_MPS;
  const anchor = state.stoppedSinceMs !== null ? state.stopAnchor : state.impactLocation;
  if (anchor === null) return false;
  const movement = haversine(anchor, coordinateOf(fix));
  return Number.isFinite(movement) && movement < STOP_MOVEMENT_METERS;
}

/**
 * One GPS fix folded in. A confirmed stop inside the post-impact window emits
 * `suspected`; continued riding (a pothole) or a stop that does not hold
 * returns the detector to `watching`.
 */
export function applyGpsFix(state: CrashDetectorState, fix: GpsFix): CrashDetectionResult {
  if (!isFiniteFix(fix)) return { state, events: [] };
  if (state.lastFixAtMs !== null && fix.atMs <= state.lastFixAtMs) return { state, events: [] };

  const fixes = [...state.fixes, fix]
    .filter((entry) => entry.atMs >= fix.atMs - RIDING_WINDOW_MS)
    .slice(-MAX_FIXES);
  const next: CrashDetectorState = { ...state, fixes, lastFixAtMs: fix.atMs };

  if (state.phase === "suspected" || state.phase === "watching") return { state: next, events: [] };

  const impactAtMs = state.impactAtMs;
  if (impactAtMs === null || fix.atMs < impactAtMs) return { state: next, events: [] };
  const sinceImpactMs = fix.atMs - impactAtMs;

  // A big spike followed by real speed is a pothole, and a stop that starts
  // moving again did not hold. Both abort rather than escalate.
  const speed = knownSpeed(fix);
  const continuedRiding =
    speed !== null && speed > CONTINUED_RIDING_SPEED_MPS && sinceImpactMs <= CONTINUED_RIDING_WINDOW_MS;
  if (continuedRiding) {
    return { state: { ...next, phase: "watching", impactAtMs: null, stoppedSinceMs: null, stopAnchor: null }, events: [] };
  }

  const stopped = fixIsStopped(state, fix);
  if (!stopped) {
    const stoppedTooLate = state.stoppedSinceMs === null && sinceImpactMs > STOP_WINDOW_AFTER_IMPACT_MS;
    const stopBroken = state.stoppedSinceMs !== null;
    if (stoppedTooLate || stopBroken) {
      return {
        state: { ...next, phase: "watching", impactAtMs: null, stoppedSinceMs: null, stopAnchor: null },
        events: [],
      };
    }
    return { state: next, events: [] };
  }

  if (state.stoppedSinceMs === null && sinceImpactMs > STOP_WINDOW_AFTER_IMPACT_MS) {
    return { state: { ...next, phase: "watching", impactAtMs: null, stoppedSinceMs: null, stopAnchor: null }, events: [] };
  }

  const stoppedSinceMs = state.stoppedSinceMs ?? fix.atMs;
  const stopAnchor = state.stopAnchor ?? coordinateOf(fix);
  const confirming = fix.atMs - stoppedSinceMs >= STOP_CONFIRM_MS;
  if (!confirming) {
    return {
      state: { ...next, phase: "confirming-stop", stoppedSinceMs, stopAnchor },
      events: [],
    };
  }

  // The two-minute debounce is measured on the suspicion, not the impact: an
  // impact inside the window whose stop confirms after it is a real crash and
  // must still be raised.
  const debounced =
    next.dismissedAtMs !== null && fix.atMs - next.dismissedAtMs < DISMISS_DEBOUNCE_MS;
  if (debounced) {
    // The rider already said they were OK moments ago; this evidence is
    // retired silently rather than raising a second alarm.
    return {
      state: { ...next, phase: "watching", impactAtMs: null, stoppedSinceMs: null, stopAnchor: null },
      events: [],
    };
  }

  const suspected: SuspectedCrash = {
    type: "suspected",
    atMs: fix.atMs,
    location: coordinateOf(fix),
  };
  return {
    state: {
      ...next,
      phase: "suspected",
      stoppedSinceMs,
      stopAnchor,
      suspected,
    },
    events: [suspected],
  };
}

/**
 * The rider said they are OK. Returns the detector to `watching` and withholds
 * the next suspicion for `DISMISS_DEBOUNCE_MS`; the impact evidence is dropped.
 */
export function dismissCrashSuspicion(state: CrashDetectorState, atMs: number): CrashDetectorState {
  return {
    ...state,
    phase: "watching",
    impactAtMs: null,
    impactLocation: null,
    stoppedSinceMs: null,
    stopAnchor: null,
    suspected: null,
    impactRunStartedAtMs: null,
    impactRunSamples: 0,
    dismissedAtMs: Number.isFinite(atMs) ? atMs : state.dismissedAtMs,
  };
}

/**
 * Drop the current impact/suspicion without starting a debounce — the ride
 * screen clearing a finished alert (escalated and handled, or the ride ended).
 * The dismissal debounce already recorded, if any, is left to lapse by time.
 */
export function resetCrashDetector(state: CrashDetectorState): CrashDetectorState {
  return {
    ...state,
    phase: "watching",
    impactAtMs: null,
    impactLocation: null,
    stoppedSinceMs: null,
    stopAnchor: null,
    suspected: null,
    impactRunStartedAtMs: null,
    impactRunSamples: 0,
  };
}

/** What `stateFor`/a test can read at one instant, without changing anything. */
export interface CrashDetectorSnapshot {
  readonly phase: CrashDetectorPhase;
  readonly suspected: SuspectedCrash | null;
  readonly impactAtMs: number | null;
  /** How long the stop has held at `nowMs`; `null` before a stopped fix. */
  readonly stoppedForMs: number | null;
  /** End of the post-dismissal debounce, or `null` when none is in force. */
  readonly debounceUntilMs: number | null;
}

/**
 * The detector's readable state at `nowMs`. The phase is derived, not stored:
 * once the stop window has passed with no stop, the detector reads `watching`
 * even if the next fix has not yet arrived to retire the state.
 */
export function crashDetectorSnapshot(state: CrashDetectorState, nowMs: number): CrashDetectorSnapshot {
  let phase = state.phase;
  if (
    (phase === "post-impact" || phase === "confirming-stop") &&
    state.impactAtMs !== null &&
    state.stoppedSinceMs === null &&
    nowMs - state.impactAtMs > STOP_WINDOW_AFTER_IMPACT_MS
  ) {
    phase = "watching";
  }
  return {
    phase,
    suspected: state.suspected,
    impactAtMs: state.impactAtMs,
    stoppedForMs:
      state.stoppedSinceMs === null ? null : Math.max(0, nowMs - state.stoppedSinceMs),
    debounceUntilMs:
      state.dismissedAtMs === null ? null : state.dismissedAtMs + DISMISS_DEBOUNCE_MS,
  };
}

/**
 * The imperative harness the ride screen holds. It is nothing but the pure
 * reducers above plus the current state: samples in, suspicions out, and
 * `stateFor(nowMs)` for whatever the screen needs to read between samples.
 */
export interface CrashDetector {
  /** Folds one accelerometer sample in; returns any suspicion it completed. */
  pushMotion(sample: MotionSample): readonly CrashDetectorEvent[];
  /** Folds one GPS fix in; returns any suspicion it completed. */
  pushFix(fix: GpsFix): readonly CrashDetectorEvent[];
  /** The rider said they are OK: back to watching, with the debounce recorded. */
  dismiss(atMs: number): void;
  /** Clears the current impact or suspicion without a debounce. */
  reset(): void;
  state(): CrashDetectorState;
  stateFor(nowMs: number): CrashDetectorSnapshot;
}

export function createCrashDetector(
  initial: CrashDetectorState = INITIAL_CRASH_DETECTOR_STATE,
): CrashDetector {
  let state = initial;
  return {
    pushMotion(sample: MotionSample): readonly CrashDetectorEvent[] {
      const result = applyMotionSample(state, sample);
      state = result.state;
      return result.events;
    },
    pushFix(fix: GpsFix): readonly CrashDetectorEvent[] {
      const result = applyGpsFix(state, fix);
      state = result.state;
      return result.events;
    },
    dismiss(atMs: number): void {
      state = dismissCrashSuspicion(state, atMs);
    },
    reset(): void {
      state = resetCrashDetector(state);
    },
    state(): CrashDetectorState {
      return state;
    },
    stateFor(nowMs: number): CrashDetectorSnapshot {
      return crashDetectorSnapshot(state, nowMs);
    },
  };
}
