/**
 * Opening an imported GPX as a breadcrumb route.
 *
 * Some GPX files are not a line at all: a cue sheet is a list of `<wpt>`s, a
 * planner export is an `<rte>` of `<rtept>`s, and a recorded track is a dense
 * line nobody can edit by hand. All three can become a breadcrumb route, where
 * every point is a waypoint the rider can see, drag and follow, and every leg is
 * a straight line the rider can then choose to snap to a road or trail.
 *
 * The source is preserved: the ride keeps the original file and, when the
 * candidate came from a track, that track's geometry too. Thinning only decides
 * which vertices become waypoints ({@link MAX_BREADCRUMB_WAYPOINTS}); it never
 * claims the straight legs follow anything.
 */

import { straightBreadcrumb } from "@/domain/breadcrumb/route";
import { breadcrumbKeepIndices, MAX_BREADCRUMB_WAYPOINTS } from "@/domain/breadcrumb/thin";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";
import { createRideDocument } from "@/domain/ride/create";
import { newCommandId } from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { ImportArtifact } from "./import-artifact";
import type { ParsedImport, ParsedImportTrack } from "./types";

/** Where a breadcrumb candidate's points came from. */
export type ImportBreadcrumbSource = "waypoints" | "route" | "track";

/**
 * One source in the file that can become a breadcrumb, already thinned.
 *
 * `coordinates` and `route` are aligned: `route.waypoints[i]` is
 * `coordinates[i]` and carries that point's source name when the file had one.
 * `thinned` says the source line had more points than the waypoint budget, so
 * the rider is told what was dropped rather than shown a route that looks
 * denser than it is.
 */
export interface ImportBreadcrumbCandidate {
  readonly id: string;
  readonly source: ImportBreadcrumbSource;
  /** Index into `ParsedImport.tracks`; `null` for the file's `<wpt>` list. */
  readonly trackIndex: number | null;
  /** The source's own name, or `""` when only the file name is available. */
  readonly name: string;
  readonly coordinates: readonly Coordinate[];
  /** Points in the source line, before thinning. */
  readonly sourcePointCount: number;
  readonly waypointCount: number;
  readonly thinned: boolean;
  /** How many source segments the candidate spans; more than one has gaps. */
  readonly segmentCount: number;
  readonly route: BreadcrumbRoute;
}

export interface ImportBreadcrumbCandidateOptions {
  readonly maxWaypoints?: number;
}

function breadcrumbWaypointId(candidateId: string, index: number): string {
  const safe = candidateId.replaceAll(/[^a-z0-9]+/gi, "_");
  return `breadcrumb_import_${safe}_${index}`;
}

function candidate(
  id: string,
  source: ImportBreadcrumbSource,
  trackIndex: number | null,
  name: string,
  coordinates: readonly Coordinate[],
  labels: readonly (string | null)[],
  segmentCount: number,
  maxWaypoints: number,
): ImportBreadcrumbCandidate | null {
  const kept = breadcrumbKeepIndices(coordinates, maxWaypoints);
  if (kept.length < 2) return null;
  const waypoints = kept.map((index, waypointIndex) => {
    const coordinate = coordinates[index] as Coordinate;
    const label = labels[index] ?? null;
    return {
      id: breadcrumbWaypointId(id, waypointIndex),
      coordinate: { lon: coordinate.lon, lat: coordinate.lat },
      ...(label === null || label.trim() === "" ? {} : { name: label.trim() }),
    };
  });
  return {
    id,
    source,
    trackIndex,
    name,
    coordinates: waypoints.map((waypoint) => waypoint.coordinate),
    sourcePointCount: coordinates.length,
    waypointCount: waypoints.length,
    thinned: waypoints.length < coordinates.length,
    segmentCount,
    route: straightBreadcrumb(waypoints),
  };
}

function trackLabels(track: ParsedImportTrack): (string | null)[] {
  return track.segments.map((segment, index) => {
    const names = track.pointNames?.[index];
    return segment.map((_coordinate, pointIndex) => names?.[pointIndex] ?? null);
  }).flat();
}

function trackCoordinates(track: ParsedImportTrack): Coordinate[] {
  return track.segments.flatMap((segment) => segment.map((coordinate) => ({ lon: coordinate.lon, lat: coordinate.lat })));
}

/**
 * Every way this file can become a breadcrumb, best first.
 *
 * The file's own `<wpt>` list comes first: a cue-sheet export is exactly the
 * rider's authored points, so it needs no thinning and keeps its names. Each
 * `<rte>` follows, then each track, both thinned to the waypoint budget. A file
 * with no two usable points has no candidates at all.
 */
export function importBreadcrumbCandidates(
  parsed: ParsedImport,
  options: ImportBreadcrumbCandidateOptions = {},
): readonly ImportBreadcrumbCandidate[] {
  const maxWaypoints = Math.max(2, Math.trunc(options.maxWaypoints ?? MAX_BREADCRUMB_WAYPOINTS));
  const candidates: ImportBreadcrumbCandidate[] = [];
  const waypoints = parsed.waypoints ?? [];
  const fileWaypoints = candidate(
    "waypoints",
    "waypoints",
    null,
    "",
    waypoints.map((waypoint) => waypoint.coordinate),
    waypoints.map((waypoint) => waypoint.name),
    1,
    maxWaypoints,
  );
  if (fileWaypoints !== null) candidates.push(fileWaypoints);
  parsed.tracks.forEach((track, index) => {
    const source: ImportBreadcrumbSource = track.sourceKind === "route" ? "route" : "track";
    const built = candidate(
      `track_${index}`,
      source,
      index,
      track.name,
      trackCoordinates(track),
      trackLabels(track),
      track.segments.length,
      maxWaypoints,
    );
    if (built !== null) candidates.push(built);
  });
  return candidates;
}

/** The candidate a caller asked for by id, or the first one the file offers. */
export function pickImportBreadcrumbCandidate(
  candidates: readonly ImportBreadcrumbCandidate[],
  candidateId?: string,
): ImportBreadcrumbCandidate | null {
  if (candidateId !== undefined) return candidates.find((value) => value.id === candidateId) ?? null;
  return candidates[0] ?? null;
}

export interface ImportBreadcrumbDocumentOptions {
  readonly now?: string;
  readonly title?: string | null;
}

function breadcrumbTitle(
  artifact: ImportArtifact,
  candidate: ImportBreadcrumbCandidate,
  title: string | null | undefined,
): string {
  const requested = title?.trim() ?? "";
  if (requested !== "") return requested;
  const named = candidate.name.trim();
  if (named !== "") return named;
  const fromFile = artifact.filename.replace(/\.(?:gpx|kml|kmz)$/i, "").trim();
  return fromFile === "" ? "Imported breadcrumb" : fromFile;
}

/**
 * The ride document for one candidate: its points as a breadcrumb route.
 *
 * The route is committed through the ordinary `breadcrumb.set` command, so an
 * imported breadcrumb is authored state exactly like one tapped on the map and
 * the rider can undo, edit or snap it. Nothing about access, closure or surface
 * is claimed by the import.
 */
export function importBreadcrumbDocument(
  artifact: ImportArtifact,
  candidate: ImportBreadcrumbCandidate,
  options: ImportBreadcrumbDocumentOptions = {},
): RideDocument {
  const now = options.now ?? artifact.importedAt;
  const base = createRideDocument({
    now,
    title: breadcrumbTitle(artifact, candidate, options.title),
    provenance: { type: "import", sourceId: artifact.artifactId },
  });
  const applied = applyRideCommand(
    base,
    {
      type: "breadcrumb.set",
      commandId: newCommandId(),
      rideId: base.rideId,
      baseRevision: base.revision,
      source: "import",
      label: "Opened imported points as a breadcrumb",
      breadcrumb: candidate.route,
    },
    { now },
  );
  if (applied.outcome !== "applied") {
    throw new Error(
      applied.outcome === "invalid"
        ? `The imported points cannot become a breadcrumb route: ${applied.message}`
        : "The imported breadcrumb route could not be created.",
    );
  }
  return applied.document;
}
