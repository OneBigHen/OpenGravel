/**
 * Deterministic route-coherence diagnostics.
 *
 * "Curvy" and "good to ride" are not synonyms. A route can manufacture a high
 * bend/turn count by leaving a good road for tiny side-street doglegs, repeated
 * junctions, or reversals. This module measures those pathologies separately
 * from ride quality so routing experiments can reject bad geometry without
 * pretending a geometry heuristic proves road quality, access, or safety.
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

export type RouteCoherenceFlag =
  | "explicit-uturn"
  | "geometry-reversal"
  | "maneuver-spam"
  | "alternating-short-turns";

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
 * geometry reversal diagnostics still work and instruction-derived counts stay
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
    flags,
  };
}
