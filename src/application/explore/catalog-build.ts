import type { Coordinate } from "@/domain/ride/types";
import type { CatalogRideStory } from "@/application/explore/ride-story";

export interface CatalogBuildInput {
  readonly id: string;
  readonly name: string;
  readonly sourceProject?: string;
  readonly sourceFile?: string;
  readonly author?: string;
  readonly license?: string;
  readonly redistribution?: string;
  readonly gpx: string;
  readonly geometry?: readonly (readonly [number, number])[];
  readonly surfaceSummary?: string;
  readonly curvatureSummary?: string;
  readonly evidenceNote?: string;
  readonly duplicateFamilyId?: string;
  readonly duplicateFamilyRole?: "canonical" | "near-duplicate";
  readonly startPlaceName?: string;
  /** Card label for one track of a multi-track source; null means none. Absent derives it from a `--tN` id. */
  readonly trackLabel?: string | null;
  /** Card line; absent falls back to the distance. */
  readonly summary?: string;
  readonly story?: CatalogRideStory;
}

export interface CatalogBuildRecord {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly summary: string;
  readonly distanceMiles: number;
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly geometry: readonly Coordinate[];
  readonly geometryPolyline: string;
  readonly provenance: string;
  readonly provenanceDetail: string;
  readonly evidenceNote: string;
  readonly surfaceSummary?: string;
  readonly curvatureSummary?: string;
  readonly catalogGroupId: string;
  readonly trackGroupId: string;
  readonly trackLabel?: string;
  readonly nameIsGenerated: boolean;
  readonly story?: CatalogRideStory;
}

const MAX_PREVIEW_POINTS = 200;
const EARTH_RADIUS_METERS = 6_371_000;
const POLYLINE_PRECISION = 6;

function encodePolylineValue(value: number): string {
  let remaining = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (remaining >= 0x20) {
    encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
    remaining >>>= 5;
  }
  return encoded + String.fromCharCode(remaining + 63);
}

/** Encodes a route line at six decimal places (about 0.11 m per latitude unit). */
export function encodeCatalogPolyline(points: readonly Coordinate[]): string {
  const scale = 10 ** POLYLINE_PRECISION;
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = "";
  for (const point of points) {
    const latitude = Math.round(point.lat * scale);
    const longitude = Math.round(point.lon * scale);
    encoded += encodePolylineValue(latitude - previousLatitude);
    encoded += encodePolylineValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return encoded;
}

/** Decodes a catalog polyline without browser or provider dependencies. */
export function decodeCatalogPolyline(encoded: string): Coordinate[] {
  const scale = 10 ** POLYLINE_PRECISION;
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const points: Coordinate[] = [];
  const readDelta = (): number => {
    let result = 0;
    let shift = 0;
    let chunk: number;
    do {
      if (index >= encoded.length) throw new Error("Catalog route geometry is truncated.");
      chunk = encoded.charCodeAt(index++) - 63;
      if (chunk < 0 || chunk > 0x3f || shift > 30) throw new Error("Catalog route geometry is invalid.");
      result |= (chunk & 0x1f) << shift;
      shift += 5;
    } while (chunk >= 0x20);
    return (result & 1) === 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    latitude += readDelta();
    longitude += readDelta();
    const point = { lat: latitude / scale, lon: longitude / scale };
    if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) throw new Error("Catalog route geometry is out of range.");
    points.push(point);
  }
  return points;
}

function parseGeometry(gpx: string): Coordinate[] {
  const points: Coordinate[] = [];
  for (const match of gpx.matchAll(/<trkpt\b([^>]*)\/?\s*>/gi)) {
    const attrs = match[1] ?? "";
    const lat = /\blat=["']([^"']+)["']/i.exec(attrs)?.[1];
    const lon = /\blon=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (lat === undefined || lon === undefined) continue;
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || Math.abs(parsedLat) > 90 || Math.abs(parsedLon) > 180) continue;
    const next = { lat: parsedLat, lon: parsedLon };
    const previous = points.at(-1);
    if (previous === undefined || previous.lat !== next.lat || previous.lon !== next.lon) points.push(next);
  }
  return points;
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function segmentMeters(a: Coordinate, b: Coordinate): number {
  const lat = radians(b.lat - a.lat);
  const lon = radians(b.lon - a.lon);
  const term = Math.sin(lat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

function distanceMeters(points: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += segmentMeters(points[index - 1]!, points[index]!);
  return total;
}

function perpendicularDistance(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const x = point.lon;
  const y = point.lat;
  const dx = end.lon - start.lon;
  const dy = end.lat - start.lat;
  if (dx === 0 && dy === 0) return Math.hypot(x - start.lon, y - start.lat) * 111_000;
  const t = Math.max(0, Math.min(1, ((x - start.lon) * dx + (y - start.lat) * dy) / (dx * dx + dy * dy)));
  const projected = { lon: start.lon + t * dx, lat: start.lat + t * dy };
  return segmentMeters(point, projected);
}

function simplify(points: readonly Coordinate[], toleranceMeters: number): Coordinate[] {
  if (points.length <= 2) return [...points];
  let farthest = 0;
  let index = 0;
  for (let candidate = 1; candidate < points.length - 1; candidate += 1) {
    const distance = perpendicularDistance(points[candidate]!, points[0]!, points.at(-1)!);
    if (distance > farthest) { farthest = distance; index = candidate; }
  }
  if (farthest <= toleranceMeters) return [points[0]!, points.at(-1)!];
  const left = simplify(points.slice(0, index + 1), toleranceMeters);
  const right = simplify(points.slice(index), toleranceMeters);
  return [...left.slice(0, -1), ...right];
}

function preview(points: readonly Coordinate[]): Coordinate[] {
  if (points.length <= MAX_PREVIEW_POINTS) return [...points];
  let low = 0;
  let high = 100_000;
  let result = [points[0]!, points.at(-1)!];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const tolerance = (low + high) / 2;
    const simplified = simplify(points, tolerance);
    if (simplified.length <= MAX_PREVIEW_POINTS) { result = simplified; high = tolerance; }
    else low = tolerance;
  }
  return result;
}

function regionFor(point: Coordinate): string {
  if (point.lon >= -80.6 && point.lon <= -74.5 && point.lat >= 39.7 && point.lat <= 42.6) return "Pennsylvania";
  if (point.lon >= -75.6 && point.lon <= -73.8 && point.lat >= 38.8 && point.lat <= 41.4) return "New Jersey";
  if (point.lon >= -80 && point.lon <= -71.7 && point.lat >= 40.4 && point.lat <= 45.2) return "New York";
  return "Region not identified";
}

function hasProvenance(input: CatalogBuildInput): boolean {
  return Boolean(input.sourceProject?.trim() || input.sourceFile?.trim());
}

interface CleanedTitle {
  readonly name: string;
  readonly author?: string;
  readonly site?: string;
  readonly generated: boolean;
  readonly original: string;
}

function cleanTitle(input: CatalogBuildInput, distanceMiles: number, geometry: readonly Coordinate[]): CleanedTitle {
  const original = input.name.trim() || "Untitled route";
  let name = original;
  let author = input.author?.trim();
  let site: string | undefined;
  const createdBy = /^(.*?)\s+-\s+created by\s+(.+)$/i.exec(name);
  if (createdBy !== null) {
    name = createdBy[1]!.trim();
    const sourceAttribution = createdBy[2]!.trim();
    const onSite = /^(.*?)\s+on\s+(.+)$/i.exec(sourceAttribution);
    author = onSite?.[1]?.trim() || sourceAttribution;
    site = onSite?.[2]?.trim();
  }
  if (author !== undefined) {
    const onSite = /^(.*?)\s+on\s+(.+)$/i.exec(author);
    if (onSite !== null) {
      author = onSite[1]!.trim();
      site ??= onSite[2]!.trim();
    }
  }
  name = name
    .replace(/^\s*\d{1,6}\s+/, "")
    .replace(/\s+(?:0?[1-9]|1[0-2])[-_/]\d{4}\s*$/, "")
    .replace(/\s+\d{4}[-_/](?:0?[1-9]|1[0-2])\s*$/, "")
    .trim();
  const machineName = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/i.test(name)
    || /^(?:track|route|recording)[_ -]?\d+(?:\.[a-z0-9]+)?$/i.test(name)
    || /^(?:imported gpx|track|untitled|unknown|unnamed|new track)(?:\s*\d+)?$/i.test(name)
    || name.length === 0;
  const generated = machineName;
  if (generated) {
    const first = geometry[0]!;
    const last = geometry.at(-1)!;
    const closed = segmentMeters(first, last) <= Math.max(250, distanceMiles * 1_609.344 * 0.01);
    const place = input.startPlaceName?.trim() || regionFor(first);
    name = `${place} ${closed ? "loop" : "one-way"} · ${Math.round(distanceMiles)} mi`;
  }
  return {
    name: name || "Untitled route",
    ...(author ? { author } : {}),
    ...(site ? { site } : {}),
    generated,
    original,
  };
}

function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sampleLine(points: readonly Coordinate[], count = 24): readonly Coordinate[] {
  if (points.length <= 1) return points;
  const lengths = points.slice(1).map((point, index) => segmentMeters(points[index]!, point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return Array.from({ length: count }, () => points[0]!);
  return Array.from({ length: count }, (_, sampleIndex) => {
    const target = total * sampleIndex / (count - 1);
    let covered = 0;
    for (let index = 0; index < lengths.length; index += 1) {
      const length = lengths[index]!;
      if (covered + length >= target || index === lengths.length - 1) {
        const ratio = length <= 0 ? 0 : Math.max(0, Math.min(1, (target - covered) / length));
        const start = points[index]!;
        const end = points[index + 1]!;
        return { lat: start.lat + (end.lat - start.lat) * ratio, lon: start.lon + (end.lon - start.lon) * ratio };
      }
      covered += length;
    }
    return points.at(-1)!;
  });
}

function pointToSegmentMeters(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const scaleY = EARTH_RADIUS_METERS * Math.PI / 180;
  const cosLatitude = Math.cos(radians((point.lat + start.lat + end.lat) / 3));
  const scaleX = scaleY * cosLatitude;
  const px = point.lon * scaleX;
  const py = point.lat * scaleY;
  const sx = start.lon * scaleX;
  const sy = start.lat * scaleY;
  const dx = (end.lon - start.lon) * scaleX;
  const dy = (end.lat - start.lat) * scaleY;
  const squaredLength = dx * dx + dy * dy;
  const fraction = squaredLength === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / squaredLength));
  return Math.hypot(px - (sx + fraction * dx), py - (sy + fraction * dy));
}

function linesNear(
  first: CatalogBuildRecord,
  second: CatalogBuildRecord,
  a: readonly Coordinate[],
  b: readonly Coordinate[],
): boolean {
  const maxMeters = Math.max(first.distanceMiles, second.distanceMiles) * 1_609.344;
  if (Math.abs(first.distanceMiles - second.distanceMiles) * 1_609.344 > maxMeters * 0.05) return false;
  const threshold = Math.max(50, Math.min(150, maxMeters * 0.05));
  const directedHausdorffWithin = (from: readonly Coordinate[], to: readonly Coordinate[]): boolean => {
    for (const point of from) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 1; index < to.length; index += 1) {
        nearest = Math.min(nearest, pointToSegmentMeters(point, to[index - 1]!, to[index]!));
        if (nearest <= threshold) break;
      }
      if (nearest > threshold) return false;
    }
    return true;
  };
  return directedHausdorffWithin(a, b) && directedHausdorffWithin(b, a);
}

class DisjointSets {
  private readonly parent: number[];
  public constructor(size: number) { this.parent = Array.from({ length: size }, (_, index) => index); }
  public find(value: number): number {
    const parent = this.parent[value]!;
    if (parent !== value) this.parent[value] = this.find(parent);
    return this.parent[value]!;
  }
  public join(first: number, second: number): void {
    const a = this.find(first);
    const b = this.find(second);
    if (a !== b) this.parent[Math.max(a, b)] = Math.min(a, b);
  }
}

function stableGroupId(prefix: string, records: readonly CatalogBuildRecord[]): string {
  return `${prefix}:${records.map((record) => record.id).sort((a, b) => a.localeCompare(b))[0]}`;
}

export function buildCatalogRecords(inputs: readonly CatalogBuildInput[]): readonly CatalogBuildRecord[] {
  const records = inputs.flatMap((input) => {
    if (input.redistribution?.toLowerCase() === "forbidden" || !hasProvenance(input)) return [];
    const fullGeometry = input.geometry === undefined
      ? parseGeometry(input.gpx)
      : input.geometry.flatMap(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)
        && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [{ lat, lon }] : []);
    if (fullGeometry.length < 2) return [];
    const distance = distanceMeters(fullGeometry);
    if (!Number.isFinite(distance) || distance <= 0) return [];
    const firstPoint = fullGeometry[0]!;
    const extent = fullGeometry.reduce((bounds, point) => ({
      west: Math.min(bounds.west, point.lon),
      south: Math.min(bounds.south, point.lat),
      east: Math.max(bounds.east, point.lon),
      north: Math.max(bounds.north, point.lat),
    }), { west: firstPoint.lon, south: firstPoint.lat, east: firstPoint.lon, north: firstPoint.lat });
    const provenance = [input.sourceProject?.trim(), input.sourceFile?.trim()].filter(Boolean).join(" · ");
    const title = cleanTitle(input, distance / 1609.344, fullGeometry);
    const attribution = [title.author ? `Author: ${title.author}` : undefined,
      title.site ? `Source site: ${title.site}` : undefined,
      input.license?.trim() ? `License: ${input.license.trim()}` : "License: not specified by the source"].filter(Boolean).join(" · ");
    const provenanceDetail = [attribution, title.original !== title.name ? `Original title: ${title.original}` : undefined]
      .filter(Boolean).join(" · ");
    return [{
      id: input.id,
      name: title.name,
      region: regionFor(fullGeometry[0]!),
      summary: input.summary?.trim() || `${Math.round(distance / 1609.344)} mi route`,
      distanceMiles: distance / 1609.344,
      bounds: extent,
      geometry: preview(fullGeometry),
      geometryPolyline: encodeCatalogPolyline(fullGeometry),
      provenance,
      provenanceDetail,
      evidenceNote: input.evidenceNote ?? "Road surface and curvature have not been measured for this catalog route.",
      ...(input.surfaceSummary === undefined ? {} : { surfaceSummary: input.surfaceSummary }),
      ...(input.curvatureSummary === undefined ? {} : { curvatureSummary: input.curvatureSummary }),
      catalogGroupId: "",
      trackGroupId: "",
      ...(input.trackLabel !== undefined
        ? (input.trackLabel === null ? {} : { trackLabel: input.trackLabel })
        : input.id.match(/--t(\d+)$/i)?.[1] === undefined ? {} : { trackLabel: `Track ${input.id.match(/--t(\d+)$/i)![1]}` }),
      nameIsGenerated: title.generated,
      ...(input.story === undefined ? {} : { story: input.story }),
    }];
  });
  const catalogSets = new DisjointSets(records.length);
  const trackSets = new DisjointSets(records.length);
  const byName = new Map<string, number>();
  const bySourceFile = new Map<string, number>();
  const byFamily = new Map<string, number>();
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const input = inputById.get(record.id);
    if (input === undefined) continue;
    const name = normalizedName(record.name);
    if (!record.nameIsGenerated && name.length > 0) {
      const previous = byName.get(name);
      if (previous === undefined) byName.set(name, index);
      else catalogSets.join(index, previous);
    }
    const sourceFile = input.sourceFile?.trim().toLowerCase();
    if (sourceFile) {
      const key = `${input.sourceProject?.trim().toLowerCase() ?? ""}/${sourceFile}`;
      const previous = bySourceFile.get(key);
      if (previous === undefined) bySourceFile.set(key, index);
      else catalogSets.join(index, previous);
    }
    if (input.duplicateFamilyId) {
      const previous = byFamily.get(input.duplicateFamilyId);
      if (previous === undefined) byFamily.set(input.duplicateFamilyId, index);
      else { catalogSets.join(index, previous); trackSets.join(index, previous); }
    }
  }
  const sampledLines = records.map((record) => sampleLine(record.geometry, 160));
  const nearPairs = new Set<number>();
  const pairKey = (first: number, second: number): number => Math.min(first, second) * records.length + Math.max(first, second);
  for (let first = 0; first < records.length; first += 1) {
    for (let second = first + 1; second < records.length; second += 1) {
      if (linesNear(records[first]!, records[second]!, sampledLines[first]!, sampledLines[second]!)) {
        nearPairs.add(pairKey(first, second));
      }
    }
  }
  // Require a counterpart for every track across two existing components. This
  // stops a chain of nearby roads from collapsing a whole region into one card.
  const canMergeSimilarComponents = (sets: DisjointSets, first: number, second: number): boolean => {
    const firstRoot = sets.find(first);
    const secondRoot = sets.find(second);
    if (firstRoot === secondRoot) return false;
    const left = records.flatMap((_, index) => sets.find(index) === firstRoot ? [index] : []);
    const right = records.flatMap((_, index) => sets.find(index) === secondRoot ? [index] : []);
    const allLeftMatched = left.every((leftIndex) => right.some((rightIndex) => nearPairs.has(pairKey(leftIndex, rightIndex))));
    const allRightMatched = right.every((rightIndex) => left.some((leftIndex) => nearPairs.has(pairKey(leftIndex, rightIndex))));
    return allLeftMatched && allRightMatched;
  };
  for (const key of nearPairs) {
    const first = Math.floor(key / records.length);
    const second = key % records.length;
    if (canMergeSimilarComponents(catalogSets, first, second)) catalogSets.join(first, second);
    if (canMergeSimilarComponents(trackSets, first, second)) trackSets.join(first, second);
  }
  const catalogGroups = new Map<number, CatalogBuildRecord[]>();
  const trackGroups = new Map<number, CatalogBuildRecord[]>();
  records.forEach((record, index) => {
    const catalogRoot = catalogSets.find(index);
    const trackRoot = trackSets.find(index);
    catalogGroups.set(catalogRoot, [...(catalogGroups.get(catalogRoot) ?? []), record]);
    trackGroups.set(trackRoot, [...(trackGroups.get(trackRoot) ?? []), record]);
  });
  return records.map((record, index) => ({
    ...record,
    catalogGroupId: stableGroupId("catalog", catalogGroups.get(catalogSets.find(index))!),
    trackGroupId: stableGroupId("track", trackGroups.get(trackSets.find(index))!),
  }));
}
