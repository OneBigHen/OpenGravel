import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { GeometryPayload } from "@/domain/geometry/types";
import { buildCorridorPackManifest } from "@/domain/offline/capabilities";
import type { RideDocument } from "@/domain/ride/types";
import type { ShareSummary } from "@/domain/sharing/types";

export interface SelectedOfflineRoute {
  readonly routeKey: string;
  readonly rideId: string;
  readonly routeRevision: number;
  readonly geometry: readonly { readonly lon: number; readonly lat: number }[];
  /** Aggregate ride facts for the share snapshot (§12) — no identifying data. */
  readonly summary: ShareSummary;
  readonly pack: ReturnType<typeof buildCorridorPackManifest>;
  readonly instructionsAvailable: boolean;
}

/**
 * Projects the currently selected committed/last-good route into the bounded
 * preparation/offline shape consumed by the planner.
 *
 * This is application derivation, not React state: missing bundle, selection or
 * geometry stays missing rather than being fabricated by the UI.
 */
export function selectedOfflineRoute(
  document: RideDocument,
  session: PlanningSessionSnapshot,
  geometry: Readonly<Record<string, GeometryPayload>>,
): SelectedOfflineRoute | null {
  const bundle = session.committedBundle ?? session.lastGoodBundle;
  if (bundle === null) return null;

  const candidate = bundle.candidates.find(
    (entry) => entry.id === bundle.selectedRouteId,
  );
  if (candidate === undefined) return null;

  const payload = geometry[candidate.geometryRef];
  if (
    payload === undefined ||
    payload.kind !== "line" ||
    payload.coordinates.length < 2
  ) {
    return null;
  }

  const pack = buildCorridorPackManifest({
    rideId: document.rideId,
    routeRevision: document.revision,
    geometry: payload.coordinates,
    createdAt: new Date().toISOString(),
    dataRefs: [
      `route-geometry:${candidate.geometryRef}`,
      ...(candidate.instructionsRef === undefined
        ? []
        : [`instructions:${candidate.instructionsRef}`]),
      `graph:${bundle.graphVersion}`,
    ],
  });

  return {
    routeKey: candidate.id,
    rideId: document.rideId,
    routeRevision: document.revision,
    geometry: payload.coordinates,
    summary: {
      distanceMeters: candidate.distanceMeters,
      durationSeconds: candidate.durationSeconds,
    } satisfies ShareSummary,
    pack,
    instructionsAvailable: candidate.instructionsRef !== undefined,
  };
}
