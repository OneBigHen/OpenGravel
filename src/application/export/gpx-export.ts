import type { Coordinate } from "@/domain/ride/types";

/**
 * Two planned-ride files, because devices differ (garage-5, garage-6):
 *
 * - `planned-track` carries the whole line as `<trk>` plus `<wpt>` for the
 *   start, stops and finish. Garmin, Calimoto, Kurviger and REVER show it as
 *   the drawn ride.
 * - `planned-route` carries only `<rte>`: named endpoints and stops plus a
 *   bounded set of shaping points. Devices that recalculate their own line
 *   want exactly this, and a few hundred route points is all they accept.
 *
 * A planned ride never writes the same line twice. An older OpenGravel export
 * did (route *and* track), which is why the importer also collapses a `<rte>`
 * that repeats a `<trk>` verbatim.
 */
export type ExportMode = "planned-route" | "planned-track" | "track" | "original" | "recorded-ride";

/** Route-point ceiling for files a device has to recalculate. */
export const MAX_ROUTE_POINTS = 250;

export interface ExportWaypoint {
  readonly name: string | null;
  readonly coordinate: Coordinate;
}

export interface ExportTrackSegment {
  readonly coordinates: readonly Coordinate[];
  readonly timestamps?: readonly (string | null)[];
  readonly elevation?: readonly (number | null)[];
}

export interface ExportTrack {
  readonly name: string;
  readonly segments: readonly ExportTrackSegment[];
}

export interface PlannedRouteExportInput {
  readonly title: string;
  readonly geometry: readonly Coordinate[];
  readonly waypoints?: readonly ExportWaypoint[];
  /** Elevations parallel to `geometry`; `null`/absent values are simply not written. */
  readonly elevation?: readonly (number | null)[];
  /** ISO instant for `<metadata><time>`; an unparsable value is not written. */
  readonly createdTime?: string | null;
}

export interface TrackExportInput {
  readonly title: string;
  readonly tracks: readonly ExportTrack[];
  readonly waypoints?: readonly ExportWaypoint[];
  /** ISO instant for `<metadata><time>`; an unparsable value is not written. */
  readonly createdTime?: string | null;
}

const GPX_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenGravel" xmlns="http://www.topografix.com/GPX/1/1">`;
const GPX_SUFFIX = "</gpx>";

/** Escape XML text and attributes without relying on a browser DOM serializer. */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function coordinateValue(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return String(value);
}

function pointAttributes(coordinate: Coordinate): string {
  return `lat="${coordinateValue(coordinate.lat, "latitude")}" lon="${coordinateValue(coordinate.lon, "longitude")}"`;
}

function waypointXml(waypoint: ExportWaypoint): string {
  const name = waypoint.name?.trim() ?? "";
  return name === ""
    ? `<wpt ${pointAttributes(waypoint.coordinate)} />`
    : `<wpt ${pointAttributes(waypoint.coordinate)}><name>${escapeXml(name)}</name></wpt>`;
}

/** A named route point stays a route point; nothing is fabricated for an unnamed one. */
function routePointXml(coordinate: Coordinate, name: string | null): string {
  const label = name?.trim() ?? "";
  return label === ""
    ? `<rtept ${pointAttributes(coordinate)} />`
    : `<rtept ${pointAttributes(coordinate)}><name>${escapeXml(label)}</name></rtept>`;
}

function elevationXml(elevation: number | null | undefined): string {
  return elevation === null || elevation === undefined
    ? ""
    : `<ele>${coordinateValue(elevation, "elevation")}</ele>`;
}

function trackPointXml(
  coordinate: Coordinate,
  timestamp: string | null | undefined,
  elevation: number | null | undefined,
): string {
  const time = timestamp === null || timestamp === undefined
    ? ""
    : `<time>${escapeXml(timestamp)}</time>`;
  return `<trkpt ${pointAttributes(coordinate)}>${elevationXml(elevation)}${time}</trkpt>`;
}

function metadataXml(title: string, createdTime: string | null | undefined): string {
  const trimmed = createdTime?.trim() ?? "";
  const time = trimmed !== "" && !Number.isNaN(Date.parse(trimmed))
    ? `<time>${escapeXml(trimmed)}</time>`
    : "";
  return `<metadata><name>${escapeXml(title)}</name>${time}</metadata>`;
}

function trackXml(track: ExportTrack): string {
  const segments = track.segments.map((segment) => {
    const points = segment.coordinates.map((coordinate, index) => trackPointXml(
      coordinate,
      segment.timestamps?.[index],
      segment.elevation?.[index],
    )).join("");
    return `<trkseg>${points}</trkseg>`;
  }).join("");
  return `<trk><name>${escapeXml(track.name)}</name>${segments}</trk>`;
}

/** A single named point wins over the unnamed duplicate at the same position. */
function namedCoordinates(waypoints: readonly ExportWaypoint[] | undefined): Map<string, string> {
  const named = new Map<string, string>();
  for (const waypoint of waypoints ?? []) {
    const label = waypoint.name?.trim() ?? "";
    if (label === "") continue;
    const key = `${waypoint.coordinate.lat},${waypoint.coordinate.lon}`;
    if (!named.has(key)) named.set(key, label);
  }
  return named;
}

/**
 * Indices of route points to keep: the endpoints, every stop/shaping anchor,
 * and as many evenly spaced fillers as the cap allows. Selection is by arc
 * length rather than by index so dense sections do not dominate the file.
 */
function boundedRouteIndices(
  geometry: readonly Coordinate[],
  waypoints: readonly ExportWaypoint[] | undefined,
  maxPoints: number,
): number[] {
  const last = geometry.length - 1;
  if (geometry.length <= maxPoints) return Array.from({ length: geometry.length }, (_, index) => index);

  const chosen = new Set<number>([0, last]);
  for (const waypoint of waypoints ?? []) {
    const index = nearestIndex(geometry, waypoint.coordinate);
    if (index > 0 && index < last) chosen.add(index);
  }
  if (chosen.size >= maxPoints) {
    // Pathological stop lists still have to stay under the device ceiling.
    const anchors = Array.from(chosen).sort((a, b) => a - b);
    const stride = (anchors.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, slot) => anchors[Math.round(slot * stride)] as number);
  }

  const cumulative = cumulativeLengths(geometry);
  const total = cumulative[last] ?? 0;
  const slots = maxPoints - chosen.size;
  for (let slot = 1; slot <= slots; slot += 1) {
    const target = (total * slot) / (slots + 1);
    chosen.add(firstIndexAtLeast(cumulative, target));
  }
  return Array.from(chosen).sort((a, b) => a - b);
}

function nearestIndex(geometry: readonly Coordinate[], target: Coordinate): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, coordinate] of geometry.entries()) {
    const distance = squaredDegrees(coordinate, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function squaredDegrees(left: Coordinate, right: Coordinate): number {
  const scale = Math.cos((left.lat * Math.PI) / 180);
  const deltaLon = (left.lon - right.lon) * scale;
  const deltaLat = left.lat - right.lat;
  return deltaLon * deltaLon + deltaLat * deltaLat;
}

function cumulativeLengths(geometry: readonly Coordinate[]): number[] {
  const cumulative: number[] = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1] as Coordinate;
    const current = geometry[index] as Coordinate;
    cumulative.push((cumulative[index - 1] ?? 0) + Math.sqrt(squaredDegrees(previous, current)));
  }
  return cumulative;
}

function firstIndexAtLeast(cumulative: readonly number[], target: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((cumulative[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function requireLine(input: { readonly geometry: readonly Coordinate[] }): void {
  if (input.geometry.length < 2) throw new Error("A planned route needs at least two geometry points.");
}

/** Build the recalculating device's file: a bounded `<rte>`, never a duplicate track. */
export function buildPlannedRouteGpx(input: PlannedRouteExportInput): string {
  requireLine(input);
  const named = namedCoordinates(input.waypoints);
  const indices = boundedRouteIndices(input.geometry, input.waypoints, MAX_ROUTE_POINTS);
  const routePoints = indices.map((index) => {
    const coordinate = input.geometry[index] as Coordinate;
    return routePointXml(coordinate, named.get(`${coordinate.lat},${coordinate.lon}`) ?? null);
  }).join("");
  return `${GPX_PREFIX}${metadataXml(input.title, input.createdTime)}<rte><name>${escapeXml(input.title)}</name>${routePoints}</rte>${GPX_SUFFIX}`;
}

/** Build the full-line file: one `<trk>` with every point and named `<wpt>`s. */
export function buildPlannedTrackGpx(input: PlannedRouteExportInput): string {
  requireLine(input);
  const waypoints = input.waypoints?.map(waypointXml).join("") ?? "";
  const elevation = input.elevation;
  const track = trackXml({
    name: input.title,
    segments: [{
      coordinates: input.geometry,
      ...(elevation === undefined ? {} : { elevation }),
    }],
  });
  return `${GPX_PREFIX}${metadataXml(input.title, input.createdTime)}${waypoints}${track}${GPX_SUFFIX}`;
}

/** Build a track-only GPX while retaining every source track segment. */
export function buildTrackGpx(input: TrackExportInput): string {
  if (input.tracks.length === 0) throw new Error("A track export needs at least one track.");
  if (input.tracks.some((track) => track.segments.length === 0 || track.segments.some((segment) => segment.coordinates.length === 0))) {
    throw new Error("A track export needs at least one geometry point per segment.");
  }
  const waypoints = input.waypoints?.map(waypointXml).join("") ?? "";
  return `${GPX_PREFIX}${metadataXml(input.title, input.createdTime)}${waypoints}${input.tracks.map(trackXml).join("")}${GPX_SUFFIX}`;
}

/** Original exports are byte-for-byte copies; no text decode or re-encode occurs. */
export function originalFileBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

/** Convert a rider title into a stable, filesystem-safe slug. */
export function sanitizeFilenamePart(value: string, maxLength = 80): string {
  const normalized = value.normalize("NFKD").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  return (normalized.replace(/^-+|-+$/g, "").slice(0, maxLength).replace(/-+$/g, "") || "ride");
}

function dateStamp(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The name used when the rider has not named the ride yet. */
export function openGravelRideTitle(now: Date = new Date()): string {
  return `OpenGravel ride ${dateStamp(now)}`;
}

/** The ride's own name, or the dated house name — never an empty title. */
export function rideExportTitle(title: string | null | undefined, now: Date = new Date()): string {
  const trimmed = title?.trim() ?? "";
  return trimmed === "" ? openGravelRideTitle(now) : trimmed;
}

/** The bounded download name shared by every export mode. */
export interface ExportFilenameOptions {
  readonly extension?: string;
  /** Clock used only for the untitled-ride fallback. */
  readonly now?: Date;
}

function safeExtension(extension: string | undefined): string {
  const normalized = extension?.trim().replace(/^\.+/, "").toLowerCase() ?? "";
  return /^[a-z0-9]{1,12}$/.test(normalized) ? normalized : "gpx";
}

export function exportFilename(title: string, mode: ExportMode, options: ExportFilenameOptions = {}): string {
  const titlePart = title.trim() === ""
    ? `ride-${dateStamp(options.now ?? new Date())}`
    : sanitizeFilenamePart(title);
  const modePart = sanitizeFilenamePart(mode, 24);
  const prefix = `opengravel-${titlePart}-${modePart}`;
  const extension = mode === "original" ? safeExtension(options.extension) : "gpx";
  return `${prefix.slice(0, 124).replace(/-+$/g, "")}.${extension}`;
}

export const sanitizeExportName = sanitizeFilenamePart;

export interface DownloadDocument {
  createElement(localName: string): HTMLAnchorElement;
  body: HTMLElement;
}

/** Download bytes through an object URL, then release it after the click task. */
export function downloadExport(
  bytes: Uint8Array,
  filename: string,
  documentRef: DownloadDocument = document,
  mime = "application/gpx+xml",
): void {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const objectUrl = URL.createObjectURL(new Blob([copy], { type: mime }));
  const anchor = documentRef.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  documentRef.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    if (anchor.parentNode === documentRef.body) documentRef.body.removeChild(anchor);
  }, 0);
}
