import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type { BreadcrumbNavigationWaypoint } from "@/application/persistence/ride-focus-pointer";
import { lineDistance } from "@/domain/breadcrumb/route";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";
import { newCommandId, type GeometryRef, type RideId } from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { Coordinate } from "@/domain/ride/types";

export async function saveBacktrack(input: { readonly rideId: RideId; readonly coordinates: readonly Coordinate[]; readonly rides: RideRepositoryPort; readonly geometry: GeometryStore; readonly now: string }): Promise<{ readonly revision: number; readonly geometryRef: GeometryRef; readonly line: readonly Coordinate[]; readonly waypoints: readonly BreadcrumbNavigationWaypoint[] }> {
  if (input.coordinates.length < 2) throw new Error("A recorded track needs at least two points.");
  const loaded = await input.rides.loadRide(input.rideId);
  if (loaded === null || !loaded.ok) throw new Error("The ride could not be opened.");
  const line = [...input.coordinates].reverse();
  const start = line[0]!;
  const end = line[line.length - 1]!;
  const route: BreadcrumbRoute = { waypoints: [{ id: `breadcrumb_${crypto.randomUUID()}`, coordinate: start, name: "Turn back" }, { id: `breadcrumb_${crypto.randomUUID()}`, coordinate: end, name: "Start" }], legs: [{ kind: "recorded", geometry: line }] };
  const document = loaded.document;
  const applied = applyRideCommand(document, { type: "breadcrumb.set", commandId: newCommandId(), rideId: document.rideId, baseRevision: document.revision, source: "map", label: "Back to start", breadcrumb: route }, { now: input.now });
  if (applied.outcome !== "applied") throw new Error("The return route could not be created.");
  const stored = await input.geometry.put({ kind: "line", coordinates: line }, { kind: "route", now: input.now });
  const saved = await input.rides.saveRide(applied.document, { writerToken: crypto.randomUUID(), baseRevision: document.revision });
  if (!saved.ok) throw new Error("The return route could not be saved.");
  return { revision: applied.document.revision, geometryRef: stored.geometryRef, line, waypoints: [{ coordinate: start, name: "Turn back", distanceAlongMeters: 0 }, { coordinate: end, name: "Start", distanceAlongMeters: lineDistance(line) }] };
}
