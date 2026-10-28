/** DEM measurements stay inside each continuous geometry part. Never bridge gaps. */
import { haversine } from "../../../src/domain/geometry/analysis";
import { buildHikeProfile } from "../../../src/domain/hike/profile";
import { computeHikeStats } from "../../../src/domain/hike/stats";
import { toblerTime } from "../../../src/domain/hike/time";
import type { Coordinate } from "../../../src/domain/ride/types";
import type { DemSource } from "./dem";
import type { Trail, TrailMeasurements } from "./types";

export const DEM_SAMPLE_METERS = 30;

/** Preserve every geometry vertex (including short closed loops), densifying to at most 30 m. */
export function sampleLine(line: readonly Coordinate[], spacing = DEM_SAMPLE_METERS): Coordinate[] {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error("sample spacing must be positive");
  if (line.length < 2) return [...line];
  const result = [line[0]!];
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!, b = line[i]!, length = haversine(a, b);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      result.push({ lon: a.lon + (b.lon - a.lon) * fraction, lat: a.lat + (b.lat - a.lat) * fraction });
    }
  }
  return result;
}

export async function measureTrail(trail: Trail, source: DemSource, zoom = 12): Promise<TrailMeasurements> {
  let gain = 0, loss = 0, measured = 0, length = 0, minutes = 0;
  let maxGrade: number | null = null;
  for (const part of trail.lines) {
    const line = sampleLine(part);
    const elevations = await source.elevations(line);
    const stats = computeHikeStats(line, elevations);
    const time = toblerTime(buildHikeProfile(line, elevations));
    gain += stats.gainMeters ?? 0;
    loss += stats.lossMeters ?? 0;
    measured += stats.elevation.measuredLengthMeters;
    length += stats.lengthMeters;
    minutes += time.preciseMinutes;
    if (stats.maxGrade !== null && (maxGrade === null || Math.abs(stats.maxGrade.percent) > Math.abs(maxGrade))) maxGrade = stats.maxGrade.percent;
  }
  const complete = length > 0 && measured / length > 1 - 1e-9;
  return {
    elevationGainMeters: complete ? Math.round(gain) : null,
    elevationLossMeters: complete ? Math.round(loss) : null,
    maxGradePercent: complete && maxGrade !== null ? Math.round(maxGrade * 10) / 10 : null,
    toblerMinutes: complete ? Math.round(minutes * 10) / 10 : null,
    elevationMeasuredShare: length > 0 ? measured / length : 0,
    elevationSource: `Mapterhorn Terrarium z${zoom}, bilinear, ≤30 m samples, all geometry vertices; grade window 100 m`,
    timeMethod: "Tobler per DEM segment, geometry order; no breaks or personal/surface/SAC adjustment; unknown terrain can be slower",
  };
}
