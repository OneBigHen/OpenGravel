import type { Coordinate } from "../ride/types";

/**
 * The local sample recording keeps. Heading stays out until a feature reads it
 * (08 §12; 11 §14). Speed and altitude are optional and only present when the
 * device reported them (RIDE-INSTRUMENT-STRIP §6): the ride strip's telemetry
 * filter reads them, and a trace recorded before they existed stays valid.
 * These are the raw reported values; filtering never rewrites a point.
 */
export interface RecordingPosition {
  readonly coordinate: Coordinate;
  readonly observedAt: string;
  readonly accuracyMeters: number | null;
  /** Cumulative completed pause time folded from the owning RideSession journal. */
  readonly pausedDurationMs?: number;
  /** Device-reported ground speed; absent when the device reported none. */
  readonly speedMps?: number;
  /** Device-reported altitude (metres above the device's datum); absent when none. */
  readonly altitudeMeters?: number;
  /** Device-reported vertical accuracy; absent when none. */
  readonly altitudeAccuracyMeters?: number;
}

export interface RecordingSummary {
  readonly distanceMeters: number;
  /** Wall time from the first accepted fix through the last accepted fix. */
  readonly elapsedSeconds: number;
  /** Elapsed time less paused intervals observed between those fixes. */
  readonly movingSeconds: number;
  readonly pointCount: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecordingPosition(value: unknown): value is RecordingPosition {
  if (!isRecord(value) || !isRecord(value.coordinate)) return false;
  const { lat, lon } = value.coordinate;
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180 &&
    typeof value.observedAt === "string" &&
    !Number.isNaN(Date.parse(value.observedAt)) &&
    (value.accuracyMeters === null ||
      (typeof value.accuracyMeters === "number" &&
        Number.isFinite(value.accuracyMeters) &&
        value.accuracyMeters >= 0)) &&
    (value.pausedDurationMs === undefined ||
      (typeof value.pausedDurationMs === "number" &&
        Number.isSafeInteger(value.pausedDurationMs) &&
        value.pausedDurationMs >= 0)) &&
    (value.speedMps === undefined || nonNegativeFinite(value.speedMps)) &&
    (value.altitudeMeters === undefined ||
      (typeof value.altitudeMeters === "number" && Number.isFinite(value.altitudeMeters))) &&
    (value.altitudeAccuracyMeters === undefined || nonNegativeFinite(value.altitudeAccuracyMeters))
  );
}

function nonNegativeFinite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isRecordingSummary(value: unknown): value is RecordingSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.distanceMeters === "number" &&
    Number.isFinite(value.distanceMeters) &&
    value.distanceMeters >= 0 &&
    typeof value.elapsedSeconds === "number" &&
    Number.isSafeInteger(value.elapsedSeconds) &&
    value.elapsedSeconds >= 0 &&
    typeof value.movingSeconds === "number" &&
    Number.isSafeInteger(value.movingSeconds) &&
    value.movingSeconds >= 0 &&
    value.movingSeconds <= value.elapsedSeconds &&
    typeof value.pointCount === "number" &&
    Number.isInteger(value.pointCount) &&
    value.pointCount >= 0
  );
}
