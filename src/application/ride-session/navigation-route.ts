/** Provider-instruction → RideSession guidance normalization (08 §6). */

import type { ProviderInstruction } from "@/application/planner/route-provider";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { asSessionInstructionId } from "@/domain/ride-session/ids";
import type { RouteManeuver } from "@/domain/ride-session/progress";
import type { SessionRouteBinding } from "@/domain/ride-session/types";
import type { ResolvedNavigationRoute } from "./navigation-engine";

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

function normalizedManeuver(
  instruction: ProviderInstruction,
  instructionId: ReturnType<typeof asSessionInstructionId>,
  atDistanceMeters: number,
): RouteManeuver | null {
  if (instruction.type === "continue") {
    return {
      instructionId,
      kind: "continue",
      maneuver: null,
      roadName: instruction.roadName ?? null,
      targetStopId: null,
      atDistanceMeters,
    };
  }
  if (instruction.type === "finish") {
    return {
      instructionId,
      kind: "arrive",
      maneuver: null,
      roadName: instruction.roadName ?? null,
      targetStopId: null,
      atDistanceMeters,
    };
  }
  if (instruction.maneuver === undefined || instruction.maneuver === "straight") {
    return null;
  }
  return {
    instructionId,
    kind: "turn",
    maneuver: instruction.maneuver,
    roadName: instruction.roadName ?? null,
    targetStopId: null,
    atDistanceMeters,
  };
}

/**
 * Builds a guidance route from provider facts. Opaque/unsupported instruction
 * kinds are omitted instead of being inferred from provider-authored prose.
 */
export function buildGuidedNavigationRoute(
  binding: SessionRouteBinding,
  geometry: readonly Coordinate[],
  instructions: readonly ProviderInstruction[],
): ResolvedNavigationRoute {
  const cumulative = cumulativeDistances(geometry);
  const maneuvers: RouteManeuver[] = [];
  let instructionDistance = 0;
  instructions.forEach((instruction, index) => {
    const indexedDistance =
      instruction.geometryIndex === undefined
        ? undefined
        : cumulative[Math.max(0, Math.min(cumulative.length - 1, instruction.geometryIndex))];
    const atDistanceMeters = indexedDistance ?? instructionDistance;
    const instructionId = asSessionInstructionId(
      `instr_${binding.routeId}_${index}`,
    );
    const maneuver = normalizedManeuver(
      instruction,
      instructionId,
      atDistanceMeters,
    );
    if (maneuver !== null) maneuvers.push(maneuver);
    instructionDistance += Math.max(0, instruction.distanceMeters);
  });
  return {
    mode: "guided",
    binding,
    geometry: geometry.map((coordinate) => ({ ...coordinate })),
    maneuvers,
  };
}
