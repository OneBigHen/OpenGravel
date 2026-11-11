/**
 * The ride card (R3-2): the proof of a ride in one picture — the line the rider
 * took, the date and the four numbers a rider says out loud afterwards: miles,
 * moving time, dirt miles and climb.
 *
 * Built from a finished recording, with four rules that keep it honest:
 *
 * - **One source of numbers.** Distance, moving time, average and climb come
 *   from the same filtered telemetry the strip read (`telemetry.ts`), formatted
 *   by the same rules the end-of-ride summary uses (`ride-summary.ts`). The card
 *   never disagrees with what the rider watched while riding.
 * - **Unknown surface is unknown miles.** Dirt is only ever the measured
 *   gravel/dirt runs that lie within the distance ridden. Everything the plan
 *   did not measure — a gap between runs, past the last run, a Free Ride with no
 *   plan at all — is reported as unknown, never folded into paved or gravel.
 * - **A number without an honest source is left out.** No altitude samples
 *   means no climb; no measured surface means no dirt figure. The screen shows
 *   an em dash, never a zero that claims the ride had none.
 * - **The picture is bounded.** The line is simplified to at most 400 points,
 *   so a six-hour trace draws the same picture without carrying 20,000 points
 *   through storage or a canvas.
 *
 * Pure: no clock, no storage, no browser. The same points always build the same
 * card.
 */

import { METERS_PER_MILE } from "@/application/planner/measurements";
import type { SurfaceRunSpan } from "@/application/ride-session/surface-ahead";
import type { Coordinate } from "@/domain/ride/types";
import {
  createRecordingTelemetry,
  movingAverageSpeedMps,
  type RecordingTelemetry,
} from "@/domain/recording/telemetry";
import type { RecordingSummary } from "@/domain/recording/types";
import {
  climbStat,
  distanceStat,
  durationStat,
  speedStat,
  type RideStatText,
} from "./ride-summary";

/** A card's line never carries more than this many points. */
export const RIDE_CARD_MAX_POINTS = 400;

/** The smallest recorded point the card reads. `RecordingPosition` satisfies it. */
export interface RideCardPoint {
  readonly coordinate: Coordinate;
  readonly observedAt: string;
  readonly accuracyMeters: number | null;
  readonly pausedDurationMs?: number;
  readonly speedMps?: number;
  readonly altitudeMeters?: number;
  readonly altitudeAccuracyMeters?: number;
}

/**
 * How much of the ride's distance the plan measured, and how much it did not.
 * `unknownMeters` is everything that is neither measured dirt nor measured
 * paved: a gap between runs, a run the plan never measured, or a Free Ride with
 * no plan at all.
 */
export interface RideCardSurface {
  /** Gravel and dirt together: every measured unpaved metre ridden. */
  readonly dirtMeters: number;
  readonly pavedMeters: number;
  readonly unknownMeters: number;
  /** Dirt as a share of the measured surface, `0..1`; `null` when nothing is measured. */
  readonly dirtShare: number | null;
}

export interface RideCardNumbers {
  readonly distance: RideStatText;
  readonly moving: RideStatText;
  /** `null` when the plan (or the device) measured no surface. */
  readonly dirt: RideStatText | null;
  /** `null` when the device reported no altitude. */
  readonly climb: RideStatText | null;
}

export interface RideCard {
  /** The ride's name, or "Ride, Nov 11" when it never had one. */
  readonly title: string;
  /** "Nov 11": the day the ride started, or the day it was saved. */
  readonly date: string;
  /** ISO instants of the recording's first and last fix, `null` when none. */
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly distanceMeters: number;
  readonly movingMs: number;
  readonly averageSpeedMps: number | null;
  readonly climbMeters: number | null;
  /** `null` when there is not enough moving time for an average. */
  readonly average: RideStatText | null;
  readonly surface: RideCardSurface;
  readonly numbers: RideCardNumbers;
  /** At most {@link RIDE_CARD_MAX_POINTS} points, in order. */
  readonly line: readonly Coordinate[];
}

export type UnitSystem = "imperial" | "metric";

export interface BuildRideCardInput {
  /** The finished recording's points, in order. */
  readonly points: readonly RideCardPoint[];
  /** The guided plan's measured surface runs, in metres along its line. */
  readonly surfaceRuns?: readonly SurfaceRunSpan[] | null;
  readonly units?: UnitSystem;
  /** The ride's own name; absent means "Ride, <date>". */
  readonly title?: string | null;
  /** The day to print when the recording has no usable first fix (a saved ride's day). */
  readonly date?: string | null;
}

/** One month name per index, so the card's date does not follow the machine's locale. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Nov 11" from an ISO instant, or `null` when it is not a readable date. */
export function rideCardDate(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  // The rider's own day, not UTC's: a ride at 9pm must not read the next date.
  const date = new Date(parsed);
  const month = MONTHS[date.getMonth()];
  return month === undefined ? null : `${month} ${date.getDate()}`;
}

/** The only date fallback: the day the card is for when no instant is known. */
function fallbackTitle(date: string | null): string {
  return date === null ? "Ride" : `Ride, ${date}`;
}

function titleOf(name: string | null | undefined, date: string | null): string {
  const trimmed = name?.trim() ?? "";
  return trimmed.length === 0 ? fallbackTitle(date) : trimmed;
}

/**
 * The measured surface of the distance actually ridden, clipped to the runs.
 *
 * The plan's runs start at its own start, so a ride that began part-way along a
 * plan is measured as if it began at the line's start. That is the one
 * assumption this module makes, and it is safe in the direction that matters:
 * it can only under-report dirt (never invent it), and whatever the runs do not
 * cover stays `unknown`.
 */
export function rideCardSurface(
  riddenMeters: number,
  runs: readonly SurfaceRunSpan[] | null | undefined,
): RideCardSurface {
  const ridden = Number.isFinite(riddenMeters) && riddenMeters > 0 ? riddenMeters : 0;
  let dirt = 0;
  let paved = 0;
  let coveredTo = 0;
  for (const run of (runs ?? []).slice().sort((left, right) => left.from - right.from)) {
    // Overlapping or backwards answers are trimmed to the part not yet counted.
    const from = Math.max(0, run.from, coveredTo);
    const to = Math.min(run.to, ridden);
    if (!(to > from)) {
      coveredTo = Math.max(coveredTo, Math.min(run.to, ridden));
      continue;
    }
    if (run.kind === "gravel" || run.kind === "dirt") dirt += to - from;
    else if (run.kind === "paved") paved += to - from;
    // `unknown` runs are not counted here: everything unmeasured is unknown.
    coveredTo = Math.max(coveredTo, to);
    if (run.from >= ridden) break;
  }
  const measured = dirt + paved;
  const unknown = Math.max(0, ridden - measured);
  return {
    dirtMeters: dirt,
    pavedMeters: paved,
    unknownMeters: unknown,
    dirtShare: measured > 0 ? dirt / measured : null,
  };
}

/** Squared distance from `point` to the segment `start`–`end`, in a flat projection. */
function segmentDistance(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const meanLatitude = ((start.lat + end.lat) / 2) * (Math.PI / 180);
  const cos = Math.cos(meanLatitude);
  const px = point.lon * cos;
  const py = point.lat;
  const sx = start.lon * cos;
  const sy = start.lat;
  const ex = end.lon * cos;
  const ey = end.lat;
  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - sx, py - sy);
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lengthSquared));
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
}

/** Douglas–Peucker: the points that carry the line's shape, ends kept. */
function douglasPeucker(points: readonly Coordinate[], tolerance: number): Coordinate[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let index = -1;
  let farthest = tolerance;
  for (let position = 1; position < points.length - 1; position += 1) {
    const distance = segmentDistance(points[position]!, first, last);
    if (distance > farthest) {
      farthest = distance;
      index = position;
    }
  }
  if (index === -1) return [first, last];
  const left = douglasPeucker(points.slice(0, index + 1), tolerance);
  const right = douglasPeucker(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * The line as at most `maxPoints` points, in order, with its two ends kept.
 * A line already short enough is returned as it is.
 */
export function simplifyLine(
  coordinates: readonly Coordinate[],
  maxPoints: number = RIDE_CARD_MAX_POINTS,
): readonly Coordinate[] {
  const limit = Math.max(2, Math.floor(maxPoints));
  if (coordinates.length <= limit) return [...coordinates];
  // The smallest tolerance whose line fits, so the picture keeps as many of the
  // rider's own points as the limit allows.
  let low = 0;
  let high = 1e-7;
  let best = douglasPeucker(coordinates, high);
  while (best.length > limit && high < 1) {
    low = high;
    high *= 4;
    best = douglasPeucker(coordinates, high);
  }
  if (best.length > limit) {
    // A degenerate line (thousands of points on one spot): keep its ends and
    // sample its interior evenly, so the cap holds whatever the shape.
    const ends = [coordinates[0]!, coordinates[coordinates.length - 1]!];
    return [...ends.slice(0, 1), ...adopt(coordinates, limit - 2), ...ends.slice(1)];
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const middle = (low + high) / 2;
    const candidate = douglasPeucker(coordinates, middle);
    if (candidate.length <= limit) {
      best = candidate;
      high = middle;
    } else {
      low = middle;
    }
  }
  return best;
}

/** Evenly spaced interior points, for a line no tolerance can thin below the cap. */
function adopt(points: readonly Coordinate[], count: number): Coordinate[] {
  if (count <= 0 || points.length === 0) return [];
  const step = points.length / (count + 1);
  return Array.from({ length: count }, (_, index) => points[Math.min(points.length - 1, Math.round((index + 1) * step))]!);
}

function isFiniteAccuracy(point: RideCardPoint): boolean {
  return typeof point.accuracyMeters === "number" && Number.isFinite(point.accuracyMeters);
}

function firstInstant(points: readonly RideCardPoint[]): string | null {
  for (const point of points) {
    if (Number.isFinite(Date.parse(point.observedAt))) return point.observedAt;
  }
  return null;
}

function lastInstant(points: readonly RideCardPoint[]): string | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (Number.isFinite(Date.parse(point.observedAt))) return point.observedAt;
  }
  return null;
}

function telemetryOf(points: readonly RideCardPoint[]): RecordingTelemetry {
  const accumulator = createRecordingTelemetry();
  for (const point of points) {
    // A fix with no measured accuracy is not usable for distance or motion, and
    // the filter already rejects those; passing it through keeps one rule for it.
    if (!isFiniteAccuracy(point)) continue;
    accumulator.add(point);
  }
  return accumulator.snapshot();
}

function numbersOf(
  telemetry: RecordingTelemetry,
  units: UnitSystem,
  surface: RideCardSurface,
): RideCardNumbers {
  const measured = telemetry.elevation.sampleCount > 0;
  const dirtKnown = surface.dirtMeters + surface.pavedMeters > 0;
  return {
    distance: distanceStat(telemetry.acceptedDistanceMeters, units),
    moving: durationStat(telemetry.movingMs),
    dirt: dirtKnown ? distanceStat(surface.dirtMeters, units) : null,
    climb: measured ? climbStat(telemetry.elevation.gainMeters, units) : null,
  };
}

/** The card of a finished recording. */
export function buildRideCard(input: BuildRideCardInput): RideCard {
  const units = input.units ?? "imperial";
  const points = input.points;
  const telemetry = telemetryOf(points);
  const surface = rideCardSurface(telemetry.acceptedDistanceMeters, input.surfaceRuns);
  const startedAt = firstInstant(points);
  const endedAt = lastInstant(points);
  const date = rideCardDate(startedAt) ?? rideCardDate(input.date);
  const average = movingAverageSpeedMps(telemetry);
  return {
    title: titleOf(input.title, date),
    date: date ?? "Ride",
    startedAt,
    endedAt,
    distanceMeters: telemetry.acceptedDistanceMeters,
    movingMs: telemetry.movingMs,
    averageSpeedMps: average,
    climbMeters: telemetry.elevation.sampleCount > 0 ? telemetry.elevation.gainMeters : null,
    average: average === null ? null : speedStat(average, units),
    surface,
    numbers: numbersOf(telemetry, units, surface),
    line: simplifyLine(points.map((point) => point.coordinate)),
  };
}

export interface BuildStoredRideCardInput {
  readonly title: string;
  /** The day the ride was saved, when the recording's own instants are not stored. */
  readonly savedAt: string;
  /** What the library kept: distance, both clocks and the point count. */
  readonly summary: RecordingSummary;
  /** The recorded line the library kept (a bounded preview is enough for the picture). */
  readonly line: readonly Coordinate[];
  readonly units?: UnitSystem;
}

/**
 * The card of a ride already in My rides.
 *
 * A saved ride keeps its distance and both clocks, but not its elevation or the
 * plan's surface runs, so those two numbers come out unknown — the same rule as
 * anywhere else: no source, no number.
 */
export function buildStoredRideCard(input: BuildStoredRideCardInput): RideCard {
  const units = input.units ?? "imperial";
  const meters = Math.max(0, input.summary.distanceMeters);
  const movingMs = Math.max(0, input.summary.movingSeconds) * 1_000;
  const average = movingMs >= 10_000 ? meters / (movingMs / 1_000) : null;
  const date = rideCardDate(input.savedAt);
  return {
    title: titleOf(input.title, date),
    date: date ?? "Ride",
    startedAt: null,
    endedAt: null,
    distanceMeters: meters,
    movingMs,
    averageSpeedMps: average,
    climbMeters: null,
    average: average === null ? null : speedStat(average, units),
    surface: { dirtMeters: 0, pavedMeters: 0, unknownMeters: meters, dirtShare: null },
    numbers: {
      distance: distanceStat(meters, units),
      moving: durationStat(movingMs),
      dirt: null,
      climb: null,
    },
    line: simplifyLine(input.line),
  };
}

/** Miles to metres, for a caller that counts the other way. */
export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}
