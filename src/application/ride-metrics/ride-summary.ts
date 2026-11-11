/**
 * The end-of-ride summary (launch push, 2026-09-28): the few numbers a rider
 * wants when they stop: distance, moving time, average and top speed, and the
 * climb. Built from the same filtered telemetry the strip reads (slice B), so
 * the summary never disagrees with what the strip showed. A number without an
 * honest source is left out, never shown as 0.
 *
 * A recorded ride also knows how long it stood still: its summary carries both
 * clocks, so "Stopped" is their difference and nothing else. A ride with no
 * recording summary has no elapsed time on this surface, and so no stopped
 * stat rather than an invented one.
 */

import { METERS_PER_MILE } from "@/application/planner/measurements";
import type { RecordingSummary } from "@/domain/recording/types";
import { movingAverageSpeedMps, type RecordingTelemetry } from "@/domain/recording/telemetry";

export interface RideSummaryStat {
  readonly id: "distance" | "moving" | "average" | "max" | "climb" | "stopped";
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
}

const MPH_PER_MPS = 2.236_936_3;
const KMH_PER_MPS = 3.6;
const FEET_PER_METER = 3.280_84;
/** Under a minute of moving time there is no ride to summarise. */
const MIN_MOVING_MS = 60_000;
/** A few seconds at a light is not a stat: "Stopped" starts at a whole minute. */
const MIN_STOPPED_MS = 60_000;

/** A number as a surface prints it: the figure and the unit beside it. */
export interface RideStatText {
  readonly value: string;
  readonly unit: string;
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
}

/** `("25", "min")` / `("1:30", "h")`: the value and unit the grid's dd and small unit print. */
export function durationStat(ms: number): RideStatText {
  const text = duration(ms);
  return text.endsWith(" min")
    ? { value: text.replace(/ min$/, ""), unit: "min" }
    : { value: text, unit: "h" };
}

/**
 * A distance in the rider's unit, rounded the one way the app rounds: whole
 * numbers from 10 up (9.97 reads "10", never "10.0"), tenths below.
 */
export function distanceStat(meters: number, units: "imperial" | "metric" = "imperial"): RideStatText {
  const metric = units === "metric";
  const distance = metric ? meters / 1000 : meters / METERS_PER_MILE;
  return {
    value: distance >= 9.95 ? String(Math.round(distance)) : distance.toFixed(1),
    unit: metric ? "km" : "mi",
  };
}

/** A speed in the rider's unit, in whole numbers: 10 m/s reads "22 mph". */
export function speedStat(mps: number, units: "imperial" | "metric" = "imperial"): RideStatText {
  const metric = units === "metric";
  return {
    value: String(Math.round(mps * (metric ? KMH_PER_MPS : MPH_PER_MPS))),
    unit: metric ? "km/h" : "mph",
  };
}

/** A climb in the rider's unit, rounded and grouped: 914.4 m reads "3,000 ft". */
export function climbStat(meters: number, units: "imperial" | "metric" = "imperial"): RideStatText {
  const metric = units === "metric";
  const climb = metric ? meters : meters * FEET_PER_METER;
  return { value: Math.round(climb).toLocaleString("en-US"), unit: metric ? "m" : "ft" };
}

export function rideSummaryStats(
  telemetry: RecordingTelemetry | null,
  units: "imperial" | "metric" = "imperial",
  recordingSummary: RecordingSummary | null = null,
): readonly RideSummaryStat[] {
  if (telemetry === null || telemetry.movingMs < MIN_MOVING_MS) return [];
  const stats: RideSummaryStat[] = [];
  stats.push({ id: "distance", label: "Distance", ...distanceStat(telemetry.acceptedDistanceMeters, units) });
  stats.push({ id: "moving", label: "Moving time", ...durationStat(telemetry.movingMs) });
  const average = movingAverageSpeedMps(telemetry);
  if (average !== null) stats.push({ id: "average", label: "Avg speed", ...speedStat(average, units) });
  if (telemetry.maxSpeedMps !== null) {
    stats.push({ id: "max", label: "Top speed", ...speedStat(telemetry.maxSpeedMps, units) });
  }
  if (telemetry.elevation.sampleCount > 0) {
    stats.push({ id: "climb", label: "Climb", ...climbStat(telemetry.elevation.gainMeters, units) });
  }
  // Only a recording has both clocks, and elapsed − moving is then a real
  // duration rather than a guess at one.
  if (recordingSummary !== null) {
    const stoppedMs = (recordingSummary.elapsedSeconds - recordingSummary.movingSeconds) * 1000;
    if (Number.isFinite(stoppedMs) && stoppedMs >= MIN_STOPPED_MS) {
      const stopped = durationStat(stoppedMs);
      stats.push({ id: "stopped", label: "Stopped", value: stopped.value, unit: stopped.unit });
    }
  }
  return stats;
}
