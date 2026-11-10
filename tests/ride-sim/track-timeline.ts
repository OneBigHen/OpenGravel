/**
 * Track → timestamped fixes.
 *
 * A track is ridden at its recorded speed with one raw fix per sample interval,
 * exactly as a 1 Hz GPS watch would deliver them. Scenario shaping happens here,
 * never in `src/`: a missed turn follows the incoming bearing instead of the
 * route, a no-GPS window simply omits fixes while the timer keeps running, and a
 * stop emits stationary fixes for the requested duration.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import type { RideSimRoute, RideSimTrack } from "./fixtures";
import type { ReplayFix } from "./replay-position-source";

const METERS_PER_DEGREE = 111_320;

export type RideSimScenario = "clean" | "noise" | "missed-turn" | "no-gps" | "stop";

export interface BuiltTimeline {
  readonly fixes: readonly ReplayFix[];
  /** The line the rider follows; differs from the route on a missed turn. */
  readonly path: readonly Coordinate[];
  readonly totalMeters: number;
  /** Route distance of the turn the missed-turn scenario ignores, when relevant. */
  readonly missedTurnAtMeters: number | null;
}

function bearingBetween(from: Coordinate, to: Coordinate): number {
  const startLatitude = (from.lat * Math.PI) / 180;
  const finishLatitude = (to.lat * Math.PI) / 180;
  const longitudeDelta = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(longitudeDelta) * Math.cos(finishLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(finishLatitude) -
    Math.sin(startLatitude) * Math.cos(finishLatitude) * Math.cos(longitudeDelta);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destination(from: Coordinate, bearingDegrees: number, meters: number): Coordinate {
  const radians = (bearingDegrees * Math.PI) / 180;
  const latitude = (from.lat * Math.PI) / 180;
  return {
    lat: from.lat + (Math.cos(radians) * meters) / METERS_PER_DEGREE,
    lon:
      from.lon +
      (Math.sin(radians) * meters) / (METERS_PER_DEGREE * Math.cos(latitude)),
  };
}

function cumulativeDistances(geometry: readonly Coordinate[]): readonly number[] {
  const cumulative = [0];
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const start = geometry[index];
    const finish = geometry[index + 1];
    if (start === undefined || finish === undefined) continue;
    cumulative.push((cumulative.at(-1) ?? 0) + haversine(start, finish));
  }
  return cumulative;
}

function pointAt(
  geometry: readonly Coordinate[],
  cumulative: readonly number[],
  distance: number,
): { readonly coordinate: Coordinate; readonly headingDegrees: number } {
  if (geometry.length < 2) throw new Error("a replay path needs at least two points");
  const total = cumulative.at(-1) ?? 0;
  const target = Math.max(0, Math.min(total, distance));
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const finish = geometry[index];
    const startDistance = cumulative[index - 1];
    const finishDistance = cumulative[index];
    if (
      start === undefined ||
      finish === undefined ||
      startDistance === undefined ||
      finishDistance === undefined
    ) {
      continue;
    }
    const length = finishDistance - startDistance;
    if (length <= 0) continue;
    if (target <= finishDistance || index === geometry.length - 1) {
      const fraction = Math.max(0, Math.min(1, (target - startDistance) / length));
      return {
        coordinate: {
          lon: start.lon + (finish.lon - start.lon) * fraction,
          lat: start.lat + (finish.lat - start.lat) * fraction,
        },
        headingDegrees: bearingBetween(start, finish),
      };
    }
  }
  const last = geometry[geometry.length - 1];
  const previous = geometry[geometry.length - 2];
  if (last === undefined || previous === undefined) {
    throw new Error("a replay path needs at least two points");
  }
  return { coordinate: { ...last }, headingDegrees: bearingBetween(previous, last) };
}

function isoAt(startMs: number, offsetMs: number): string {
  return new Date(startMs + offsetMs).toISOString();
}

/**
 * Builds the timestamped fixes for one scenario.
 *
 * `startMs` is the simulated ride start; the replay clock and every `observedAt`
 * derive from it, so two runs of the same scenario are identical.
 */
export function buildTimeline(
  track: RideSimTrack,
  route: RideSimRoute,
  scenario: RideSimScenario,
  startMs: number,
): BuiltTimeline {
  let path: readonly Coordinate[] = route.geometry;
  const routeCumulative = cumulativeDistances(route.geometry);
  const routeTotal = routeCumulative.at(-1) ?? 0;
  let missedTurnAtMeters: number | null = null;

  if (scenario === "missed-turn") {
    const vertex = track.scenarios.missedTurn.instructionIndex;
    if (
      !Number.isSafeInteger(vertex) ||
      vertex <= 0 ||
      vertex >= route.geometry.length - 1
    ) {
      throw new Error(`${track.id}: missed-turn instructionIndex is not an interior vertex`);
    }
    const approach = route.geometry[vertex];
    const before = route.geometry[vertex - 1];
    if (approach === undefined || before === undefined) {
      throw new Error(`${track.id}: missed-turn vertex has no approach geometry`);
    }
    const escape = destination(
      approach,
      bearingBetween(before, approach),
      track.scenarios.missedTurn.escapeMeters,
    );
    path = [...route.geometry.slice(0, vertex + 1), escape];
    missedTurnAtMeters = routeCumulative[vertex] ?? null;
  }

  const cumulative = cumulativeDistances(path);
  const totalMeters = cumulative.at(-1) ?? routeTotal;
  const intervalSeconds = track.sampleIntervalMs / 1_000;
  const stepMeters = track.speedMps * intervalSeconds;
  const stopAt = Math.max(0, Math.min(totalMeters - stepMeters, track.scenarios.stop.startMeters));

  const fixes: ReplayFix[] = [];
  let distance = 0;
  let elapsedMs = 0;
  let stopped = false;

  const push = (atDistance: number, atElapsedMs: number, speedMps: number): void => {
    const point = pointAt(path, cumulative, atDistance);
    fixes.push({
      coordinate: point.coordinate,
      observedAt: isoAt(startMs, atElapsedMs),
      atMs: startMs + atElapsedMs,
      intendedDistanceMeters: atDistance,
      accuracyMeters: 8,
      headingDegrees: point.headingDegrees,
      speedMps,
    });
  };

  while (true) {
    push(distance, elapsedMs, track.speedMps);
    if (distance >= totalMeters) break;
    if (scenario === "stop" && !stopped && distance >= stopAt) {
      stopped = true;
      const stationarySamples = Math.round(
        track.scenarios.stop.durationSeconds / intervalSeconds,
      );
      for (let sample = 1; sample <= stationarySamples; sample += 1) {
        push(distance, elapsedMs + sample * track.sampleIntervalMs, 0);
      }
      elapsedMs += stationarySamples * track.sampleIntervalMs;
    }
    elapsedMs += track.sampleIntervalMs;
    distance = Math.min(totalMeters, distance + stepMeters);
  }

  if (scenario !== "no-gps") {
    return { fixes, path, totalMeters, missedTurnAtMeters };
  }

  const gapStart = track.scenarios.noGps.startMeters;
  const gapEnd =
    gapStart + track.speedMps * track.scenarios.noGps.durationSeconds;
  const withGap = fixes.filter(
    (fix) => fix.intendedDistanceMeters < gapStart || fix.intendedDistanceMeters >= gapEnd,
  );
  if (withGap.length === fixes.length) {
    throw new Error(`${track.id}: the no-GPS window removed no fixes`);
  }
  return { fixes: withGap, path, totalMeters, missedTurnAtMeters };
}
