import type { Coordinate } from "@/domain/ride/types";

export type ExportMode = "planned-route" | "track" | "original" | "recorded-ride";

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
}

export interface TrackExportInput {
  readonly title: string;
  readonly tracks: readonly ExportTrack[];
  readonly waypoints?: readonly ExportWaypoint[];
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

function routePointXml(coordinate: Coordinate): string {
  return `<rtept ${pointAttributes(coordinate)} />`;
}

function trackPointXml(
  coordinate: Coordinate,
  timestamp: string | null | undefined,
  elevation: number | null | undefined,
): string {
  const time = timestamp === null || timestamp === undefined
    ? ""
    : `<time>${escapeXml(timestamp)}</time>`;
  const ele = elevation === null || elevation === undefined
    ? ""
    : `<ele>${coordinateValue(elevation, "elevation")}</ele>`;
  return `<trkpt ${pointAttributes(coordinate)}>${ele}${time}</trkpt>`;
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

/** Build a route plus its geometry-preserving track fallback. */
export function buildPlannedRouteGpx(input: PlannedRouteExportInput): string {
  if (input.geometry.length < 2) throw new Error("A planned route needs at least two geometry points.");
  const waypoints = input.waypoints?.map(waypointXml).join("") ?? "";
  const routePoints = input.geometry.map(routePointXml).join("");
  const fallback = trackXml({
    name: input.title,
    segments: [{ coordinates: input.geometry }],
  });
  return `${GPX_PREFIX}<metadata><name>${escapeXml(input.title)}</name></metadata>${waypoints}<rte><name>${escapeXml(input.title)}</name>${routePoints}</rte>${fallback}${GPX_SUFFIX}`;
}

/** Build a track-only GPX while retaining every source track segment. */
export function buildTrackGpx(input: TrackExportInput): string {
  if (input.tracks.length === 0) throw new Error("A track export needs at least one track.");
  if (input.tracks.some((track) => track.segments.length === 0 || track.segments.some((segment) => segment.coordinates.length === 0))) {
    throw new Error("A track export needs at least one geometry point per segment.");
  }
  const waypoints = input.waypoints?.map(waypointXml).join("") ?? "";
  return `${GPX_PREFIX}<metadata><name>${escapeXml(input.title)}</name></metadata>${waypoints}${input.tracks.map(trackXml).join("")}${GPX_SUFFIX}`;
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

/** The bounded download name shared by every export mode. */
export interface ExportFilenameOptions {
  readonly extension?: string;
}

function safeExtension(extension: string | undefined): string {
  const normalized = extension?.trim().replace(/^\.+/, "").toLowerCase() ?? "";
  return /^[a-z0-9]{1,12}$/.test(normalized) ? normalized : "gpx";
}

export function exportFilename(title: string, mode: ExportMode, options: ExportFilenameOptions = {}): string {
  const titlePart = sanitizeFilenamePart(title);
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
