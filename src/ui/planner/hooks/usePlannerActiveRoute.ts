"use client";

/**
 * The route the planner is currently showing, resolved from the session's own
 * geometry cache (04-PLANNER-AND-WORKSPACE-UX §11, §15, §28).
 *
 * Two surfaces read it and must read the *same* answer:
 *
 * - the map's span draft, which indexes into the line it draws, and
 * - the itinerary, whose rows state each leg measured on that line.
 *
 * Extracted from the composition root so the resolution has one owner. It is a
 * projection: it reads the session and the geometry cache and returns nothing it
 * did not find. A missing line stays missing, which is what lets a row say its
 * distance is not known instead of measuring a line nobody drew.
 */

import { useMemo } from "react";

import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteCandidate } from "@/domain/route/types";

export interface PlannerActiveRoute {
  readonly routeId: RouteCandidate["id"];
  /** The line in travel order; `undefined` when the payload is not a line. */
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly instructions: RouteCandidate["instructions"];
  /** The ride revision this line answers, so a stale answer can say so. */
  readonly rideRevision: number;
}

export interface PlannerActiveRouteState {
  /** The drawn candidate's line, or `null` when nothing is on the map. */
  readonly activeRoute: PlannerActiveRoute | null;
  /** The selected candidate itself, whose `geometryRef` the handoff needs. */
  readonly selectedCandidate: RouteCandidate | null;
}

export function usePlannerActiveRoute(input: {
  readonly session: PlanningSessionSnapshot;
  readonly geometry: Readonly<Record<string, GeometryPayload>>;
}): PlannerActiveRouteState {
  const { session, geometry } = input;
  const bundle = session.committedBundle ?? session.lastGoodBundle;
  const selectedCandidate = useMemo(
    () =>
      bundle === null
        ? null
        : bundle.candidates.find((entry) => entry.id === bundle.selectedRouteId) ?? null,
    [bundle],
  );
  const activeRoute = useMemo((): PlannerActiveRoute | null => {
    if (bundle === null || selectedCandidate === null) return null;
    const payload = geometry[selectedCandidate.geometryRef];
    if (payload === undefined || payload.kind !== "line") return null;
    return {
      routeId: selectedCandidate.id,
      geometry: payload.coordinates,
      distanceMeters: selectedCandidate.distanceMeters,
      durationSeconds: selectedCandidate.durationSeconds,
      instructions: selectedCandidate.instructions,
      rideRevision: bundle.rideRevision,
    };
  }, [bundle, geometry, selectedCandidate]);
  return { activeRoute, selectedCandidate };
}
