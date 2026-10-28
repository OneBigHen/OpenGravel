/**
 * Geometry helpers for the trail catalog job. Distances are real metres on the
 * WGS84 sphere (`haversine` from the app domain), never degrees.
 */

import { haversine } from "../../../src/domain/geometry/analysis";
import type { Coordinate } from "../../../src/domain/ride/types";

export type Line = readonly Coordinate[];

/** ~1.1 m at the equator: enough to treat two sources' shared nodes as equal. */
const SIGNATURE_DIGITS = 5;

const vertexKey = (coordinate: Coordinate): string =>
  `${coordinate.lon.toFixed(SIGNATURE_DIGITS)},${coordinate.lat.toFixed(SIGNATURE_DIGITS)}`;

export function isCoordinate(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { lon?: unknown; lat?: unknown };
  return (
    typeof candidate.lon === "number" &&
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lon) &&
    Number.isFinite(candidate.lat) &&
    Math.abs(candidate.lat) <= 90 &&
    Math.abs(candidate.lon) <= 180
  );
}

/** GeoJSON position → Coordinate. Ordinates beyond lon/lat (elevation) are dropped. */
export function positionToCoordinate(position: unknown): Coordinate | null {
  if (!Array.isArray(position) || position.length < 2) return null;
  const [lon, lat] = position;
  const candidate = { lon, lat };
  return isCoordinate(candidate) ? candidate : null;
}

function ringToLine(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return [];
  const line: Coordinate[] = [];
  for (const position of value) {
    const coordinate = positionToCoordinate(position);
    if (coordinate !== null) line.push(coordinate);
  }
  return line;
}

/** A Point geometry (a trailhead node). Not a line: a one-vertex trail is not a trail. */
export function pointFromGeometry(geometry: unknown): Coordinate | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  return type === "Point" ? positionToCoordinate(coordinates) : null;
}

/** Geometry → lines. LineStrings and multi-lines for trails; rings for parking areas. */
export function linesFromGeometry(geometry: unknown): Coordinate[][] {
  if (typeof geometry !== "object" || geometry === null) return [];
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (type === "LineString") {
    const line = ringToLine(coordinates);
    return line.length >= 2 ? [line] : [];
  }
  if (type === "Polygon") {
    if (!Array.isArray(coordinates)) return [];
    const outer = ringToLine(coordinates[0]);
    return outer.length >= 2 ? [outer] : [];
  }
  if (type === "MultiLineString" || type === "MultiPolygon") {
    if (!Array.isArray(coordinates)) return [];
    const lines: Coordinate[][] = [];
    for (const part of coordinates) {
      lines.push(...linesFromGeometry({ type: type === "MultiPolygon" ? "Polygon" : "LineString", coordinates: part }));
    }
    return lines;
  }
  return [];
}

export function lineLengthMeters(line: Line): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    const previous = line[index - 1];
    const current = line[index];
    if (previous !== undefined && current !== undefined) total += haversine(previous, current);
  }
  return total;
}

export function linesLengthMeters(lines: readonly Line[]): number {
  return lines.reduce((total, line) => total + lineLengthMeters(line), 0);
}

/** Rounded vertex sequence so two sources that share OSM nodes compare equal. */
export function lineSignature(line: Line): string {
  return line
    .map((coordinate) => `${coordinate.lon.toFixed(SIGNATURE_DIGITS)},${coordinate.lat.toFixed(SIGNATURE_DIGITS)}`)
    .join(";");
}

/** Orientation-independent signature: the same line walked either way matches. */
export function undirectedLineSignature(line: Line): string {
  const forward = lineSignature(line);
  const backward = lineSignature([...line].reverse());
  return forward < backward ? forward : backward;
}

/**
 * Identity of a geometry for exact duplicate detection: per-line signatures,
 * unordered and orientation-free. A MultiLineString assembled from the same
 * member ways in another order still matches.
 */
export function geometrySignature(lines: readonly Line[]): string {
  return lines.map(undirectedLineSignature).sort().join("|");
}

/**
 * Coarse bucket for near-duplicate detection. Two sources rarely share every
 * vertex, so they are bucketed by canonical endpoints and a rounded length and
 * then confirmed precisely by `isNearDuplicate`.
 */
export function geometryNeighbourKey(lines: readonly Line[], lengthMeters: number): string {
  const line = longestLine(lines);
  if (line === null) return "empty";
  const first = line[0];
  const last = line[line.length - 1];
  if (first === undefined || last === undefined) return "empty";
  const ends = [
    `${first.lon.toFixed(2)},${first.lat.toFixed(2)}`,
    `${last.lon.toFixed(2)},${last.lat.toFixed(2)}`,
  ].sort();
  // 1 km length bands: same trail digitized by two agencies still lands here.
  return `${ends.join(">")}#${Math.round(lengthMeters / 1000)}`;
}

export function longestLine(lines: readonly Line[]): Line | null {
  let longest: Line | null = null;
  let longestLength = -1;
  for (const line of lines) {
    const length = lineLengthMeters(line);
    if (length > longestLength) {
      longest = line;
      longestLength = length;
    }
  }
  return longest;
}

/** Canonical endpoints of the longest line, so a reversal cannot hide a duplicate. */
export function primaryEndpoints(lines: readonly Line[]): readonly [Coordinate, Coordinate] | null {
  const line = longestLine(lines);
  if (line === null || line.length < 2) return null;
  const first = line[0];
  const last = line[line.length - 1];
  if (first === undefined || last === undefined) return null;
  return first.lon < last.lon || (first.lon === last.lon && first.lat < last.lat)
    ? [first, last]
    : [last, first];
}

export interface EndMatch {
  readonly distanceMeters: number;
  readonly lineIndex: number;
  readonly end: "start" | "end";
}

/** Nearest trail end to `point`, measured across every line of the geometry. */
export function nearestEnd(lines: readonly Line[], point: Coordinate): EndMatch | null {
  let best: EndMatch | null = null;
  lines.forEach((line, lineIndex) => {
    const first = line[0];
    const last = line[line.length - 1];
    if (first === undefined || last === undefined) return;
    const candidates: readonly [Coordinate, "start" | "end"][] = [
      [first, "start"],
      [last, "end"],
    ];
    for (const [coordinate, end] of candidates) {
      const distanceMeters = haversine(coordinate, point);
      if (best === null || distanceMeters < best.distanceMeters) best = { distanceMeters, lineIndex, end };
    }
  });
  return best;
}

/** Distance from `point` to the closest vertex of any line (areas: boundary). */
export function distanceToLines(lines: readonly Line[], point: Coordinate): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (const coordinate of line) {
      const distance = haversine(coordinate, point);
      if (distance < best) best = distance;
    }
  }
  return best;
}

/** Vertex average of the outer ring — good enough for a parking area's position. */
export function polygonCentre(lines: readonly Line[]): Coordinate | null {
  const ring = lines[0];
  if (ring === undefined || ring.length === 0) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  // A closed ring repeats its first vertex; counting it twice would drag the centre.
  const vertices = ring.length > 1 && first !== undefined && last !== undefined && vertexKey(first) === vertexKey(last)
    ? ring.slice(0, -1)
    : ring;
  let lon = 0;
  let lat = 0;
  for (const coordinate of vertices) {
    lon += coordinate.lon;
    lat += coordinate.lat;
  }
  return { lon: lon / vertices.length, lat: lat / vertices.length };
}

export function bboxOf(lines: readonly Line[]): [number, number, number, number] {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    for (const coordinate of line) {
      if (coordinate.lon < west) west = coordinate.lon;
      if (coordinate.lon > east) east = coordinate.lon;
      if (coordinate.lat < south) south = coordinate.lat;
      if (coordinate.lat > north) north = coordinate.lat;
    }
  }
  return [west, south, east, north];
}

/**
 * Join member ways in their relation order into continuous lines. Ways are
 * reversed when needed; a way that starts a new segment (a gap or a jump)
 * begins a new line instead of being quietly connected across the gap.
 */
export function assembleLines(segments: readonly Line[]): Coordinate[][] {
  const assembled: Coordinate[][] = [];
  let current: Coordinate[] = [];
  const same = (a: Coordinate, b: Coordinate): boolean => vertexKey(a) === vertexKey(b);

  for (const segment of segments) {
    if (segment.length < 2) continue;
    const tail = current[current.length - 1];
    if (tail !== undefined) {
      const head = segment[0];
      const last = segment[segment.length - 1];
      if (head !== undefined && same(tail, head)) {
        current.push(...segment.slice(1));
        continue;
      }
      if (last !== undefined && same(tail, last)) {
        current.push(...[...segment].reverse().slice(1));
        continue;
      }
      assembled.push(current);
      current = [];
    }
    current = [...segment];
  }
  if (current.length >= 2) assembled.push(current);
  return assembled.filter((line) => line.length >= 2);
}

/** True when `part` appears as a contiguous run of vertices inside `line`, either way. */
export function isContainedIn(part: Line, line: Line): boolean {
  const haystack = line.map(vertexKey);
  const partKeys = part.map(vertexKey);
  return [partKeys, [...partKeys].reverse()].some((needle) => {
    if (needle.length > haystack.length) return false;
    for (let start = 0; start + needle.length <= haystack.length; start += 1) {
      let matched = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (needle[offset] !== haystack[start + offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  });
}
