import {
  type ImportLimitsOverride,
  resolveImportLimits,
} from "@/application/import/limits";
import { boundedName, checkCancelled, fileFallbackName, finalProgress, makeParseState, pointSeen, segmentSeen, trackSeen, type ParseState } from "./helpers";
import type { ImportParseOptions, ParsedImport, ParsedImportTrack, ParsedImportWaypoint } from "./types";
import { childText, descendants, parseXmlDocument, type XmlElement } from "./xml";

export interface KmlParseOptions {
  readonly filename?: string;
  readonly byteLength?: number;
  readonly limits?: ImportLimitsOverride;
  readonly signal?: AbortSignal;
  readonly onProgress?: ImportParseOptions["onProgress"];
}

function xmlBytes(xml: string): number {
  return new TextEncoder().encode(xml).byteLength;
}

function parseKmlTimestamp(value: string | undefined, state: ParseState, label: string, maxBytes: number): string | null {
  const raw = value?.trim() ?? "";
  if (raw === "") return null;
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    state.warnings.push(`Ignored oversized timestamp in ${label}.`);
    return null;
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    state.warnings.push(`Ignored invalid timestamp in ${label}.`);
    return null;
  }
  return new Date(milliseconds).toISOString();
}

interface KmlPoint {
  readonly coordinate: { readonly lon: number; readonly lat: number };
  readonly elevation: number | null;
}

function coordinateToken(
  token: string,
  state: ParseState,
  label: string,
  limits: ReturnType<typeof resolveImportLimits>,
  separator: "comma" | "space" = "comma",
): KmlPoint | null {
  pointSeen(state, limits);
  if (new TextEncoder().encode(token).byteLength > limits.MAX_COORDINATE_TOKEN_BYTES) {
    state.warnings.push(`Dropped oversized coordinate token in ${label}.`);
    return null;
  }
  const values = (separator === "comma" ? token.split(",") : token.trim().split(/\s+/)).map((value) => value.trim());
  const longitude = values[0] === undefined || values[0] === "" ? Number.NaN : Number(values[0]);
  const latitude = values[1] === undefined || values[1] === "" ? Number.NaN : Number(values[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    state.warnings.push(`Dropped invalid coordinate in ${label}.`);
    return null;
  }
  const elevationText = values[2];
  const elevation = elevationText === undefined || elevationText === "" ? null : Number(elevationText);
  if (elevationText !== undefined && elevationText !== "" && !Number.isFinite(elevation)) {
    state.warnings.push(`Ignored invalid elevation in ${label}.`);
  }
  return { coordinate: { lon: longitude, lat: latitude }, elevation: Number.isFinite(elevation) ? elevation : null };
}

function linePoints(
  line: XmlElement,
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
  name: string,
): KmlPoint[] {
  const raw = line.children.find((child) => child.localName === "coordinates")?.text ?? "";
  return raw.trim() === ""
    ? []
    : raw.trim().split(/\s+/).flatMap((token, index) => {
        const point = coordinateToken(token, state, `${name} point ${index + 1}`, limits);
        return point === null ? [] : [point];
      });
}

function gxTrackPoints(
  track: XmlElement,
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
  name: string,
): { readonly points: KmlPoint[]; readonly timestamps: (string | null)[] } {
  const coordinates = track.children.filter((child) => child.localName === "coord");
  const whens = track.children.filter((child) => child.localName === "when");
  const points: KmlPoint[] = [];
  const timestamps: (string | null)[] = [];
  for (const [index, element] of coordinates.entries()) {
    const point = coordinateToken(element.text.trim(), state, `${name} point ${index + 1}`, limits, "space");
    if (point === null) continue;
    points.push(point);
    timestamps.push(parseKmlTimestamp(whens[index]?.text, state, `${name} point ${index + 1}`, limits.MAX_TIMESTAMP_BYTES));
  }
  if (whens.length !== coordinates.length) {
    state.warnings.push(`KML gx:Track "${name}" has ${coordinates.length} coordinates and ${whens.length} timestamps; unmatched values are null.`);
  }
  return { points, timestamps };
}

function inspectKmlWaypoint(
  point: XmlElement,
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
  name: string,
  output: ParsedImportWaypoint[],
): void {
  const raw = point.children.find((child) => child.localName === "coordinates")?.text ?? "";
  const valid = raw.trim() === ""
    ? []
    : raw.trim().split(/\s+/).flatMap((token, index) => {
        const value = coordinateToken(token, state, `${name} waypoint ${index + 1}`, limits);
        return value === null ? [] : [value];
      });
  for (const point of valid) {
    output.push({ name: name || null, coordinate: point.coordinate, elevation: point.elevation, timestamp: null });
  }
  state.warnings.push(`Preserved ${valid.length} KML waypoint${valid.length === 1 ? "" : "s"} in the original; waypoints are not automatically added to track geometry.`);
}

function appendGeometry(
  element: XmlElement,
  kind: "line" | "track",
  name: string,
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
  output: ParsedImportTrack[],
): void {
  trackSeen(state, limits);
  segmentSeen(state, limits);
  const trackData = kind === "track" ? gxTrackPoints(element, state, limits, name) : null;
  const points = kind === "line"
    ? linePoints(element, state, limits, name)
    : trackData!.points;
  const timestamps = kind === "track"
    ? trackData!.timestamps
    : points.map(() => null);
  if (points.length < 2) {
    state.warnings.push(`Ignored KML ${kind} "${name}" because it has fewer than two valid coordinates.`);
    return;
  }
  output.push({
    name,
    segments: [points.map((point) => point.coordinate)],
    timestamps: [timestamps],
    elevation: [points.map((point) => point.elevation)],
  });
}

function walkKml(
  element: XmlElement,
  inheritedName: string,
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
  output: ParsedImportTrack[],
  waypoints: ParsedImportWaypoint[],
): void {
  checkCancelled(state);
  const ownName = element.localName === "Placemark" ? childText(element, "name")?.trim() : null;
  const name = ownName || inheritedName;
  for (const child of element.children) {
    if (child.localName === "LineString") {
      appendGeometry(child, "line", name, state, limits, output);
    } else if (child.localName === "Track") {
      appendGeometry(child, "track", name, state, limits, output);
    } else if (child.localName === "Point") {
      inspectKmlWaypoint(child, state, limits, name, waypoints);
    } else {
      walkKml(child, name, state, limits, output, waypoints);
    }
  }
}

/** Parse KML LineString and gx:Track geometry, retaining each as its own segment. */
export function parseKml(xml: string, options: KmlParseOptions = {}): ParsedImport {
  const filename = options.filename ?? "import.kml";
  const limits = resolveImportLimits(options.limits);
  const byteLength = options.byteLength ?? xmlBytes(xml);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > limits.MAX_FILE_BYTES) {
    throw new RangeError(`KML imports are limited to ${Math.round(limits.MAX_FILE_BYTES / (1024 * 1024))} MB.`);
  }
  const state = makeParseState({ signal: options.signal, onProgress: options.onProgress });
  checkCancelled(state);
  let root: XmlElement;
  try {
    root = parseXmlDocument(xml, limits);
  } catch (error: unknown) {
    if (error instanceof RangeError || error instanceof Error && (error.name === "ImportSecurityError" || error.name === "ImportCancelledError")) throw error;
    throw new SyntaxError("The KML file is malformed.");
  }
  if (root.localName !== "kml") throw new SyntaxError("The KML file must use a kml root.");
  const documentName = childText(descendants(root, "Document")[0] ?? root, "name")?.trim() || fileFallbackName(filename);
  const output: ParsedImportTrack[] = [];
  const waypoints: ParsedImportWaypoint[] = [];
  walkKml(root, documentName, state, limits, output, waypoints);
  for (const [index, track] of output.entries()) {
    output[index] = { ...track, name: boundedName(track.name, documentName, limits, state) };
  }
  if (output.length === 0) throw new SyntaxError("The KML file contains no valid LineString or gx:Track geometry.");
  finalProgress(state);
  return { tracks: output, warnings: state.warnings, waypoints };
}

/** Compatibility spelling for callers that name the format explicitly. */
export const parseKmlRoute = parseKml;
