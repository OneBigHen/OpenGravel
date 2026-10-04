#!/usr/bin/env node

/**
 * Build Gravel Atlas v3 from the exact GraphHopper PBF. `osmium export`
 * produces GeoJSON sequence records so the PBF is streamed and never loaded
 * into this process. A small JSON/NDJSON fixture is also accepted for tests.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

import { analyzeFrancoCurvature } from "../src/domain/geometry/franco-curvature";
import { haversine } from "../src/domain/geometry/analysis";
import type { Coordinate } from "../src/domain/ride/types";

type Kind = "dirt" | "backroad";

interface Feature {
  readonly geometry?: { readonly type?: string; readonly coordinates?: unknown };
  readonly properties?: Record<string, unknown>;
}

interface Way {
  readonly id: string;
  readonly kind: Kind;
  readonly roadKey: string;
  readonly line: readonly Coordinate[];
  readonly startKey: string;
  readonly endKey: string;
  readonly lengthMeters: number;
  readonly reversible: boolean;
  readonly gradeMix: Readonly<Record<string, number>>;
  readonly maxTrackGrade: number | null;
  readonly sandShare: number;
  readonly legalConfidence: number;
  readonly unknownRestrictionFlags: readonly string[];
  readonly closed: boolean;
  readonly seasonalClosed: boolean;
  readonly seasonalFlags: readonly string[];
  readonly areaHints: readonly string[];
}

interface Corridor {
  readonly id: string;
  readonly sourceIds: readonly string[];
  readonly kind: Kind;
  readonly line: readonly Coordinate[];
  readonly lengthMeters: number;
  readonly reversible: boolean;
  readonly gradeMix: Readonly<Record<string, number>>;
  readonly maxTrackGrade: number | null;
  readonly sandShare: number;
  readonly legalConfidence: number;
  readonly unknownRestrictionFlags: readonly string[];
  readonly closed: boolean;
  readonly seasonalClosed: boolean;
  readonly seasonalFlags: readonly string[];
  readonly areaHints: readonly string[];
}

const DIRT_SURFACES = new Set(["gravel", "fine_gravel", "compacted", "dirt", "ground", "unpaved", "earth"]);
const EXCLUDED_HIGHWAYS = new Set(["path", "footway", "cycleway", "bridleway"]);
const BACKROAD_HIGHWAYS = new Set(["unclassified", "tertiary", "residential"]);
const AREA_BOUNDS: Readonly<Record<string, { west: number; south: number; east: number; north: number }>> = {
  michaux: { west: -77.7, south: 39.65, east: -77.0, north: 40.2 },
  rothrock: { west: -78.5, south: 40.45, east: -77.3, north: 41.15 },
  tiadaghton: { west: -77.8, south: 40.8, east: -76.7, north: 41.7 },
  wharton: { west: -75.0, south: 39.55, east: -74.3, north: 40.15 },
  delaware: { west: -75.4, south: 40.75, east: -74.7, north: 41.65 },
  "hickory-run": { west: -75.9, south: 40.8, east: -75.3, north: 41.2 },
};
const controlPoints: Coordinate[] = [];

function args(): { input: string; output: string } {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key?.startsWith("--") && value !== undefined) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  return {
    input: values.get("input") ?? "/root/Vibe/switchback/data/pa-nj-motorcycle.osm.pbf",
    output: values.get("output") ?? "/tmp/ogv-gravel-atlas-v3.sqlite",
  };
}

function text(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function coordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number") return null;
  return { lon: value[0], lat: value[1] };
}

function lineFromFeature(feature: Feature): readonly Coordinate[] {
  if (feature.geometry?.type !== "LineString" || !Array.isArray(feature.geometry.coordinates)) return [];
  return feature.geometry.coordinates.flatMap((point) => {
    const parsed = coordinate(point);
    return parsed === null ? [] : [parsed];
  });
}

function endpointKey(point: Coordinate): string {
  return `${point.lon.toFixed(5)},${point.lat.toFixed(5)}`;
}

function boundsOverlap(point: Coordinate, bounds: { west: number; south: number; east: number; north: number }): boolean {
  return point.lon >= bounds.west && point.lon <= bounds.east && point.lat >= bounds.south && point.lat <= bounds.north;
}

function areaHints(line: readonly Coordinate[]): readonly string[] {
  const middle = line[Math.floor(line.length / 2)];
  if (middle === undefined) return [];
  return Object.entries(AREA_BOUNDS).flatMap(([name, bounds]) => boundsOverlap(middle, bounds) ? [name] : []);
}

function accessDecision(properties: Record<string, unknown>): { legal: boolean; confidence: number; unknown: string[] } {
  const unknown: string[] = [];
  let confidence = 0.85;
  for (const key of ["access", "motor_vehicle", "motorcycle"]) {
    const value = text(properties, key);
    if (["no", "private"].includes(value)) return { legal: false, confidence: 0, unknown };
    if (value === "" || ["yes", "permissive", "destination"].includes(value)) continue;
    if (["customers", "agricultural", "forestry", "delivery", "unknown"].includes(value)) {
      unknown.push(`${key}=${value}`);
      confidence -= 0.12;
    }
  }
  return { legal: true, confidence: Math.max(0.25, confidence), unknown };
}

function classify(feature: Feature): Way | null {
  const properties = feature.properties ?? {};
  const line = lineFromFeature(feature);
  if (line.length < 2) return null;
  const highway = text(properties, "highway");
  if (highway === "") return null;
  const motorcycle = text(properties, "motorcycle");
  if (EXCLUDED_HIGHWAYS.has(highway) && motorcycle !== "yes") return null;
  const access = accessDecision(properties);
  if (!access.legal) return null;
  const surface = text(properties, "surface");
  if (surface === "sand") return null;
  const trackType = text(properties, "tracktype");
  const trackGradeMatch = /^grade([1-5])$/.exec(trackType);
  const trackGrade = trackGradeMatch === null ? null : Number(trackGradeMatch[1]);
  const dirt = DIRT_SURFACES.has(surface) || (highway === "track" && trackGrade !== null && trackGrade <= 4);
  const curvedConnector = BACKROAD_HIGHWAYS.has(highway) && !dirt;
  if (!dirt && !curvedConnector) return null;
  const lengthMeters = line.slice(0, -1).reduce((sum, point, index) => sum + haversine(point, line[index + 1] as Coordinate), 0);
  if (lengthMeters < 10) return null;
  const gradeMix = trackGrade === null ? {} : { [trackType]: lengthMeters };
  const closed = ["closed", "no"].includes(text(properties, "seasonal")) || text(properties, "access:conditional").includes("no");
  const seasonalFlags = ["seasonal", "access:conditional", "motor_vehicle:conditional"].flatMap((key) => {
    const value = text(properties, key);
    return value === "" ? [] : [`${key}=${value}`];
  });
  const seasonalClosed = seasonalFlags.some((flag) => /closed|no|winter|nov|dec|jan|feb|mar/i.test(flag));
  return {
    id: String(properties["@id"] ?? properties["id"] ?? "way-unknown"),
    kind: dirt ? "dirt" : "backroad",
    roadKey: [highway, text(properties, "ref"), text(properties, "name"), text(properties, "oneway")].join("|") ,
    line,
    startKey: endpointKey(line[0] as Coordinate),
    endKey: endpointKey(line[line.length - 1] as Coordinate),
    lengthMeters,
    reversible: text(properties, "oneway") === "no",
    gradeMix,
    maxTrackGrade: trackGrade,
    sandShare: 0,
    legalConfidence: access.confidence,
    unknownRestrictionFlags: access.unknown,
    closed,
    seasonalClosed,
    seasonalFlags,
    areaHints: areaHints(line),
  };
}

async function readFeatures(input: string, visit: (feature: Feature) => void): Promise<void> {
  if (/\.pbf$/i.test(input)) {
    const filtered = `/tmp/ogv-gravel-atlas-${process.pid}.osm.pbf`;
    const filter = spawn("osmium", ["tags-filter", "--overwrite", "-o", filtered, input, "w/highway"], { stdio: ["ignore", "ignore", "inherit"] });
    await new Promise<void>((resolvePromise, reject) => filter.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`osmium tags-filter exited ${code ?? "unknown"}`))));
    try {
      const child = spawn("osmium", ["export", "-f", "geojsonseq", "--geometry-types=linestring", "-a", "id,type", "--no-progress", filtered], { stdio: ["ignore", "pipe", "inherit"] });
      const lines = createInterface({ input: child.stdout });
      for await (const line of lines) {
        if (line.trim() === "") continue;
        // GeoJSON sequence uses an ASCII record separator before each object.
        try { visit(JSON.parse(line.replace(/^\u001e/, "")) as Feature); } catch { /* skip malformed source records */ }
      }
      await new Promise<void>((resolvePromise, reject) => child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`osmium export exited ${code ?? "unknown"}`))));
      const points = spawn("osmium", ["export", "-f", "geojsonseq", "--geometry-types=point", "-a", "id,type", "--no-progress", filtered], { stdio: ["ignore", "pipe", "inherit"] });
      const pointLines = createInterface({ input: points.stdout });
      for await (const line of pointLines) {
        if (line.trim() === "") continue;
        try {
          const feature = JSON.parse(line.replace(/^\u001e/, "")) as Feature;
          const properties = feature.properties ?? {};
          const reason = ["highway", "junction", "crossing", "traffic_calming", "barrier", "traffic_signals"].some((key) => text(properties, key) !== "");
          const point = coordinate(feature.geometry?.coordinates);
          if (reason && point !== null) controlPoints.push(point);
        } catch { /* skip malformed source records */ }
      }
      await new Promise<void>((resolvePromise, reject) => points.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`osmium point export exited ${code ?? "unknown"}`))));
    } finally {
      if (existsSync(filtered)) unlinkSync(filtered);
    }
    return;
  }
  const raw = readFileSync(input, "utf8").trim();
  if (raw === "") return;
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) for (const feature of parsed) if (typeof feature === "object" && feature !== null) visit(feature as Feature);
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try { visit(JSON.parse(line) as Feature); } catch { /* skip malformed fixture records */ }
  }
}

function appendLine(base: Coordinate[], line: readonly Coordinate[], reverse: boolean): void {
  const points = reverse ? [...line].reverse() : line;
  const first = points[0];
  if (first !== undefined && base.length > 0 && endpointKey(base[base.length - 1] as Coordinate) === endpointKey(first)) base.push(...points.slice(1));
  else base.push(...points);
}

function mergeWays(ways: readonly Way[]): readonly Corridor[] {
  const endpointWays = new Map<string, number[]>();
  ways.forEach((way, index) => {
    for (const key of [way.startKey, way.endKey]) endpointWays.set(key, [...(endpointWays.get(key) ?? []), index]);
  });
  const parent = ways.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index] as number));
  const union = (left: number, right: number): void => { const a = find(left), b = find(right); if (a !== b) parent[b] = a; };
  for (const indices of endpointWays.values()) for (let index = 1; index < indices.length; index += 1) {
    const left = indices[0] as number;
    const right = indices[index] as number;
    if (ways[left]?.kind === ways[right]?.kind && ways[left]?.roadKey === ways[right]?.roadKey) union(left, right);
  }
  const groups = new Map<number, number[]>();
  ways.forEach((_, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), index]));
  const corridors: Corridor[] = [];
  for (const [root, indices] of groups) {
    const members = indices.map((index) => ways[index] as Way);
    const byEndpoint = new Map<string, Way[]>();
    for (const way of members) for (const key of [way.startKey, way.endKey]) byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), way]);
    const endpoints = [...byEndpoint.entries()].filter(([, values]) => values.length === 1);
    const first = endpoints[0]?.[1][0] ?? members[0];
    if (first === undefined) continue;
    const used = new Set<string>();
    const line: Coordinate[] = [];
    let current: Way | undefined = first;
    let currentKey = endpoints[0]?.[0] ?? first.startKey;
    while (current !== undefined && !used.has(current.id)) {
      used.add(current.id);
      const reverse = current.startKey !== currentKey;
      appendLine(line, current.line, reverse);
      const nextKey: string = reverse ? current.startKey : current.endKey;
      const next = (byEndpoint.get(nextKey) ?? []).find((candidate) => !used.has(candidate.id));
      current = next;
      currentKey = nextKey;
    }
    for (const member of members) if (!used.has(member.id)) appendLine(line, member.line, false);
    const lengthMeters = members.reduce((sum, member) => sum + member.lengthMeters, 0);
    const gradeMix: Record<string, number> = {};
    for (const member of members) for (const [grade, length] of Object.entries(member.gradeMix)) gradeMix[grade] = (gradeMix[grade] ?? 0) + length;
    corridors.push({
      id: `ga3-${members.map((member) => member.id).sort().join("-")}-${root}`,
      sourceIds: members.map((member) => member.id).sort(),
      kind: members[0]?.kind ?? "dirt",
      line,
      lengthMeters,
      reversible: members.every((member) => member.reversible),
      gradeMix,
      maxTrackGrade: Math.max(...members.flatMap((member) => member.maxTrackGrade === null ? [] : [member.maxTrackGrade]), 0) || null,
      sandShare: members.reduce((sum, member) => sum + member.sandShare * member.lengthMeters, 0) / Math.max(1, lengthMeters),
      legalConfidence: members.reduce((sum, member) => sum + member.legalConfidence * member.lengthMeters, 0) / Math.max(1, lengthMeters),
      unknownRestrictionFlags: [...new Set(members.flatMap((member) => member.unknownRestrictionFlags))],
      closed: members.some((member) => member.closed),
      seasonalClosed: members.some((member) => member.seasonalClosed),
      seasonalFlags: [...new Set(members.flatMap((member) => member.seasonalFlags))],
      areaHints: [...new Set(members.flatMap((member) => member.areaHints))],
    });
  }
  return corridors;
}

function createSchema(database: DatabaseSync): void {
  database.exec(`pragma user_version = 3;
    create table corridors (
      id text primary key, kind text not null, geometry_json text not null,
      reversible integer not null,
      west real not null, south real not null, east real not null, north real not null,
      length_meters real not null, longest_dirt_run_meters real not null,
      bend_share real not null, franco_score real not null, curvature_per_km real not null,
      quality real not null, grade_mix_json text not null, max_track_grade integer,
      legal_confidence real not null, access_legal integer not null, sand_share real not null,
      unknown_restriction_flags_json text not null, closed integer not null,
      seasonal_closed integer not null, seasonal_flags_json text not null,
      source_ids_json text not null, area_hints_json text not null
    );
    create index corridors_bounds on corridors(kind, east, west, north, south);`);
}

function writeAtlas(output: string, corridors: readonly Corridor[]): void {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  if (existsSync(output)) unlinkSync(output);
  const database = new DatabaseSync(output);
  createSchema(database);
  const insert = database.prepare(`insert into corridors values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  database.exec("begin");
  try {
    for (const corridor of corridors) {
      const analysis = analyzeFrancoCurvature(corridor.line);
      const minLon = Math.min(...corridor.line.map((point) => point.lon));
      const maxLon = Math.max(...corridor.line.map((point) => point.lon));
      const minLat = Math.min(...corridor.line.map((point) => point.lat));
      const maxLat = Math.max(...corridor.line.map((point) => point.lat));
      const quality = Math.max(0, Math.min(1, corridor.legalConfidence * (0.35 + Math.min(0.35, analysis.bendShare) + Math.min(0.3, corridor.lengthMeters / 20_000))));
      insert.run(
        corridor.id, corridor.kind, JSON.stringify(corridor.line), corridor.reversible ? 1 : 0, minLon, minLat, maxLon, maxLat,
        corridor.lengthMeters, corridor.kind === "dirt" ? corridor.lengthMeters : 0,
        analysis.bendShare, analysis.totalCurvature, analysis.curvaturePerKm, quality,
        JSON.stringify(corridor.gradeMix), corridor.maxTrackGrade,
        corridor.legalConfidence, 1, corridor.sandShare,
        JSON.stringify(corridor.unknownRestrictionFlags), corridor.closed ? 1 : 0,
        corridor.seasonalClosed ? 1 : 0, JSON.stringify(corridor.seasonalFlags),
        JSON.stringify(corridor.sourceIds), JSON.stringify(corridor.areaHints),
      );
    }
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const { input, output } = args();
  const ways: Way[] = [];
  let seen = 0;
  await readFeatures(input, (feature) => {
    seen += 1;
    const way = classify(feature);
    if (way !== null) ways.push(way);
  });
  const corridors = mergeWays(ways);
  writeAtlas(output, corridors);
  const counts = corridors.reduce((result, corridor) => ({ ...result, [corridor.kind]: (result[corridor.kind] ?? 0) + 1 }), {} as Record<string, number>);
  const areas = Object.fromEntries(Object.keys(AREA_BOUNDS).map((area) => [area, corridors.filter((corridor) => corridor.areaHints.includes(area)).length]));
  console.log(JSON.stringify({ input, output, seenFeatures: seen, selectedWays: ways.length, corridors: corridors.length, counts, knownAreas: areas }, null, 2));
}

void main();
