/**
 * Lean angle from device gravity (issue #12 follow-up: motion.lean β).
 *
 * A phone's mount on a bike is arbitrary — flat on a tank bag, angled on a
 * bar mount, whatever the rider had to hand — so a raw device-orientation
 * angle is not a lean angle ("do not assume the phone is vertical"). This
 * module instead calibrates a reference against the device's OWN mount, once,
 * while the bike is upright and stationary, and reports lean as the signed
 * angle gravity has since rotated away from that reference, in the plane
 * perpendicular to "up" — never a raw device-frame angle.
 *
 * Deliberate limits, stated rather than hidden (never fabricate a value):
 *
 * - **The left/right axis is a documented assumption, not a measurement.**
 *   Calibration fixes "up" from gravity alone; it has no compass or GPS
 *   heading at that instant (the rider calibrates while STOPPED, exactly
 *   when heading is least reliable). The perpendicular-to-up "right" axis is
 *   built from the device's own local X axis, which matches the bike's real
 *   left/right for the common case of a phone mounted rotationally aligned
 *   with the bike (dash, tank, bar mounts almost always are). A mount
 *   rotated 90° about its own vertical would need a different seed axis;
 *   that is out of scope for this first beta.
 * - **This reads total gravity tilt, not isolated roll.** A hard brake or a
 *   steep grade also tips the gravity vector and shows up here alongside
 *   real lean. No accelerometer-only method fully separates the two without
 *   a gyroscope-fused reference frame — clearly beta until a stable device
 *   reference frame is proven. The low-pass filter damps the short, sharp
 *   spikes braking produces; a sustained climb reads as a lean-shaped offset
 *   for as long as it lasts.
 *
 * No Kalman filter, matching `domain/recording/telemetry`'s own rule: one
 * calibration, one exponential smoothing constant, plain thresholds.
 */

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function magnitude(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vector3): Vector3 | null {
  const mag = magnitude(v);
  if (!Number.isFinite(mag) || mag < 1e-6) return null;
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vector3, s: number): Vector3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** The device's own local X axis: the seed for "right" (see the file doc comment). */
const SEED_RIGHT: Vector3 = { x: 1, y: 0, z: 0 };
/** Used instead when gravity happens to run along the seed (within ~11°), so the seed is never parallel to "down". */
const SEED_FALLBACK: Vector3 = { x: 0, y: 1, z: 0 };
const SEED_PARALLEL_DOT = 0.98;

export interface LeanReference {
  /** Normalized reference gravity direction: "down" for this mount, this calibration. */
  readonly down: Vector3;
  /** Normalized, perpendicular to `down`: this calibration's "right". */
  readonly right: Vector3;
  readonly calibratedAtMs: number;
}

/** `null` only for a degenerate reading (an all-zero vector) — never a guessed reference. */
export function calibrateLeanReference(gravity: Vector3, atMs: number): LeanReference | null {
  const down = normalize(gravity);
  if (down === null) return null;
  const seed = Math.abs(dot(SEED_RIGHT, down)) > SEED_PARALLEL_DOT ? SEED_FALLBACK : SEED_RIGHT;
  const right = normalize(subtract(seed, scale(down, dot(seed, down))));
  if (right === null) return null;
  return { down, right, calibratedAtMs: atMs };
}

/**
 * The signed lean angle, in degrees, of `gravity` against `reference`: 0 at
 * the calibrated reference, positive toward the reference's "right", negative
 * toward "left". `null` only for a degenerate reading.
 */
export function leanAngleDegrees(reference: LeanReference, gravity: Vector3): number | null {
  const g = normalize(gravity);
  if (g === null) return null;
  const alongDown = dot(g, reference.down);
  const alongRight = dot(g, reference.right);
  return (Math.atan2(alongRight, alongDown) * 180) / Math.PI;
}

/** Exponential low-pass filter with a time constant, matching `domain/recording/telemetry`'s elevation smoothing. */
export function lowPass(previous: number | null, sample: number, dtMs: number, timeConstantMs: number): number {
  if (previous === null || !(dtMs > 0) || !(timeConstantMs > 0)) return sample;
  const alpha = 1 - Math.exp(-dtMs / timeConstantMs);
  return previous + alpha * (sample - previous);
}

/** Fast enough to feel live, slow enough to damp brake- and bump-sized spikes. */
export const LEAN_TIME_CONSTANT_MS = 400;

export interface LeanTelemetryState {
  readonly reference: LeanReference | null;
  /** Smoothed signed degrees; `null` only before the first calibration. */
  readonly smoothedDegrees: number | null;
  readonly lastSampleAtMs: number | null;
  /** Magnitudes, degrees; `0` until a sample past that side is seen. */
  readonly maxLeftDegrees: number;
  readonly maxRightDegrees: number;
}

export const INITIAL_LEAN_TELEMETRY_STATE: LeanTelemetryState = {
  reference: null,
  smoothedDegrees: null,
  lastSampleAtMs: null,
  maxLeftDegrees: 0,
  maxRightDegrees: 0,
};

/**
 * A fresh calibration: replaces the reference and clears the smoothing and
 * this ride's max — a deliberate re-zero, not a merge ("taps calibrate while
 * stopped and upright"). `null` only for a degenerate reading, in which case
 * the caller keeps whatever state it had.
 */
export function calibrateLean(gravity: Vector3, atMs: number): LeanTelemetryState | null {
  const reference = calibrateLeanReference(gravity, atMs);
  if (reference === null) return null;
  return { reference, smoothedDegrees: 0, lastSampleAtMs: atMs, maxLeftDegrees: 0, maxRightDegrees: 0 };
}

/**
 * One gravity sample folded in. Auto-calibrates on the very first sample (the
 * rider starting the ride with Lean already chosen); every later sample is
 * smoothed against the existing reference and extends that side's running
 * max. A degenerate sample is dropped, never counted as a zero.
 */
export function sampleLean(
  state: LeanTelemetryState,
  gravity: Vector3,
  atMs: number,
  timeConstantMs: number = LEAN_TIME_CONSTANT_MS,
): LeanTelemetryState {
  if (state.reference === null) return calibrateLean(gravity, atMs) ?? state;
  const raw = leanAngleDegrees(state.reference, gravity);
  if (raw === null) return state;
  const dtMs = state.lastSampleAtMs === null ? 0 : atMs - state.lastSampleAtMs;
  const smoothed = lowPass(state.smoothedDegrees, raw, dtMs, timeConstantMs);
  return {
    ...state,
    smoothedDegrees: smoothed,
    lastSampleAtMs: atMs,
    maxLeftDegrees: smoothed < 0 ? Math.max(state.maxLeftDegrees, -smoothed) : state.maxLeftDegrees,
    maxRightDegrees: smoothed > 0 ? Math.max(state.maxRightDegrees, smoothed) : state.maxRightDegrees,
  };
}

/** Why a lean reading is or is not showable right now — the ride-metrics resolver's vocabulary. */
export type LeanAvailability = "ready" | "calibrating" | "permission-needed" | "denied" | "unsupported";

/** What the ride-metrics strip needs to show the lean slot; computed upstream from raw sensor samples. */
export interface LeanMetricSnapshot {
  readonly availability: LeanAvailability;
  /** Smoothed signed degrees; present only when `availability` is `"ready"`. */
  readonly degrees: number | null;
  readonly maxLeftDegrees: number;
  readonly maxRightDegrees: number;
  readonly sampledAtMs: number | null;
}
