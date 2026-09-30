/**
 * Deterministic route-coherence diagnostics.
 *
 * "Curvy" and "good to ride" are not synonyms. A route can manufacture a high
 * bend/turn count by leaving a good road for tiny side-street doglegs, repeated
 * junctions, reversals, backtracking, or repeated corridor overlap.
 *
 * This deliberately restores two useful SwitchBack measurements that did not
 * survive the VNext split: immediate backtracking share and self-overlap share.
 * SwitchBack used 15% / 20% as hard gates. OpenGravel records those thresholds
 * as shadow flags first so the new PA/NJ replay corpus can establish false
 * positives before canonical policy starts rejecting routes.
 *
 * The output is diagnostic evidence only. It is intentionally not a new route
 * score and does not change canonical RoutePolicy.
 */

import {
  haversine,
  simplifyGeometry,
} from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

const MIN_GEOMETRY_SEGMENT_METERS = 35;
const REVERSAL_DEGREES = 150;
const SHORT_MANEUVER_LEG_METERS = 300;
const DOGLEG_PAIR_LEG_METERS = 400;
const MANEUVER_SPAM_PER_10_MILES = 14;
const MIN_ROUTE_METERS_FOR_DENSITY_FLAG = 4_000;
const METERS_PER_MILE = 1_609.344;

const BACKTRACK_LOOKBACK_METERS = 1_500;
const BACKTRACK_DEVIATION_DEGREES = 120;
const LEGACY_BACKTRACKING_FLAG_SHARE = 0.15;

const SELF_OVERLAP_SAMPLE_METERS = 150;
const SELF_OVERLAP_NEAR_METERS = 100;
const LEGACY_SELF_OVERLAP_FLAG_SHARE = 0.2;

export type RouteCoherenceFlag =
  | "explicit-uturn"
  | "geometry-reversal"
  | "maneuver-spam"
  | "alternating-short-turns"
  | "excessive-backtracking"
  | "excessive-self-overlap";

export interface RouteCoherenceMetrics {
  readonly routeMeters: number;
  readonly directMeters: number;
  /** Straight-line endpoint distance / traveled geometry distance, 0..1. */
  readonly endpointDirectness: number;

  /** Non-straight maneuver instructions supplied by the provider. */
  readonly maneuverCount: number;
  readonly maneuversPer10Miles: number;
  readonly explicitUTurnCount: number;
  /** Maneuvers whose following provider instruction leg is short. */
  readonly shortManeuverLegCount: number;
  /**
   * Left/right or right/left maneuver pairs separated by a short leg. This is a
   * useful detector for "turn off, travel a block, turn back" route shaping.
   */
  readonly alternatingShortTurnPairs: number;
  /** Named-road changes across successive maneuver instructions. */
  readonly roadNameChangeCount: number;

  /**
   * Large direction reversals measured from simplified route geometry.
   * Provider instructions are not required for this detector.
   */
  readonly geometryReversalCount: number;

  /**
   * Share of traveled geometry that heads substantially back toward the
   * direction the route was taking roughly 1.5 km earlier.
   */
  readonly backtrackingShare: number;

  /**
   * Share of ~150 m route samples that revisit a corridor within ~100 m of a
   * prior sample.
   */
  readonly selfOverlapShare: number;

  readonly flags: readonly RouteCoherenceFlag[];
}

function finiteCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180 &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90
  );
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every(finiteCoordinate);
}

function lineMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const from = line[index];
    const to = line[index + 1];
    if (from === undefined || to === undefined) continue;
    const meters = haversine(from, to);
    if (Number.isFinite(meters) && meters > 0) total += meters;
  }
  return total;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const firstLat = radians(from.lat);
  const secondLat = radians(to.lat);
  const longitudeDelta = radians(to.lon - from.lon);
  const y = Math.sin(longitudeDelta) * Math.cos(secondLat);
  const x =
    Math.cos(firstLat) * Math.sin(secondLat) -
    Math.sin(firstLat) *
      Math.cos(secondLat) *
      Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function signedTurnDegrees(first: number, second: number): number {
  let delta = second - first;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function geometryReversals(geometry: readonly Coordinate[]): number {
  const simplified = simplifyGeometry(geometry);
  let reversals = 0;

  for (let index = 1; index + 1 < simplified.length; index += 1) {
    const before = simplified[index - 1];
    const pivot = simplified[index];
    const after = simplified[index + 1];
    if (before === undefined || pivot === undefined || after === undefined) continue;

    const inboundMeters = haversine(before, pivot);
    const outboundMeters = haversine(pivot, after);
    if (
      inboundMeters < MIN_GEOMETRY_SEGMENT_METERS ||
      outboundMeters < MIN_GEOMETRY_SEGMENT_METERS
    ) {
      continue;
    }

    const turn = Math.abs(
      signedTurnDegrees(
        bearingDegrees(before, pivot),
        bearingDegrees(pivot, after),
      ),
    );
    if (turn >= REVERSAL_DEGREES) reversals += 1;
  }

  return reversals;
}

/**
 * Port of SwitchBack's immediate-backtracking detector
 * (src/lib/routing/route-geometry-quality.ts), using VNext Coordinate objects.
 */
export function routeBacktrackingShare(
  geometry: readonly Coordinate[],
): number {
  if (!validLine(geometry) || geometry.length < 5) return 0;

  const cumulative: number[] = [0];
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const from = geometry[index];
    const to = geometry[index + 1];
    if (from === undefined || to === undefined) continue;
    cumulative.push((cumulative[index] ?? 0) + haversine(from, to));
  }
  const total = cumulative.at(-1) ?? 0;
  if (!(total > 0)) return 0;

  let backtrackingMeters = 0;
  for (let index = 1; index + 1 < geometry.length; index += 1) {
    const current = geometry[index];
    const next = geometry[index + 1];
    if (current === undefined || next === undefined) continue;

    const traveledBefore = cumulative[index] ?? 0;
    const lookbackTarget = traveledBefore - BACKTRACK_LOOKBACK_METERS;
    let earlier = 0;
    while (
      earlier + 1 < cumulative.length &&
      (cumulative[earlier + 1] ?? Number.POSITIVE_INFINITY) <= lookbackTarget
    ) {
      earlier += 1;
    }
    if (earlier >= index) continue;

    const earlierFrom = geometry[earlier];
    const earlierTo = geometry[earlier + 1];
    if (earlierFrom === undefined || earlierTo === undefined) continue;

    const deviation = Math.abs(
      signedTurnDegrees(
        bearingDegrees(earlierFrom, earlierTo),
        bearingDegrees(current, next),
      ),
    );
    if (deviation > BACKTRACK_DEVIATION_DEGREES) {
      backtrackingMeters += haversine(current, next);
    }
  }

  return backtrackingMeters / total;
}

function sampleRoute(
  geometry: readonly Coordinate[],
  spacingMeters = SELF_OVERLAP_SAMPLE_METERS,
): readonly Coordinate[] {
  const first = geometry[0];
  const last = geometry.at(-1);
  if (first === undefined || last === undefined) return [];
  if (geometry.length < 2) return [first];

  const samples: Coordinate[] = [{ ...first }];
  let carry = 0;

  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const from = geometry[index];
    const to = geometry[index + 1];
    if (from === undefined || to === undefined) continue;

    const segmentMeters = haversine(from, to);
    if (!(segmentMeters > 0)) continue;

    let position = spacingMeters - carry;
    while (position < segmentMeters) {
      const share = position / segmentMeters;
      samples.push({
        lon: from.lon + (to.lon - from.lon) * share,
        lat: from.lat + (to.lat - from.lat) * share,
      });
      position += spacingMeters;
    }
    carry = Math.max(0, segmentMeters - (position - spacingMeters));
  }

  if (
    samples.at(-1)?.lon !== last.lon ||
    samples.at(-1)?.lat !== last.lat
  ) {
    samples.push({ ...last });
  }
  return samples;
}

/**
 * Port of SwitchBack's self-overlap detector. Crossings contribute only a small
 * number of samples; sustained return along the same corridor contributes many.
 */
export function routeSelfOverlapShare(
  geometry: readonly Coordinate[],
): number {
  if (!validLine(geometry) || geometry.length < 3) return 0;

  const samples = sampleRoute(geometry);
  if (samples.length <= 1) return 0;

  let overlapping = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const point = samples[index];
    if (point === undefined) continue;

    let nearPrior = false;
    for (let prior = 0; prior < index; prior += 1) {
      const earlier = samples[prior];
      if (
        earlier !== undefined &&
        haversine(earlier, point) < SELF_OVERLAP_NEAR_METERS
      ) {
        nearPrior = true;
        break;
      }
    }
    if (nearPrior) overlapping += 1;
  }

  return overlapping / (samples.length - 1);
}

type TurnSide = "left" | "right";

function turnSide(
  maneuver: RouteInstruction["maneuver"],
): TurnSide | null {
  if (maneuver === "left" || maneuver === "slight-left") return "left";
  if (maneuver === "right" || maneuver === "slight-right") return "right";
  return null;
}

function meaningfulInstructions(
  instructions: readonly RouteInstruction[],
): readonly RouteInstruction[] {
  return instructions.filter(
    (instruction) =>
      instruction.maneuver !== undefined &&
      instruction.maneuver !== "straight",
  );
}

function roadNameChanges(
  instructions: readonly RouteInstruction[],
): number {
  let previous: string | null = null;
  let changes = 0;

  for (const instruction of instructions) {
    const name = instruction.roadName?.trim();
    if (name === undefined || name.length === 0) continue;
    if (previous !== null && name !== previous) changes += 1;
    previous = name;
  }

  return changes;
}

function alternatingShortTurns(
  instructions: readonly RouteInstruction[],
): number {
  let pairs = 0;
  for (let index = 0; index + 1 < instructions.length; index += 1) {
    const first = instructions[index];
    const second = instructions[index + 1];
    if (first === undefined || second === undefined) continue;
    const firstSide = turnSide(first.maneuver);
    const secondSide = turnSide(second.maneuver);
    if (
      firstSide !== null &&
      secondSide !== null &&
      firstSide !== secondSide &&
      Number.isFinite(first.distanceMeters) &&
      first.distanceMeters <= DOGLEG_PAIR_LEG_METERS
    ) {
      pairs += 1;
    }
  }
  return pairs;
}

/**
 * Measures path coherence from returned geometry and provider instructions.
 *
 * Returns null for malformed route geometry. Missing instructions are valid:
 * geometry-derived diagnostics still work and instruction-derived counts stay
 * zero rather than becoming invented estimates.
 */
export function analyzeRouteCoherence(input: {
  readonly geometry: readonly Coordinate[];
  readonly instructions?: readonly RouteInstruction[];
}): RouteCoherenceMetrics | null {
  if (!validLine(input.geometry)) return null;

  const routeMeters = lineMeters(input.geometry);
  if (!(routeMeters > 0)) return null;

  const first = input.geometry[0]!;
  const last = input.geometry.at(-1)!;
  const directMeters = haversine(first, last);
  const endpointDirectness = Math.max(
    0,
    Math.min(1, directMeters / routeMeters),
  );

  const maneuvers = meaningfulInstructions(input.instructions ?? []);
  const maneuverCount = maneuvers.length;
  const routeMiles = routeMeters / METERS_PER_MILE;
  const maneuversPer10Miles =
    routeMiles > 0 ? (maneuverCount / routeMiles) * 10 : 0;
  const explicitUTurnCount = maneuvers.filter(
    (instruction) => instruction.maneuver === "uturn",
  ).length;
  const shortManeuverLegCount = maneuvers.filter(
    (instruction) =>
      Number.isFinite(instruction.distanceMeters) &&
      instruction.distanceMeters <= SHORT_MANEUVER_LEG_METERS,
  ).length;
  const alternatingShortTurnPairs = alternatingShortTurns(maneuvers);
  const geometryReversalCount = geometryReversals(input.geometry);
  const backtrackingShare = routeBacktrackingShare(input.geometry);
  const selfOverlapShare = routeSelfOverlapShare(input.geometry);

  const flags: RouteCoherenceFlag[] = [];
  if (explicitUTurnCount > 0) flags.push("explicit-uturn");
  if (geometryReversalCount > 0) flags.push("geometry-reversal");
  if (
    routeMeters >= MIN_ROUTE_METERS_FOR_DENSITY_FLAG &&
    maneuversPer10Miles > MANEUVER_SPAM_PER_10_MILES
  ) {
    flags.push("maneuver-spam");
  }
  if (alternatingShortTurnPairs >= 2) {
    flags.push("alternating-short-turns");
  }
  if (backtrackingShare > LEGACY_BACKTRACKING_FLAG_SHARE) {
    flags.push("excessive-backtracking");
  }
  if (selfOverlapShare > LEGACY_SELF_OVERLAP_FLAG_SHARE) {
    flags.push("excessive-self-overlap");
  }

  return {
    routeMeters,
    directMeters,
    endpointDirectness,
    maneuverCount,
    maneuversPer10Miles: Number(maneuversPer10Miles.toFixed(2)),
    explicitUTurnCount,
    shortManeuverLegCount,
    alternatingShortTurnPairs,
    roadNameChangeCount: roadNameChanges(maneuvers),
    geometryReversalCount,
    backtrackingShare: Number(backtrackingShare.toFixed(4)),
    selfOverlapShare: Number(selfOverlapShare.toFixed(4)),
    flags,
  };
}
