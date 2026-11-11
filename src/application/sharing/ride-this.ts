import type { GeometryStore } from "@/application/geometry/geometry-store";
import {
  PREPARED_ROUTE_STORAGE_KEY,
  type PreparedRoute,
  type PreparedRouteStorage,
} from "@/application/explore/ride-this";
import { routeAlongShapingPoints } from "@/application/import/import-artifact";
import type { LibraryServicePort } from "@/application/library/library-service";
import { createRideDocument } from "@/domain/ride/create";
import { newPointId, type RideId } from "@/domain/ride/ids";
import type {
  Coordinate,
  RideDocument,
  RidePoint,
} from "@/domain/ride/types";
import type { ShareSnapshot } from "@/domain/sharing/types";
import { deepFreeze } from "@/domain/util/freeze";

/**
 * "Ride this" on a public share page.
 *
 * The page's promise is the Explore one: the exact line the rider is looking at
 * opens in the planner, ready to start, instead of being planned again into a
 * different answer. So the same handoff is used: a derivative ride document
 * becomes the active draft, the shared line goes into the GeometryStore, and a
 * prepared-route note tells the planner that this line is the ride's answer.
 *
 * The shared snapshot is treated as the source. Its line is copied verbatim
 * (privacy trims included), its distance is the shared distance, and its ride
 * time is used when it was shared. When the link carried no time, the planner
 * needs one to show a route card, so the same 28 mph / 15-minute estimate the
 * Explore route page prints is used — never a claim from the route.
 */

/** Mirror of the route page's estimate so a shared ride and an Explore ride agree. */
const ESTIMATE_MPH = 28;
const ESTIMATE_STEP_MINUTES = 15;

export interface SharedRideDeps {
  readonly library: Pick<LibraryServicePort, "createDerivative">;
  readonly geometryStore: Pick<GeometryStore, "put">;
  readonly storage: PreparedRouteStorage;
  readonly now?: () => string;
}

export interface OpenedSharedRide {
  readonly rideId: RideId;
  readonly prepared: boolean;
}

function copyCoordinate(point: Coordinate): Coordinate {
  return { lon: point.lon, lat: point.lat };
}

/** The exact shared line, segments in their published order. */
export function sharedRideLine(snapshot: ShareSnapshot): readonly Coordinate[] {
  return snapshot.route.segments.flatMap((segment) => segment.map(copyCoordinate));
}

function endpoint(kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return {
    id: newPointId(),
    kind,
    coordinate: copyCoordinate(coordinate),
    provenance: { type: "derived", reason: "Shared ride endpoint" },
  };
}

/** The private planner document a share page opens, with the shared intent. */
export function sharedRideDocument(
  snapshot: ShareSnapshot,
  sourceId: string,
  now: string,
): RideDocument {
  const line = sharedRideLine(snapshot);
  const first = line[0];
  const last = line.at(-1);
  if (line.length < 2 || first === undefined || last === undefined) {
    throw new Error("This share has no route to open.");
  }
  const base = createRideDocument({
    now,
    title: snapshot.title,
    provenance: { type: "shared", sourceId },
  });
  const intent = deepFreeze({
    ...base.intent,
    surface: {
      preference: snapshot.surface.preference,
      unknownSurfacePolicy: snapshot.surface.unknownSurfacePolicy,
    },
    start: endpoint("start", first),
    finish: endpoint("finish", last),
    shaping: routeAlongShapingPoints(line),
  });
  return deepFreeze({
    ...base,
    intent,
    history: { ...base.history, baseIntent: intent },
  });
}

/** The distance and time the planner should show for the shared line. */
export function sharedRideNumbers(
  snapshot: ShareSnapshot,
): { readonly distanceMeters: number; readonly durationSeconds: number } | null {
  if (!Number.isFinite(snapshot.distanceMeters) || snapshot.distanceMeters <= 0) return null;
  const shared = snapshot.rideDurationSeconds;
  if (shared !== null && Number.isFinite(shared) && shared > 0) {
    return { distanceMeters: snapshot.distanceMeters, durationSeconds: shared };
  }
  const minutes = Math.max(
    ESTIMATE_STEP_MINUTES,
    Math.round(
      (snapshot.distanceMeters / 1609.344 / ESTIMATE_MPH) * 60 / ESTIMATE_STEP_MINUTES,
    ) * ESTIMATE_STEP_MINUTES,
  );
  return { distanceMeters: snapshot.distanceMeters, durationSeconds: minutes * 60 };
}

/**
 * Open the shared ride in the planner. Throws when there is no line to open;
 * the page's button reports that in words rather than navigating nowhere.
 */
export async function openSharedRide(
  snapshot: ShareSnapshot,
  sourceId: string,
  deps: SharedRideDeps,
): Promise<OpenedSharedRide> {
  const now = deps.now ?? ((): string => new Date().toISOString());
  const preparedAt = now();
  const document = sharedRideDocument(snapshot, sourceId, preparedAt);
  const opened = await deps.library.createDerivative("shared", sourceId, document, {
    title: snapshot.title,
  });
  const numbers = sharedRideNumbers(snapshot);
  if (numbers === null) throw new Error("This share has no distance to open.");
  const record = await deps.geometryStore.put(
    { kind: "line", coordinates: sharedRideLine(snapshot) },
    { kind: "route", now: preparedAt },
  );
  const prepared: PreparedRoute = {
    version: 1,
    rideId: opened.rideId,
    rideRevision: opened.revision,
    geometryRef: record.geometryRef,
    ...numbers,
    preparedAt,
  };
  deps.storage.setItem(PREPARED_ROUTE_STORAGE_KEY, JSON.stringify(prepared));
  return { rideId: opened.rideId, prepared: true };
}
