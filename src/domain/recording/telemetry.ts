/**
 * Recording telemetry quality (RIDE-INSTRUMENT-STRIP §6, §17.3).
 *
 * A deterministic filter over the recorded points. The raw points are never
 * changed: this reads them in order and keeps the aggregates the ride strip
 * shows — moving time, accepted distance, moving average speed, max speed, a
 * moving/stopped state with hysteresis, and a smoothed elevation profile with
 * gain and loss. The same points always give the same answer, so a recovered
 * trace rebuilds exactly the telemetry the rider saw before the reload.
 *
 * No Kalman filter (§6.1). Each rule is a plain threshold from
 * `TELEMETRY_LIMITS`, the one place these constants live.
 */

import { haversine } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";
import type { RecordingPosition } from "./types";

const MPH = 1609.344 / 3600;

/** Every telemetry threshold, in one place (§6.3: "keep constants centralized"). */
export const TELEMETRY_LIMITS = {
  /** A fix whose horizontal accuracy is worse than this is unusable for speed, distance or motion. */
  maxUsableAccuracyMeters: 50,
  /** Faster than any motorcycle ride: a speed or implied speed above this is not credible. */
  maxPlausibleSpeedMps: 90,
  /** Harder than a motorcycle accelerates or brakes (~1 g): a bigger one-sample speed change is a spike. */
  maxAccelerationMps2: 10,
  /** Extra room (metres) before a position step counts as an impossible jump. */
  jumpSlackMeters: 10,
  /** After this many consecutive rejected jumps, the new place is believed and becomes the anchor. */
  jumpReanchorSamples: 3,
  /** A device speed that disagrees with the position-derived speed by less than this is corroborated. */
  speedAgreementMps: 3,
  /** Derived speed looks back at most this far, and at least `deriveMinBaselineMs`. */
  deriveMaxBaselineMs: 5_000,
  deriveMinBaselineMs: 1_000,
  /** Moving/stopped hysteresis (§6.3): enter moving above ~3 mph, stay moving above 2 mph. */
  movingEnterSpeedMps: 3 * MPH,
  movingHoldSpeedMps: 2 * MPH,
  /** Consecutive credible samples above the enter speed before the ride counts as moving. */
  movingEnterSamples: 3,
  /** Sustained low speed for this long before the ride counts as stopped (stoplight jitter shorter than this is ignored). */
  stoppedAfterMs: 5_000,
  /** A gap between fixes longer than this is never bridged: no moving time, distance or climb across it. */
  maxBridgeGapMs: 30_000,
  /** Moving average needs this much moving time before it is shown. */
  averageMinMovingMs: 10_000,
  /** Altitude worse than this (vertical accuracy) is ignored. */
  maxUsableAltitudeAccuracyMeters: 25,
  /** Faster climb or descent than this (plus the slack) is an impossible vertical jump. */
  maxVerticalRateMps: 8,
  verticalJumpSlackMeters: 15,
  /** After this many consecutive vertical jumps, the new altitude is believed (no climb credited). */
  verticalReanchorSamples: 5,
  /** Altitude smoothing time constant for the exponential filter. */
  elevationTimeConstantMs: 5_000,
  /** Gain/loss deadband: smoothed altitude must move this far from the last counted level. */
  elevationDeadbandMeters: 5,
  /** An altitude gap longer than this is never bridged: the profile restarts. */
  maxAltitudeGapMs: 30_000,
} as const;

export type MovementState = "moving" | "stopped";

export interface RecordingTelemetry {
  /** Distance credited while moving: the numerator of the moving average. */
  readonly acceptedDistanceMeters: number;
  /** Time credited as moving, in ms: the denominator of the moving average. */
  readonly movingMs: number;
  /** The highest speed held for two consecutive credible samples, or `null` before one exists. */
  readonly maxSpeedMps: number | null;
  readonly movement: MovementState;
  /** Epoch ms the current moving stretch began, or `null` while stopped. */
  readonly movingSinceMs: number | null;
  /** Epoch ms of the last credible sample, or `null` before one. */
  readonly lastSampleAtMs: number | null;
  readonly elevation: {
    /** The smoothed altitude now, or `null` when no usable altitude exists (or it lapsed). */
    readonly currentMeters: number | null;
    readonly sampledAtMs: number | null;
    readonly gainMeters: number;
    readonly lossMeters: number;
    /** Usable altitude samples seen; `0` means this device never reported altitude. */
    readonly sampleCount: number;
  };
  /** Rejection counters, for tests and diagnostics. */
  readonly rejected: {
    readonly poorAccuracy: number;
    readonly jumps: number;
    readonly speedSpikes: number;
    readonly verticalJumps: number;
  };
}

/** Moving average speed = accepted distance ÷ moving time (§6.2), or `null` until there is enough moving time. */
export function movingAverageSpeedMps(telemetry: RecordingTelemetry): number | null {
  if (telemetry.movingMs < TELEMETRY_LIMITS.averageMinMovingMs) return null;
  return telemetry.acceptedDistanceMeters / (telemetry.movingMs / 1_000);
}

export const EMPTY_RECORDING_TELEMETRY: RecordingTelemetry = {
  acceptedDistanceMeters: 0,
  movingMs: 0,
  maxSpeedMps: null,
  movement: "stopped",
  movingSinceMs: null,
  lastSampleAtMs: null,
  elevation: { currentMeters: null, sampledAtMs: null, gainMeters: 0, lossMeters: 0, sampleCount: 0 },
  rejected: { poorAccuracy: 0, jumps: 0, speedSpikes: 0, verticalJumps: 0 },
};

// ---- Speed derivation ------------------------------------------------------

export interface SpeedFix {
  readonly coordinate: Coordinate;
  readonly atMs: number;
  readonly accuracyMeters: number | null;
}

function usableAccuracy(accuracy: number | null | undefined): accuracy is number {
  return (
    typeof accuracy === "number" &&
    Number.isFinite(accuracy) &&
    accuracy >= 0 &&
    accuracy <= TELEMETRY_LIMITS.maxUsableAccuracyMeters
  );
}

/**
 * Speed from successive credible fixes, for a device that reports none
 * (§6.1; many browsers and Playwright give `coords.speed === null`).
 *
 * It tries the newest earlier fix first and looks further back (up to the
 * look-back window) only while the displacement is still inside the GPS noise,
 * so a slow rider still covers more ground than the noise, and a stop shows
 * quickly. A displacement inside the two fixes' combined accuracy over every baseline
 * is noise, so the answer is a true `0`, never a speed made of jitter. `null`
 * when there is no usable baseline.
 */
export function deriveSpeedMps(history: readonly SpeedFix[], current: SpeedFix): number | null {
  if (!usableAccuracy(current.accuracyMeters)) return null;
  const baselines = history
    .filter((fix) => {
      const age = current.atMs - fix.atMs;
      return (
        age >= TELEMETRY_LIMITS.deriveMinBaselineMs &&
        age <= TELEMETRY_LIMITS.deriveMaxBaselineMs &&
        usableAccuracy(fix.accuracyMeters)
      );
    })
    .sort((left, right) => right.atMs - left.atMs);
  if (baselines.length === 0) return null;
  for (const base of baselines) {
    const meters = haversine(base.coordinate, current.coordinate);
    // Both fixes are uncertain: their combined radius is the noise floor.
    const noise = Math.hypot(base.accuracyMeters ?? 0, current.accuracyMeters ?? 0);
    if (meters <= noise) continue;
    const speed = meters / ((current.atMs - base.atMs) / 1_000);
    return speed <= TELEMETRY_LIMITS.maxPlausibleSpeedMps ? speed : null;
  }
  return 0;
}

/** Drops fixes that can no longer be a derivation baseline for `atMs`. */
export function pruneSpeedHistory(history: readonly SpeedFix[], atMs: number): SpeedFix[] {
  return history.filter((fix) => atMs - fix.atMs <= TELEMETRY_LIMITS.deriveMaxBaselineMs && fix.atMs < atMs);
}

// ---- The accumulator -------------------------------------------------------

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface TelemetryAnchor {
  readonly atMs: number;
  readonly coordinate: Coordinate;
  readonly accuracyMeters: number;
  readonly pausedDurationMs: number;
}

/**
 * Everything the fold carries between points: small, bounded (the speed
 * history holds at most `deriveMaxBaselineMs` of fixes) and plain JSON, so a
 * ride with no stored track can keep it durably and continue after a reload
 * exactly where it left off.
 */
export interface RecordingTelemetryState {
  readonly version: 1;
  readonly anchor: TelemetryAnchor | null;
  readonly history: readonly SpeedFix[];
  readonly lastSpeed: number | null;
  readonly jumpStreak: number;
  readonly distance: number;
  readonly movingMs: number;
  readonly maxSpeed: number | null;
  readonly movement: MovementState;
  readonly movingSince: number | null;
  readonly lastSampleAt: number | null;
  /** Hysteresis: samples, time and distance waiting on a state change. */
  readonly candidates: number;
  readonly pendingMs: number;
  readonly pendingMeters: number;
  readonly pendingStart: number | null;
  readonly smoothed: number | null;
  readonly level: number | null;
  readonly altitudeAt: number | null;
  readonly verticalStreak: number;
  readonly gain: number;
  readonly loss: number;
  readonly altitudeSamples: number;
  readonly rejected: RecordingTelemetry["rejected"];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const INITIAL_RECORDING_TELEMETRY_STATE: RecordingTelemetryState = {
  version: 1,
  anchor: null,
  history: [],
  lastSpeed: null,
  jumpStreak: 0,
  distance: 0,
  movingMs: 0,
  maxSpeed: null,
  movement: "stopped",
  movingSince: null,
  lastSampleAt: null,
  candidates: 0,
  pendingMs: 0,
  pendingMeters: 0,
  pendingStart: null,
  smoothed: null,
  level: null,
  altitudeAt: null,
  verticalStreak: 0,
  gain: 0,
  loss: 0,
  altitudeSamples: 0,
  rejected: { poorAccuracy: 0, jumps: 0, speedSpikes: 0, verticalJumps: 0 },
};

function copyState(state: RecordingTelemetryState): Mutable<RecordingTelemetryState> {
  return {
    ...state,
    anchor: state.anchor === null ? null : { ...state.anchor, coordinate: { ...state.anchor.coordinate } },
    history: state.history.map((fix) => ({ ...fix, coordinate: { ...fix.coordinate } })),
    rejected: { ...state.rejected },
  };
}

/**
 * The state after a break the fold did not see, such as a page reload: exactly
 * what a pause does to it. The next fix starts a new chain, so the time spent
 * away never counts as moving and nothing is credited across it; the totals
 * (moving time, distance, max, gain and loss) are kept.
 */
export function suspendRecordingTelemetry(state: RecordingTelemetryState): RecordingTelemetryState {
  return {
    ...copyState(state),
    anchor: null,
    history: [],
    lastSpeed: null,
    movement: "stopped",
    movingSince: null,
    candidates: 0,
    pendingMs: 0,
    pendingMeters: 0,
    pendingStart: null,
    smoothed: null,
    level: null,
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finiteNumber(value);
}

function countOf(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && Number.isInteger(value);
}

function coordinateOf(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null) return false;
  const { lon, lat } = value as Record<string, unknown>;
  return finiteNumber(lon) && finiteNumber(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

function speedFixOf(value: unknown): value is SpeedFix {
  if (typeof value !== "object" || value === null) return false;
  const fix = value as Record<string, unknown>;
  return coordinateOf(fix.coordinate) && finiteNumber(fix.atMs) && nullableFinite(fix.accuracyMeters);
}

/**
 * A stored state, validated field by field; `null` for anything that is not a
 * state this version wrote, so a corrupt entry is dropped, never folded.
 */
export function parseRecordingTelemetryState(value: unknown): RecordingTelemetryState | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return null;
  const anchor = v.anchor as Record<string, unknown> | null;
  const anchorOk =
    anchor === null ||
    (typeof anchor === "object" &&
      coordinateOf(anchor.coordinate) &&
      finiteNumber(anchor.atMs) &&
      finiteNumber(anchor.accuracyMeters) &&
      finiteNumber(anchor.pausedDurationMs));
  const rejected = v.rejected as Record<string, unknown> | null;
  const ok =
    anchorOk &&
    Array.isArray(v.history) &&
    v.history.length <= 1_000 &&
    v.history.every(speedFixOf) &&
    nullableFinite(v.lastSpeed) &&
    countOf(v.jumpStreak) &&
    finiteNumber(v.distance) &&
    v.distance >= 0 &&
    finiteNumber(v.movingMs) &&
    v.movingMs >= 0 &&
    nullableFinite(v.maxSpeed) &&
    (v.movement === "moving" || v.movement === "stopped") &&
    nullableFinite(v.movingSince) &&
    nullableFinite(v.lastSampleAt) &&
    countOf(v.candidates) &&
    finiteNumber(v.pendingMs) &&
    finiteNumber(v.pendingMeters) &&
    nullableFinite(v.pendingStart) &&
    nullableFinite(v.smoothed) &&
    nullableFinite(v.level) &&
    nullableFinite(v.altitudeAt) &&
    countOf(v.verticalStreak) &&
    finiteNumber(v.gain) &&
    finiteNumber(v.loss) &&
    countOf(v.altitudeSamples) &&
    typeof rejected === "object" &&
    rejected !== null &&
    countOf(rejected.poorAccuracy) &&
    countOf(rejected.jumps) &&
    countOf(rejected.speedSpikes) &&
    countOf(rejected.verticalJumps);
  return ok ? copyState(value as RecordingTelemetryState) : null;
}

export interface RecordingTelemetryAccumulator {
  add(point: RecordingPosition): void;
  snapshot(): RecordingTelemetry;
  /** A copy of the fold's state, to keep and continue from later. */
  state(): RecordingTelemetryState;
}

/**
 * Folds recorded points in order. Each interval between two credible fixes is
 * credited to moving or stopped by the state machine; a pause, a long gap or a
 * re-anchored jump breaks the chain and credits nothing.
 *
 * `from` continues an earlier fold: folding the rest of a trace onto a state
 * gives exactly what folding the whole trace does.
 */
export function createRecordingTelemetry(from: RecordingTelemetryState = INITIAL_RECORDING_TELEMETRY_STATE): RecordingTelemetryAccumulator {
  const L = TELEMETRY_LIMITS;
  const s = copyState(from);
  const rejected = s.rejected as Mutable<RecordingTelemetry["rejected"]>;

  function clearPending(): void {
    s.candidates = 0;
    s.pendingMs = 0;
    s.pendingMeters = 0;
    s.pendingStart = null;
  }

  /** A pause, a long gap or a re-anchor: nothing is credited across it. */
  function breakChain(point: TelemetryAnchor): void {
    s.anchor = point;
    s.history = [];
    s.lastSpeed = null;
    s.movement = "stopped";
    s.movingSince = null;
    clearPending();
    s.smoothed = null;
    s.level = null;
  }

  function credit(intervalMs: number, meters: number, speed: number, startedAt: number): void {
    if (s.movement === "stopped") {
      if (speed >= L.movingEnterSpeedMps) {
        s.candidates += 1;
        s.pendingMs += intervalMs;
        s.pendingMeters += meters;
        s.pendingStart ??= startedAt;
        if (s.candidates >= L.movingEnterSamples) {
          s.movement = "moving";
          s.movingSince = s.pendingStart;
          s.movingMs += s.pendingMs;
          s.distance += s.pendingMeters;
          clearPending();
        }
      } else {
        clearPending();
      }
      return;
    }
    if (speed < L.movingHoldSpeedMps) {
      s.pendingMs += intervalMs;
      s.pendingMeters += meters;
      s.pendingStart ??= startedAt;
      if (startedAt + intervalMs - s.pendingStart >= L.stoppedAfterMs) {
        // A sustained stop: the whole low-speed window was stopped time.
        s.movement = "stopped";
        s.movingSince = null;
        clearPending();
      }
      return;
    }
    // Still moving: a short dip (stoplight jitter, a rolling stop) stays moving time.
    s.movingMs += s.pendingMs + intervalMs;
    s.distance += s.pendingMeters + meters;
    clearPending();
  }

  function addAltitude(point: RecordingPosition, atMs: number): void {
    const altitude = point.altitudeMeters;
    if (!finite(altitude)) return;
    const accuracy = point.altitudeAccuracyMeters;
    if (finite(accuracy) && accuracy > L.maxUsableAltitudeAccuracyMeters) return;
    s.altitudeSamples += 1;
    if (s.smoothed === null || s.level === null || s.altitudeAt === null || atMs - s.altitudeAt > L.maxAltitudeGapMs) {
      s.smoothed = altitude;
      s.level = altitude;
      s.altitudeAt = atMs;
      s.verticalStreak = 0;
      return;
    }
    const seconds = Math.max(0, atMs - s.altitudeAt) / 1_000;
    if (Math.abs(altitude - s.smoothed) > L.maxVerticalRateMps * seconds + L.verticalJumpSlackMeters) {
      rejected.verticalJumps += 1;
      s.verticalStreak += 1;
      if (s.verticalStreak >= L.verticalReanchorSamples) {
        s.smoothed = altitude;
        s.level = altitude;
        s.altitudeAt = atMs;
        s.verticalStreak = 0;
      }
      return;
    }
    s.verticalStreak = 0;
    const alpha = 1 - Math.exp(-(atMs - s.altitudeAt) / L.elevationTimeConstantMs);
    s.smoothed += alpha * (altitude - s.smoothed);
    s.altitudeAt = atMs;
    if (s.smoothed - s.level >= L.elevationDeadbandMeters) {
      s.gain += s.smoothed - s.level;
      s.level = s.smoothed;
    } else if (s.level - s.smoothed >= L.elevationDeadbandMeters) {
      s.loss += s.level - s.smoothed;
      s.level = s.smoothed;
    }
  }

  return {
    add(point) {
      const atMs = Date.parse(point.observedAt);
      if (!Number.isFinite(atMs)) return;
      if (!usableAccuracy(point.accuracyMeters)) {
        rejected.poorAccuracy += 1;
        return;
      }
      const current: TelemetryAnchor = {
        atMs,
        coordinate: point.coordinate,
        accuracyMeters: point.accuracyMeters,
        pausedDurationMs: point.pausedDurationMs ?? 0,
      };
      const anchor = s.anchor;
      if (anchor === null) {
        breakChain(current);
        s.lastSampleAt = atMs;
        s.history = [{ coordinate: current.coordinate, atMs, accuracyMeters: current.accuracyMeters }];
        addAltitude(point, atMs);
        return;
      }
      const intervalMs = atMs - anchor.atMs;
      if (intervalMs <= 0) return;
      if (current.pausedDurationMs > anchor.pausedDurationMs || intervalMs > L.maxBridgeGapMs) {
        breakChain(current);
        s.lastSampleAt = atMs;
        s.history = [{ coordinate: current.coordinate, atMs, accuracyMeters: current.accuracyMeters }];
        addAltitude(point, atMs);
        return;
      }
      const seconds = intervalMs / 1_000;
      const meters = haversine(anchor.coordinate, current.coordinate);
      // Impossible one-sample jump: farther than the last speed plus a hard
      // acceleration could carry the rider, beyond both fixes' uncertainty.
      const reachSpeed =
        s.lastSpeed === null
          ? L.maxPlausibleSpeedMps
          : Math.min(L.maxPlausibleSpeedMps, s.lastSpeed + L.maxAccelerationMps2 * seconds);
      const allowed = reachSpeed * seconds + anchor.accuracyMeters + current.accuracyMeters + L.jumpSlackMeters;
      if (meters > allowed) {
        rejected.jumps += 1;
        s.jumpStreak += 1;
        if (s.jumpStreak >= L.jumpReanchorSamples) {
          s.jumpStreak = 0;
          breakChain(current);
          s.lastSampleAt = atMs;
          s.history = [{ coordinate: current.coordinate, atMs, accuracyMeters: current.accuracyMeters }];
        }
        return;
      }
      s.jumpStreak = 0;

      const speedFix: SpeedFix = { coordinate: current.coordinate, atMs, accuracyMeters: current.accuracyMeters };
      const derived = deriveSpeedMps(s.history, speedFix);
      let speed: number | null =
        finite(point.speedMps) && point.speedMps >= 0 && point.speedMps <= L.maxPlausibleSpeedMps
          ? point.speedMps
          : null;
      if (speed === null && finite(point.speedMps)) rejected.speedSpikes += 1;
      const lastSpeed = s.lastSpeed;
      if (speed !== null && lastSpeed !== null) {
        const acceleration = Math.abs(speed - lastSpeed) / seconds;
        const corroborated = derived !== null && Math.abs(speed - derived) <= L.speedAgreementMps;
        if (acceleration > L.maxAccelerationMps2 && !corroborated) {
          rejected.speedSpikes += 1;
          speed = null;
        }
      }
      speed ??= derived;

      // No speed at all for this fix (no baseline yet): it neither starts nor
      // ends a state change; it is judged at the last credible speed.
      credit(intervalMs, meters, speed ?? lastSpeed ?? 0, anchor.atMs);
      // Max speed must be held for two consecutive credible samples: one
      // sample is never enough to set a record.
      if (speed !== null && lastSpeed !== null && s.movement === "moving") {
        const held = Math.min(speed, lastSpeed);
        if (s.maxSpeed === null || held > s.maxSpeed) s.maxSpeed = held;
      }
      if (speed !== null) s.lastSpeed = speed;
      s.anchor = current;
      s.lastSampleAt = atMs;
      s.history = [...pruneSpeedHistory(s.history, atMs), speedFix];
      addAltitude(point, atMs);
    },

    snapshot() {
      const altitudeLapsed =
        s.altitudeAt === null || s.lastSampleAt === null || s.lastSampleAt - s.altitudeAt > L.maxAltitudeGapMs;
      return {
        acceptedDistanceMeters: s.distance,
        movingMs: s.movingMs,
        maxSpeedMps: s.maxSpeed,
        movement: s.movement,
        movingSinceMs: s.movingSince,
        lastSampleAtMs: s.lastSampleAt,
        elevation: {
          currentMeters: s.smoothed === null || altitudeLapsed ? null : s.smoothed,
          sampledAtMs: altitudeLapsed ? null : s.altitudeAt,
          gainMeters: s.gain,
          lossMeters: s.loss,
          sampleCount: s.altitudeSamples,
        },
        rejected: { ...rejected },
      };
    },

    state() {
      return copyState(s);
    },
  };
}

/** The telemetry of a whole trace, in order. */
export function summarizeRecordingTelemetry(points: Iterable<RecordingPosition>): RecordingTelemetry {
  const accumulator = createRecordingTelemetry();
  for (const point of points) accumulator.add(point);
  return accumulator.snapshot();
}
