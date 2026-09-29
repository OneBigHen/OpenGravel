/**
 * The end-of-ride summary (launch push, 2026-09-28): the few numbers a rider
 * wants when they stop: distance, moving time, average and top speed, and the
 * climb. Built from the same filtered telemetry the strip reads (slice B), so
 * the summary never disagrees with what the strip showed. A number without an
 * honest source is left out, never shown as 0.
 */

import { METERS_PER_MILE } from "@/application/planner/measurements";
import { movingAverageSpeedMps, type RecordingTelemetry } from "@/domain/recording/telemetry";

export interface RideSummaryStat {
  readonly id: "distance" | "moving" | "average" | "max" | "climb";
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
}

const MPH_PER_MPS = 2.236_936_3;
const KMH_PER_MPS = 3.6;
const FEET_PER_METER = 3.280_84;
/** Under a minute of moving time there is no ride to summarise. */
const MIN_MOVING_MS = 60_000;

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
}

export function rideSummaryStats(
  telemetry: RecordingTelemetry | null,
  units: "imperial" | "metric" = "imperial",
): readonly RideSummaryStat[] {
  if (telemetry === null || telemetry.movingMs < MIN_MOVING_MS) return [];
  const metric = units === "metric";
  const stats: RideSummaryStat[] = [];
  const distance = metric ? telemetry.acceptedDistanceMeters / 1000 : telemetry.acceptedDistanceMeters / METERS_PER_MILE;
  stats.push({
    id: "distance",
    label: "Distance",
    // Whole numbers from 10 up (9.97 reads "10", never "10.0"); tenths below.
    value: distance >= 9.95 ? String(Math.round(distance)) : distance.toFixed(1),
    unit: metric ? "km" : "mi",
  });
  const moving = duration(telemetry.movingMs);
  stats.push({ id: "moving", label: "Moving time", value: moving.replace(/ min$/, ""), unit: moving.endsWith(" min") ? "min" : "h" });
  const speed = (mps: number): string => String(Math.round(mps * (metric ? KMH_PER_MPS : MPH_PER_MPS)));
  const average = movingAverageSpeedMps(telemetry);
  if (average !== null) stats.push({ id: "average", label: "Avg speed", value: speed(average), unit: metric ? "km/h" : "mph" });
  if (telemetry.maxSpeedMps !== null) {
    stats.push({ id: "max", label: "Top speed", value: speed(telemetry.maxSpeedMps), unit: metric ? "km/h" : "mph" });
  }
  if (telemetry.elevation.sampleCount > 0) {
    const climb = metric ? telemetry.elevation.gainMeters : telemetry.elevation.gainMeters * FEET_PER_METER;
    stats.push({ id: "climb", label: "Climb", value: Math.round(climb).toLocaleString("en-US"), unit: metric ? "m" : "ft" });
  }
  return stats;
}
