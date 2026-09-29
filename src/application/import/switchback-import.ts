import { applyRideCommand } from "@/domain/ride/reducer";
import { createRideDocument } from "@/domain/ride/create";
import type { RideCommandOp } from "@/domain/ride/commands";
import { newCommandId, newPointId, newShapingId } from "@/domain/ride/ids";
import type { RideDocument, RidePoint, ShapingPoint } from "@/domain/ride/types";
import type { ImportArtifact } from "./import-artifact";
import type { ParsedImport, ParsedImportTrack, ParsedImportWaypoint } from "./types";

const MAX_SHAPING_ANCHORS = 32;

function sameCoordinate(first: { readonly lon: number; readonly lat: number }, second: { readonly lon: number; readonly lat: number }): boolean {
  return first.lon === second.lon && first.lat === second.lat;
}

function labelAt(coordinate: ParsedImportTrack["segments"][number][number], waypoints: readonly ParsedImportWaypoint[]): string | undefined {
  const waypoint = waypoints.find((entry) => sameCoordinate(entry.coordinate, coordinate) && entry.name?.trim());
  const label = waypoint?.name?.trim().slice(0, 160);
  return label === undefined || label.length === 0 ? undefined : label;
}

function sampledInterior(
  geometry: readonly ParsedImportTrack["segments"][number][number][],
  maximum = MAX_SHAPING_ANCHORS,
): readonly ParsedImportTrack["segments"][number][number][] {
  const interior = geometry.slice(1, -1);
  const count = Math.min(interior.length, maximum);
  if (count === 0) return [];
  const points = Array.from({ length: count }, (_, index) => {
    const sourceIndex = count === 1
      ? Math.floor(interior.length / 2)
      : Math.round(index * (interior.length - 1) / (count - 1));
    return interior[sourceIndex]!;
  });
  return points.filter((point, index) =>
    !sameCoordinate(point, geometry[0]!) &&
    !sameCoordinate(point, geometry.at(-1)!) &&
    (index === 0 || !sameCoordinate(point, points[index - 1]!)),
  );
}

function nearestTrackIndex(
  coordinate: ParsedImportTrack["segments"][number][number],
  geometry: readonly ParsedImportTrack["segments"][number][number][],
): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, point] of geometry.entries()) {
    const distance = (point.lon - coordinate.lon) ** 2 + (point.lat - coordinate.lat) ** 2;
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function shapingCoordinates(
  geometry: readonly ParsedImportTrack["segments"][number][number][],
  waypoints: readonly ParsedImportWaypoint[],
): readonly ParsedImportTrack["segments"][number][number][] {
  const interiorWaypoints = waypoints.filter((waypoint) =>
    !sameCoordinate(waypoint.coordinate, geometry[0]!) &&
    !sameCoordinate(waypoint.coordinate, geometry.at(-1)!),
  );
  const selectedWaypoints = interiorWaypoints.slice(0, MAX_SHAPING_ANCHORS);
  const sampled = sampledInterior(geometry, MAX_SHAPING_ANCHORS - selectedWaypoints.length);
  const candidates = [
    ...selectedWaypoints.map((waypoint, order) => ({
      coordinate: waypoint.coordinate,
      position: nearestTrackIndex(waypoint.coordinate, geometry),
      order,
    })),
    ...sampled.map((coordinate, order) => ({
      coordinate,
      position: nearestTrackIndex(coordinate, geometry),
      order: selectedWaypoints.length + order,
    })),
  ];
  const unique = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) {
    const key = `${candidate.coordinate.lon},${candidate.coordinate.lat}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()]
    .sort((first, second) => first.position - second.position || first.order - second.order)
    .map((candidate) => candidate.coordinate);
}

/**
 * Project one SwitchBack GPX track into VNext's authored ride authority.
 * Source bytes, dense line, timestamps and waypoints stay in the import envelope;
 * only bounded corridor anchors become authored ride intent.
 */
export function switchBackTrackToRideDocument(
  artifact: ImportArtifact,
  track: ParsedImportTrack,
  waypoints: readonly ParsedImportWaypoint[],
  options: { readonly title?: string | null; readonly now?: string } = {},
): RideDocument {
  const geometry = track.segments[0];
  if (track.sourceKind !== "track" || track.segments.length !== 1 || geometry === undefined || geometry.length < 2) {
    throw new Error("SwitchBack imports need one dense GPX track segment with at least two points.");
  }
  const now = options.now ?? artifact.importedAt;
  const document = createRideDocument({
    now,
    title: options.title ?? track.name,
    provenance: { type: "import", sourceId: artifact.artifactId, source: "SwitchBack" },
  });
  const provenance = { type: "import" as const, sourceId: artifact.artifactId };
  const startLabel = labelAt(geometry[0]!, waypoints);
  const finishLabel = labelAt(geometry.at(-1)!, waypoints);
  const start: RidePoint = {
    id: newPointId(),
    kind: "start",
    coordinate: geometry[0]!,
    ...(startLabel === undefined ? {} : { label: startLabel }),
    provenance,
  };
  const finish: RidePoint = {
    id: newPointId(),
    kind: "finish",
    coordinate: geometry.at(-1)!,
    ...(finishLabel === undefined ? {} : { label: finishLabel }),
    provenance,
  };
  const shaping: readonly ShapingPoint[] = shapingCoordinates(geometry, waypoints).map((coordinate) => ({
    id: newShapingId(),
    kind: "shape",
    coordinate,
    source: "import",
  }));
  const operations: RideCommandOp[] = [
    {
      type: "start.set", commandId: newCommandId(), rideId: document.rideId,
      baseRevision: document.revision, source: "import", label: "Import SwitchBack ride", point: start,
    },
    {
      type: "finish.set", commandId: newCommandId(), rideId: document.rideId,
      baseRevision: document.revision, source: "import", label: "Import SwitchBack ride", point: finish,
    },
    ...shaping.map((point): RideCommandOp => ({
      type: "shape.insert", commandId: newCommandId(), rideId: document.rideId,
      baseRevision: document.revision, source: "import", label: "Import SwitchBack ride", point,
    })),
  ];
  const result = applyRideCommand(document, {
    type: "proposal.apply",
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "import",
    label: "Import SwitchBack ride",
    proposalId: artifact.artifactId,
    operations,
  }, { now });
  if (result.outcome !== "applied") {
    throw new Error(result.outcome === "invalid" ? result.message : "The imported ride changed before it could be created.");
  }
  return result.document;
}

/** Human-readable gaps between the GPX export and SwitchBack's saved intent. */
export function switchBackImportReport(parsed: ParsedImport): readonly string[] {
  const warnings = [
    "GPX does not carry SwitchBack avoid areas, road style, bike profile, surface/traffic/highway/toll preferences, departure or loop-time settings, structured route evidence/directions, or library notes/folder/tags/visibility. These were not imported.",
    `The VNext ride uses endpoints and up to ${MAX_SHAPING_ANCHORS} shaping anchors. The exact SwitchBack track remains in saved import data; a new VNext plan can follow different roads.`,
  ];
  if ((parsed.waypoints?.length ?? 0) > 0) {
    warnings.push("The GPX does not encode stop-versus-shaping semantics for named waypoints. Their names and coordinates remain in the saved import data and original file; review the itinerary for stops.");
  } else {
    warnings.push("The GPX does not encode stop-versus-shaping semantics and has no standalone waypoints; no stops were inferred from track geometry.");
  }
  if (parsed.sourceDescription !== undefined) {
    warnings.push(`SwitchBack's human-readable route/profile description was retained with the original file: ${parsed.sourceDescription}`);
  }
  if (parsed.tracks[0]?.sourceType?.toLowerCase().includes("recorded ride") === true) {
    warnings.push("This GPX is a recorded ride. M10 imported its exported points as route geometry; the RideSession, ride-journal notes/photo metadata, and GPS-quality details are not restored.");
  }
  const geometry = parsed.tracks[0]?.segments[0] ?? [];
  const interiorWaypointCount = (parsed.waypoints ?? []).filter((waypoint) =>
    !sameCoordinate(waypoint.coordinate, geometry[0]!) &&
    !sameCoordinate(waypoint.coordinate, geometry.at(-1)!),
  ).length;
  if (interiorWaypointCount > MAX_SHAPING_ANCHORS) {
    warnings.push(`The route uses at most ${MAX_SHAPING_ANCHORS} shaping anchors. ${interiorWaypointCount - MAX_SHAPING_ANCHORS} additional interior GPX waypoints remain in saved import data but are not sent to routing.`);
  }
  return warnings;
}
