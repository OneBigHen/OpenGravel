import type { Coordinate } from "../../../src/domain/ride/types";
import { haversine } from "../../../src/domain/geometry/analysis";
import { linesFromGeometry, pointFromGeometry } from "./geometry";
import { textTag, type OsmFeature } from "./osm-input";
import type { AlongTrailFeature, TrailFeatureKind } from "./rich-types";
import type { TrailSource } from "./types";
import { SegmentGrid, segmentMatch, segments } from "./spatial";

export function osmSource(properties: Record<string, unknown>): TrailSource {
  const type = properties["@type"] ?? properties.type;
  const raw = properties["@id"] ?? properties.id;
  const recordId = `${type}/${raw}`;
  return { sourceId: "osm", sourceLabel: "OpenStreetMap", recordId, url: `https://www.openstreetmap.org/${recordId}`, licence: "ODbL 1.0", licenceUrl: "https://www.openstreetmap.org/copyright" };
}
export function featureKind(p: Record<string, unknown>): TrailFeatureKind | null {
  if (p.waterway === "waterfall" || p.natural === "waterfall") return "waterfall";
  if (p.tourism === "viewpoint") return "viewpoint";
  if (p.natural === "peak") return "peak";
  if (p["tower:type"] === "observation" || p["tower:type"] === "watchtower" || p["tower:type"] === "fire") return "fire-tower";
  if (p.natural === "water" || p.waterway === "river") return "water";
  if (p.natural === "cave_entrance") return "cave";
  if (p.historic && p.historic !== "no") return "historic";
  if (p.amenity === "shelter" || p.tourism === "wilderness_hut" || p.tourism === "alpine_hut") return "shelter";
  if (p.tourism === "camp_site" || p.tourism === "camp_pitch") return "campsite";
  if (p.amenity === "drinking_water" || p.drinking_water === "yes") return "drinking-water";
  if (p.amenity === "toilets") return "toilets";
  if (p.highway === "trailhead") return "trailhead";
  if (p.amenity === "parking") return "parking";
  return null;
}
export function geometryLines(geometry: unknown): readonly (readonly Coordinate[])[] {
  const point = pointFromGeometry(geometry);
  if (point) return [[point]];
  if (typeof geometry !== "object" || !geometry) return [];
  const g = geometry as { type: string; coordinates: unknown };
  if (g.type === "Polygon") return linesFromGeometry({ type: "MultiLineString", coordinates: g.coordinates });
  if (g.type === "MultiPolygon") return (g.coordinates as unknown[]).flatMap(c => linesFromGeometry({ type: "MultiLineString", coordinates: c }));
  return linesFromGeometry(geometry);
}
type Candidate = Omit<AlongTrailFeature, "coordinate" | "distanceAlongMeters" | "distanceFromTrailMeters" | "lineIndex">;
export function featureGrid(features: readonly OsmFeature[]): SegmentGrid<Candidate> {
  const grid = new SegmentGrid<Candidate>();
  const seen = new Set<string>();
  for (const feature of features) {
    const kind = featureKind(feature.properties);
    if (!kind) continue;
    const source = osmSource(feature.properties), id = `osm:${source.recordId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const candidate: Candidate = { id, kind, name: textTag(feature.properties,"name"), source,
      ...(textTag(feature.properties,"wikipedia") ? { wikipedia: textTag(feature.properties,"wikipedia")! } : {}),
      ...(textTag(feature.properties,"wikidata") ? { wikidata: textTag(feature.properties,"wikidata")! } : {}) };
    for (const segment of segments(geometryLines(feature.geometry))) grid.add(segment,candidate);
  }
  return grid;
}
export function alongTrailFeatures(lines: readonly (readonly Coordinate[])[], grid: SegmentGrid<Candidate>): AlongTrailFeature[] {
  const found = new Map<string, AlongTrailFeature>();
  let along = 0;
  lines.forEach((line,lineIndex) => {
    line.slice(1).forEach((b,i) => {
      const a = line[i]!, length = haversine(a,b);
      for (const { segment, value } of grid.near([a,b])) {
        const match = segmentMatch([a,b], segment);
        if (match.distance > 100) continue;
        const previous = found.get(value.id);
        if (previous && previous.distanceFromTrailMeters <= match.distance) continue;
        found.set(value.id, { ...value, coordinate: match.coordinate, distanceAlongMeters: Math.round(along + length*match.t), distanceFromTrailMeters: match.distance, lineIndex });
      }
      along += length;
    });
  });
  return [...found.values()].map(f => ({...f, distanceFromTrailMeters: Math.round(f.distanceFromTrailMeters)})).sort((a,b) => a.distanceAlongMeters-b.distanceAlongMeters || a.id.localeCompare(b.id));
}
