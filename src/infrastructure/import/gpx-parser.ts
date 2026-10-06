import { type ImportLimitsOverride, resolveImportLimits } from "@/application/import/limits";
import { boundedName, checkCancelled, coordinateFromAttributes, ensureTrackHasGeometry, fileFallbackName, finalProgress, makeParseState, parseElevation, parseTimestamp, pointSeen, segmentSeen, trackSeen, type ParseState } from "./helpers";
import type { ImportParseOptions, ParsedImport, ParsedImportTrack, ParsedImportWaypoint } from "./types";
import { parseXmlDocument, childText, directChild, type XmlElement } from "./xml";

export interface GpxParseOptions {
  readonly filename?: string;
  readonly byteLength?: number;
  readonly limits?: ImportLimitsOverride;
  readonly signal?: AbortSignal;
  readonly onProgress?: ImportParseOptions["onProgress"];
}

export type { ParsedImport } from "./types";

function xmlBytes(xml: string): number {
  return new TextEncoder().encode(xml).byteLength;
}

function pointElements(segment: XmlElement, localName: "trkpt" | "rtept"): XmlElement[] {
  return segment.children.filter((child) => child.localName === localName);
}

function parsedSegment(
  elements: readonly XmlElement[],
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
  trackName: string,
  segmentIndex: number,
): { coordinates: readonly { readonly lon: number; readonly lat: number }[]; timestamps: readonly (string | null)[]; elevation: readonly (number | null)[] } | null {
  const coordinates: { lon: number; lat: number }[] = [];
  const timestamps: (string | null)[] = [];
  const elevation: (number | null)[] = [];
  elements.forEach((element, pointIndex) => {
    pointSeen(state, limits);
    const label = `${trackName} segment ${segmentIndex + 1} point ${pointIndex + 1}`;
    const coordinate = coordinateFromAttributes(element, state, label);
    if (coordinate === null) return;
    coordinates.push(coordinate);
    timestamps.push(parseTimestamp(element, state, label, limits));
    elevation.push(parseElevation(element, state, label));
  });
  if (coordinates.length < 2) {
    state.warnings.push(`Ignored ${trackName} segment ${segmentIndex + 1}; it has fewer than two valid coordinates.`);
    return null;
  }
  return { coordinates, timestamps, elevation };
}

function parseTrack(
  element: XmlElement,
  kind: "track" | "route",
  fallbackName: string,
  state: ParseState,
  limits: ReturnType<typeof resolveImportLimits>,
): ParsedImportTrack | null {
  trackSeen(state, limits);
  const name = boundedName(childText(element, "name"), fallbackName, limits, state);
  const rawSourceType = childText(element, "type")?.trim();
  const sourceType = rawSourceType === undefined || rawSourceType.length === 0 ? undefined : rawSourceType.slice(0, 120);
  const segmentElements = kind === "track"
    ? element.children.filter((child) => child.localName === "trkseg")
    : [element];
  const segments: { readonly coordinates: readonly { readonly lon: number; readonly lat: number }[]; readonly timestamps: readonly (string | null)[]; readonly elevation: readonly (number | null)[] }[] = [];
  if (kind === "track" && segmentElements.length === 0) {
    state.warnings.push(`Ignored track "${name}" because it contains no trkseg elements.`);
  }
  for (const [segmentIndex, segment] of segmentElements.entries()) {
    checkCancelled(state);
    segmentSeen(state, limits);
    const points = pointElements(segment, kind === "track" ? "trkpt" : "rtept");
    const parsed = parsedSegment(points, state, limits, name, segmentIndex);
    if (parsed !== null) segments.push(parsed);
  }
  return ensureTrackHasGeometry(segments, name, state)
    ? {
        name,
        sourceKind: kind,
        ...(sourceType === undefined ? {} : { sourceType }),
        segments: segments.map((segment) => segment.coordinates),
        timestamps: segments.map((segment) => segment.timestamps),
        elevation: segments.map((segment) => segment.elevation),
      }
    : null;
}

function metadataName(root: XmlElement): string | null {
  const metadata = directChild(root, "metadata");
  return metadata === undefined ? null : childText(metadata, "name");
}

function metadataDescription(root: XmlElement): string | undefined {
  const metadata = directChild(root, "metadata");
  const description = metadata === undefined ? null : childText(metadata, "desc");
  const bounded = description?.trim().slice(0, 4_000);
  return bounded === undefined || bounded.length === 0 ? undefined : bounded;
}

/** Parse GPX 1.1 tracks and routes without joining source segments. */
export function parseGpx(xml: string, options: GpxParseOptions = {}): ParsedImport {
  const filename = options.filename ?? "import.gpx";
  const limits = resolveImportLimits(options.limits);
  const byteLength = options.byteLength ?? xmlBytes(xml);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > limits.MAX_FILE_BYTES) {
    throw new RangeError(`GPX imports are limited to ${Math.round(limits.MAX_FILE_BYTES / (1024 * 1024))} MB.`);
  }
  const state = makeParseState({ signal: options.signal, onProgress: options.onProgress });
  checkCancelled(state);
  let root: XmlElement;
  try {
    root = parseXmlDocument(xml, limits);
  } catch (error: unknown) {
    if (error instanceof RangeError || error instanceof Error && (error.name === "ImportSecurityError" || error.name === "ImportCancelledError")) throw error;
    throw new SyntaxError("The GPX file is malformed.");
  }
  if (root.localName !== "gpx" || !(["1.0", "1.1"].includes(root.attributes["version"] ?? ""))) {
    throw new SyntaxError("The GPX file must use a GPX 1.0 or 1.1 root.");
  }

  const tracks = root.children.filter((child) => child.localName === "trk");
  const routes = root.children.filter((child) => child.localName === "rte");
  const rawSegments = tracks.reduce((total, track) => total + track.children.filter((child) => child.localName === "trkseg").length, 0) + routes.length;
  if (rawSegments > limits.MAX_SEGMENTS) throw new RangeError(`Import exceeds the ${limits.MAX_SEGMENTS}-segment limit.`);
  if (tracks.length + routes.length > limits.MAX_TRACKS) throw new RangeError(`Import exceeds the ${limits.MAX_TRACKS}-track limit.`);

  const parsedTracks: ParsedImportTrack[] = [];
  const sourceName = boundedName(metadataName(root) ?? childText(root, "name"), fileFallbackName(filename), limits, state);
  for (const element of tracks) {
    const parsed = parseTrack(element, "track", sourceName, state, limits);
    if (parsed !== null) parsedTracks.push(parsed);
  }
  for (const element of routes) {
    const parsed = parseTrack(element, "route", sourceName, state, limits);
    if (parsed !== null) parsedTracks.push(parsed);
  }

  const waypoints = root.children.filter((child) => child.localName === "wpt");
  let validWaypoints = 0;
  const parsedWaypoints: ParsedImportWaypoint[] = [];
  for (const [index, waypoint] of waypoints.entries()) {
    pointSeen(state, limits);
    const coordinate = coordinateFromAttributes(waypoint, state, `waypoint ${index + 1}`);
    if (coordinate !== null) {
      validWaypoints += 1;
      parsedWaypoints.push({
        name: childText(waypoint, "name"),
        coordinate,
        elevation: parseElevation(waypoint, state, `waypoint ${index + 1}`),
        timestamp: parseTimestamp(waypoint, state, `waypoint ${index + 1}`, limits),
      });
    }
  }
  if (waypoints.length > 0) {
    state.warnings.push(`Preserved ${validWaypoints} GPX waypoint${validWaypoints === 1 ? "" : "s"} as metadata; they are not merged into the source track geometry.`);
  }
  if (parsedTracks.length === 0 && waypoints.length === 0) {
    throw new SyntaxError("The GPX file contains no track, route, or waypoint geometry.");
  }
  finalProgress(state);
  const sourceDescription = metadataDescription(root);
  return {
    tracks: parsedTracks,
    warnings: state.warnings,
    waypoints: parsedWaypoints,
    ...(sourceDescription === undefined ? {} : { sourceDescription }),
  };
}

/** Compatibility spelling for callers that name the format explicitly. */
export const parseGpxRoute = parseGpx;
