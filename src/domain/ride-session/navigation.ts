/**
 * Derived navigation state — the port the 8.2 matching engine consumes
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §3–§5, §9, §15, §28;
 * 02-ARCHITECTURE-CONTRACT §2.3; 17-IMPLEMENTATION-PLAN Task 8.1;
 * OGV-RID-005, OGV-RID-008).
 *
 * Freshness and position quality are **derived at read time from an injected
 * clock**, never stored: a stored `ageMs` or `quality` would keep claiming to be
 * current after the clock moved, which is precisely the failure 8 §4 forbids
 * ("stale speed and heading are not displayed as current"). The state keeps the
 * fix; this module decides how much of it may be shown right now.
 *
 * Four rules are pinned here:
 *
 * - **Age is clamped, never negative.** A future-dated fix (device clock skew)
 *   reports age `0` rather than a negative age that would sort before "now".
 * - **An unknown accuracy is not a good fix.** `fresh-good` requires a stated
 *   accuracy within `POSITION_GOOD_ACCURACY_METERS`; an unreported accuracy is
 *   `fresh-poor`, because "we did not measure it" is not "it is good".
 * - **A stale fix keeps its coordinate and loses its speed and heading.** The
 *   last-known position is still the best answer available (and the map needs
 *   it); a stale *speed* is a claim about the present.
 * - **Ahead guidance suspends on stale or unavailable GPS** (OGV-RID-005) and
 *   whenever the session is not moving (paused or ended). A degraded-but-usable
 *   `fresh-poor` fix does not suspend on its own: 8 §15 makes that a policy
 *   decision for the live engine, which is why `quality` is on the port.
 */

import type { StopId } from "../ride/ids";
import type { Coordinate } from "../ride/types";
import type {
  PositionQuality,
  RideSessionActivity,
  RideSessionMovingActivity,
  RideSessionState,
  SessionEndReason,
  SessionInstruction,
  SessionOffRouteState,
  SessionPlan,
} from "./types";
import type { RecordingId } from "../recording/ids";
import type { RideSessionId } from "./ids";

/** A fix at or below this age, with a stated good accuracy, is `fresh-good`. */
export const POSITION_FRESH_GOOD_MAX_AGE_MS = 5_000;

/** A fix older than this is `stale`: it may be shown as last-known only. */
export const POSITION_STALE_AFTER_MS = 20_000;

/** The accuracy at or under which a stated accuracy counts as good. */
export const POSITION_GOOD_ACCURACY_METERS = 30;

/**
 * The current-position projection (the §2.3 position state in the shape
 * 08 §4 names). `coordinate` survives staleness; speed and heading do not.
 */
export interface NavigationPosition {
  readonly coordinate: Coordinate | null;
  readonly observedAt: string | null;
  readonly ageMs: number | null;
  readonly accuracyMeters: number | null;
  readonly headingDegrees: number | null;
  readonly speedMps: number | null;
  readonly quality: PositionQuality;
  /** Device altitude in metres; withheld (`null`) like speed on a stale fix, absent when never reported. */
  readonly altitudeMeters?: number | null;
  readonly altitudeAccuracyMeters?: number | null;
}

/** Everything a guidance surface needs for one moment, without owning state. */
export interface SessionNavigationState {
  readonly sessionId: RideSessionId;
  readonly activity: RideSessionActivity;
  readonly resumeActivity: RideSessionMovingActivity | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /**
   * How the terminal activity was reached, or `null` while the ride is live.
   *
   * Carried because the Ride Focus surface must say *finished* or *discarded*
   * (8 §2 "stop/exit ride") and the two are not interchangeable rider copy: an
   * activity of `completed` says the ride ended, not how. Without it the surface
   * would have to guess from the activity, which is exactly how a discarded ride
   * gets reported as a completed one.
   */
  readonly endReason: SessionEndReason | null;
  readonly plan: SessionPlan;
  readonly recordingId: RecordingId | null;
  readonly position: NavigationPosition;
  /** `true` when ahead-only guidance must stay quiet right now (OGV-RID-005). */
  readonly aheadGuidanceSuspended: boolean;
  readonly instruction: SessionInstruction | null;
  readonly offRouteState: SessionOffRouteState | null;
  readonly nextStopId: StopId | null;
  readonly completedStopIds: readonly StopId[];
  readonly remainingStopIds: readonly StopId[];
}

const UNAVAILABLE_POSITION: NavigationPosition = {
  coordinate: null,
  observedAt: null,
  ageMs: null,
  accuracyMeters: null,
  headingDegrees: null,
  speedMps: null,
  quality: "unavailable",
};

function ageOf(observedAt: string, now: string): number {
  const observed = Date.parse(observedAt);
  const current = Date.parse(now);
  if (Number.isNaN(observed) || Number.isNaN(current)) return 0;
  return Math.max(0, current - observed);
}

function qualityOf(ageMs: number, accuracyMeters: number | null): PositionQuality {
  if (ageMs > POSITION_STALE_AFTER_MS) return "stale";
  if (accuracyMeters === null || accuracyMeters > POSITION_GOOD_ACCURACY_METERS) {
    return "fresh-poor";
  }
  if (ageMs > POSITION_FRESH_GOOD_MAX_AGE_MS) return "fresh-poor";
  return "fresh-good";
}

function projectPosition(
  state: RideSessionState,
  now: string,
): NavigationPosition {
  const fix = state.position;
  if (fix === null) return UNAVAILABLE_POSITION;
  const ageMs = ageOf(fix.observedAt, now);
  const quality = qualityOf(ageMs, fix.accuracyMeters);
  const presentable = quality === "fresh-good" || quality === "fresh-poor";
  return {
    coordinate: fix.coordinate,
    observedAt: fix.observedAt,
    ageMs,
    accuracyMeters: fix.accuracyMeters,
    headingDegrees: presentable ? fix.headingDegrees : null,
    speedMps: presentable ? fix.speedMps : null,
    quality,
    ...(fix.altitudeMeters === undefined
      ? {}
      : {
          altitudeMeters: presentable ? fix.altitudeMeters : null,
          altitudeAccuracyMeters: fix.altitudeAccuracyMeters ?? null,
        }),
  };
}

export interface DeriveNavigationOptions {
  /** The instant "now" is asked at; the caller owns the clock. */
  readonly now: string;
}

/**
 * Projects the stored session into the present-tense navigation view. Pure and
 * deterministic: the same state and clock produce the same frozen-free value,
 * and nothing here mutates or extends the session state.
 */
export function deriveSessionNavigation(
  state: RideSessionState,
  options: DeriveNavigationOptions,
): SessionNavigationState {
  const position = projectPosition(state, options.now);
  const moving =
    state.activity === "guided" ||
    state.activity === "free" ||
    state.activity === "track";
  const routeContinuitySuspended =
    (state.activity === "guided" || state.activity === "track") &&
    state.offRouteState !== "on-route";
  return {
    sessionId: state.sessionId,
    activity: state.activity,
    resumeActivity: state.resumeActivity,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    endReason: state.endReason,
    plan: state.plan,
    recordingId: state.recordingId,
    position,
    aheadGuidanceSuspended:
      !moving ||
      routeContinuitySuspended ||
      position.quality === "stale" ||
      position.quality === "unavailable",
    instruction: state.activeInstruction,
    offRouteState: state.offRouteState,
    nextStopId: state.remainingStopIds[0] ?? null,
    completedStopIds: state.completedStopIds,
    remainingStopIds: state.remainingStopIds,
  };
}
