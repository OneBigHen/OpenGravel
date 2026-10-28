/**
 * Output shapes for the trail catalog job: `trails.geojson` for the map and
 * `hikes.json` for the API and Explore.
 *
 * Both are deterministic — no build clock, no random ids — so the same inputs
 * always produce identical bytes and a rebuild diff only shows real data
 * changes.
 */

import { bboxOf, linesLengthMeters, longestLine } from "./geometry";
import { classifyShape } from "../../../src/domain/hike/shape";
import type { Coordinate } from "../../../src/domain/ride/types";
import type {
  HikeCatalog,
  HikeRecord,
  Trail,
  TrailFeature,
  TrailFeatureCollection,
  TrailSourceId,
  TrailMeasurements,
} from "./types";

const UNKNOWN_MEASUREMENTS: TrailMeasurements = {
  elevationGainMeters: null, elevationLossMeters: null, maxGradePercent: null,
  toblerMinutes: null, elevationMeasuredShare: 0, elevationSource: null, timeMethod: null,
};

function coordinatesOf(lines: readonly (readonly Coordinate[])[]): readonly (readonly [number, number])[][] {
  return lines.map((line) => line.map((coordinate) => [coordinate.lon, coordinate.lat] as const));
}

export function toFeature(trail: Trail): TrailFeature {
  const lines = coordinatesOf(trail.lines);
  const geometry: TrailFeature["geometry"] =
    lines.length === 1 && lines[0] !== undefined
      ? { type: "LineString", coordinates: lines[0] }
      : { type: "MultiLineString", coordinates: lines };
  return {
    type: "Feature",
    id: trail.id,
    geometry,
    properties: {
      id: trail.id,
      name: trail.attributes.name,
      ref: trail.attributes.ref,
      operator: trail.attributes.operator,
      sacScale: trail.attributes.sacScale,
      surface: trail.attributes.surface,
      trailVisibility: trail.attributes.trailVisibility,
      dog: trail.attributes.dog,
      access: trail.attributes.access,
      lengthMeters: trail.lengthMeters,
      ...(trail.measurements ?? UNKNOWN_MEASUREMENTS),
      sources: trail.sources,
      conflicts: trail.conflicts,
      trailheads: trail.trailheads,
    },
  };
}

export function toFeatureCollection(trails: readonly Trail[]): TrailFeatureCollection {
  return { type: "FeatureCollection", features: trails.map(toFeature) };
}

function endsOf(trail: Trail): { start: Coordinate; end: Coordinate } | null {
  const line = longestLine(trail.lines);
  if (line === null) return null;
  const start = line[0];
  const end = line[line.length - 1];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

export function toHikeRecord(trail: Trail): HikeRecord | null {
  const ends = endsOf(trail);
  if (ends === null) return null;
  return {
    id: trail.id,
    name: trail.attributes.name,
    ref: trail.attributes.ref,
    operator: trail.attributes.operator,
    lengthMeters: Math.round(linesLengthMeters(trail.lines)),
    sacScale: trail.attributes.sacScale,
    surface: trail.attributes.surface,
    trailVisibility: trail.attributes.trailVisibility,
    dog: trail.attributes.dog,
    access: trail.attributes.access,
    bbox: bboxOf(trail.lines),
    start: ends.start,
    end: ends.end,
    shape: trail.lines.length === 1 && trail.lines[0] ? classifyShape(trail.lines[0]).shape : "unknown",
    trailheadCount: trail.trailheads.length,
    trailheads: trail.trailheads,
    sources: trail.sources,
    ...(trail.measurements ?? UNKNOWN_MEASUREMENTS),
  };
}

export function toHikeCatalog(trails: readonly Trail[]): HikeCatalog {
  const hikes = trails.flatMap((trail) => {
    const record = toHikeRecord(trail);
    return record === null ? [] : [record];
  });
  const bySource: Record<TrailSourceId, number> = { osm: 0, usfs: 0, nps: 0 };
  for (const trail of trails) {
    for (const sourceId of new Set(trail.sources.map((source) => source.sourceId))) {
      bySource[sourceId] += 1;
    }
  }
  return {
    version: 1,
    counts: {
      trails: trails.length,
      bySource,
      withTrailhead: trails.filter((trail) => trail.trailheads.length > 0).length,
      merged: trails.filter((trail) => trail.sources.length > 1).length,
    },
    hikes,
  };
}

/** Stable, human-readable JSON: two-space indent and a trailing newline. */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
