#!/usr/bin/env node

/**
 * Build Gravel Atlas v3 from the exact GraphHopper PBF. Two input shapes:
 *  - a `.pbf`, streamed through `osmium export` (needs osmium-tool), or
 *  - NDJSON/JSON GeoJSON features (LineString ways with OSM tags as
 *    properties, Point control nodes), as produced by
 *    `scripts/extract-gravel-atlas-ways.py` or the tiny test fixture.
 * Ways are chained through continuous road nodes into corridors, each scored
 * with the Franco curvature method (paved backroads and dirt alike).
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
  /** Other drivable ways meeting the start and end node; null when the source did not say. */
  readonly links: readonly [number, number] | null;
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
  /** Other drivable ways at the corridor's first and last point; null when unknown. */
  readonly links: readonly [number, number] | null;
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
const PAVED_SURFACES = new Set(["asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone", "unhewn_cobblestone", "bricks", "chipseal", "metal"]);
/** Surfaces a motorcycle should never be sent onto, however the way is tagged. */
const HOSTILE_SURFACES = new Set(["sand", "mud", "grass", "rock", "snow", "ice", "woodchips", "wood", "stepping_stones", "grass_paver"]);
const HOSTILE_SMOOTHNESS = new Set(["very_horrible", "horrible", "very_bad", "impassable"]);
const CONTROL_HIGHWAY_VALUES = new Set(["stop", "give_way", "traffic_signals", "crossing", "mini_roundabout", "speed_camera"]);
/** Longest corridor; longer chains are cut so one span stays routable. */
const MAX_CORRIDOR_METERS = 25_000;
const MIN_DIRT_CORRIDOR_METERS = 500;
const MIN_BACKROAD_CORRIDOR_METERS = 2_000;
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
const CONTROL_CELL_DEGREES = 0.001;
/** Franco suppression nodes (stop, signal, crossing, calming, barrier, ...) in a coarse grid. */
const controlGrid = new Map<string, Coordinate[]>();

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function addControlPoint(feature: Feature): void {
  if (feature.geometry?.type !== "Point") return;
  const properties = feature.properties ?? {};
  const reason = CONTROL_HIGHWAY_VALUES.has(text(properties, "highway")) || ["crossing", "traffic_calming", "barrier", "junction"].some((key) => text(properties, key) !== "");
  const point = coordinate(feature.geometry.coordinates);
  if (!reason || point === null) return;
  const key = cellKey(Math.floor(point.lon / CONTROL_CELL_DEGREES), Math.floor(point.lat / CONTROL_CELL_DEGREES));
  const cell = controlGrid.get(key);
  if (cell === undefined) controlGrid.set(key, [point]);
  else cell.push(point);
}

function controlPointsNear(line: readonly Coordinate[]): readonly Coordinate[] {
  const keys = new Set<string>();
  for (const point of line) {
    const x = Math.floor(point.lon / CONTROL_CELL_DEGREES);
    const y = Math.floor(point.lat / CONTROL_CELL_DEGREES);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) keys.add(cellKey(x + dx, y + dy));
  }
  return [...keys].flatMap((key) => controlGrid.get(key) ?? []);
}

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

/**
 * NJ Pine Barrens (Wharton) roads are mostly sugar sand, often tagged only
 * ground/dirt/unpaved. Inside that box only an explicit hard surface counts as
 * dirt a street bike can ride; the rest is flagged sandy and kept out.
 */
function pineBarrensSandRisk(line: readonly Coordinate[], surface: string): boolean {
  const middle = line[Math.floor(line.length / 2)];
  const bounds = AREA_BOUNDS["wharton"];
  if (middle === undefined || bounds === undefined || !boundsOverlap(middle, bounds)) return false;
  return !["gravel", "fine_gravel", "compacted"].includes(surface);
}

function linksOf(properties: Record<string, unknown>): readonly [number, number] | null {
  const value = properties["@links"];
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : null;
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

export function classify(feature: Feature): Way | null {
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
  if (HOSTILE_SURFACES.has(surface)) return null;
  if (HOSTILE_SMOOTHNESS.has(text(properties, "smoothness"))) return null;
  if (text(properties, "4wd_only") === "yes" || text(properties, "area") === "yes") return null;
  const trackType = text(properties, "tracktype");
  const trackGradeMatch = /^grade([1-5])$/.exec(trackType);
  const trackGrade = trackGradeMatch === null ? null : Number(trackGradeMatch[1]);
  // Grade 5 is an overgrown track, whatever surface it also carries.
  if (trackGrade === 5) return null;
  const paved = PAVED_SURFACES.has(surface);
  // Grade 1 is "solid, usually paved": a dirt corridor only when the surface says so.
  const trackIsDirt = highway === "track" && trackGrade !== null && trackGrade <= 4 && (trackGrade >= 2 || DIRT_SURFACES.has(surface));
  const dirt = !paved && (DIRT_SURFACES.has(surface) || trackIsDirt);
  const curvedConnector = BACKROAD_HIGHWAYS.has(highway) && !dirt && (surface === "" || paved) && text(properties, "junction") === "";
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
    roadKey: [text(properties, "ref"), text(properties, "name")].join("|"),
    line,
    startKey: endpointKey(line[0] as Coordinate),
    endKey: endpointKey(line[line.length - 1] as Coordinate),
    lengthMeters,
    links: linksOf(properties),
    reversible: !["yes", "1", "true", "-1", "reverse"].includes(text(properties, "oneway")),
    gradeMix,
    maxTrackGrade: trackGrade,
    sandShare: dirt && pineBarrensSandRisk(line, surface) ? 1 : 0,
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
        try { visit(JSON.parse(line.replace(/^\u001e/, "")) as Feature); } catch { /* skip malformed source records */ }
      }
      await new Promise<void>((resolvePromise, reject) => points.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`osmium point export exited ${code ?? "unknown"}`))));
    } finally {
      if (existsSync(filtered)) unlinkSync(filtered);
    }
    return;
  }
  if (/\.(ndjson|jsonl|geojsonl)$/i.test(input)) {
    // Real extracts are hundreds of MB: stream them line by line.
    for await (const line of createInterface({ input: createReadStream(input, "utf8") })) {
      if (line.trim() === "") continue;
      try { visit(JSON.parse(line) as Feature); } catch { /* skip malformed source records */ }
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

/**
 * Chain ways into continuous corridors. Two ways continue each other through a
 * shared node when they are the only two there (any name) or when, at a
 * junction, exactly two share a name/ref. Chains never branch, so a corridor
 * is always one rideable line, and long chains are cut at MAX_CORRIDOR_METERS.
 */
export /** Other drivable ways at the corridor's first and last point, in travel order. */
function endLinks(members: readonly Way[], flips: readonly boolean[]): readonly [number, number] | null {
  const first = members[0];
  const last = members[members.length - 1];
  if (first?.links === null || first === undefined || last?.links === null || last === undefined) return null;
  const entry = flips[0] === true ? first.links[1] : first.links[0];
  const exit = flips[flips.length - 1] === true ? last.links[0] : last.links[1];
  return [entry, exit];
}

export function mergeWays(ways: readonly Way[]): readonly Corridor[] {
  // Each way end is addressed as index*2 + end (0 = start, 1 = end).
  const nodeEnds = new Map<string, number[]>();
  ways.forEach((way, index) => {
    for (const [end, key] of [[0, way.startKey], [1, way.endKey]] as const) {
      const list = nodeEnds.get(key);
      if (list === undefined) nodeEnds.set(key, [index * 2 + end]);
      else list.push(index * 2 + end);
    }
  });
  const partner = new Map<number, number>();
  const pair = (left: number, right: number): void => {
    if (Math.floor(left / 2) === Math.floor(right / 2) || partner.has(left) || partner.has(right)) return;
    partner.set(left, right);
    partner.set(right, left);
  };
  for (const ends of nodeEnds.values()) {
    if (ends.length < 2) continue;
    if (ends.length === 2) {
      const [left, right] = ends as [number, number];
      if (ways[Math.floor(left / 2)]?.kind === ways[Math.floor(right / 2)]?.kind) pair(left, right);
      continue;
    }
    const byName = new Map<string, number[]>();
    for (const end of ends) {
      const way = ways[Math.floor(end / 2)] as Way;
      if (way.roadKey === "|") continue;
      const key = `${way.kind}|${way.roadKey}`;
      byName.set(key, [...(byName.get(key) ?? []), end]);
    }
    for (const group of byName.values()) if (group.length === 2) pair(group[0] as number, group[1] as number);
  }

  const visited = new Array<boolean>(ways.length).fill(false);
  const chains: number[][] = [];
  const walk = (startIndex: number, startEnd: number): void => {
    // Enter the way at `startEnd` and leave through the opposite end.
    const chain: number[] = [];
    const entries: number[] = [];
    let index = startIndex;
    let entry = startEnd;
    while (!visited[index]) {
      visited[index] = true;
      chain.push(index);
      entries.push(entry);
      const next = partner.get(index * 2 + (1 - entry));
      if (next === undefined) break;
      index = Math.floor(next / 2);
      entry = next % 2;
    }
    chains.push(chain.map((member, at) => member * 2 + (entries[at] as number)));
  };
  ways.forEach((_, index) => {
    if (visited[index]) return;
    // Start at a free end; the walk then runs the whole chain.
    if (!partner.has(index * 2)) walk(index, 0);
    else if (!partner.has(index * 2 + 1)) walk(index, 1);
  });
  // Whatever is left belongs to closed rings.
  ways.forEach((_, index) => { if (!visited[index]) walk(index, 0); });

  const corridors: Corridor[] = [];
  const emit = (members: readonly Way[], flips: readonly boolean[], line: readonly Coordinate[], serial: number): void => {
    const lengthMeters = members.reduce((sum, member) => sum + member.lengthMeters, 0);
    const kind = members[0]?.kind ?? "dirt";
    if (lengthMeters < (kind === "dirt" ? MIN_DIRT_CORRIDOR_METERS : MIN_BACKROAD_CORRIDOR_METERS)) return;
    const gradeMix: Record<string, number> = {};
    for (const member of members) for (const [grade, length] of Object.entries(member.gradeMix)) gradeMix[grade] = (gradeMix[grade] ?? 0) + length;
    const first = (members[0] as Way).id.replace(/^way\//, "");
    const last = (members[members.length - 1] as Way).id.replace(/^way\//, "");
    corridors.push({
      id: `ga3-${kind === "dirt" ? "d" : "b"}-${first}-${last}-${members.length}-${serial}`,
      sourceIds: members.map((member) => member.id),
      links: endLinks(members, flips),
      kind,
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
  };
  let serial = 0;
  for (const chain of chains) {
    let members: Way[] = [];
    let flips: boolean[] = [];
    let line: Coordinate[] = [];
    let length = 0;
    for (const code of chain) {
      const way = ways[Math.floor(code / 2)] as Way;
      if (members.length > 0 && length + way.lengthMeters > MAX_CORRIDOR_METERS) {
        emit(members, flips, line, serial);
        serial += 1;
        members = [];
        flips = [];
        line = [];
        length = 0;
      }
      members.push(way);
      flips.push(code % 2 === 1);
      length += way.lengthMeters;
      appendLine(line, way.line, code % 2 === 1);
    }
    if (members.length > 0) emit(members, flips, line, serial);
    serial += 1;
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
      source_ids_json text not null, area_hints_json text not null,
      entry_links integer, exit_links integer,
      routable integer, routed_meters real
    );
    create index corridors_bounds on corridors(kind, east, west, north, south);`);
}

/**
 * Corridor quality in 0..1: legal confidence times length (a corridor worth
 * the detour), Franco curvature per km, and how kind the track grades are.
 * Rough grade 3-4 track costs score because only dual-sport riders may use it.
 */
export function corridorQuality(input: {
  readonly lengthMeters: number;
  readonly curvaturePerKm: number;
  readonly legalConfidence: number;
  readonly roughShare: number;
}): number {
  const length = Math.min(1, input.lengthMeters / 12_000);
  const curvy = Math.min(1, input.curvaturePerKm / 500);
  const quality = input.legalConfidence * (0.25 + 0.3 * length + 0.35 * curvy + 0.1 * (1 - input.roughShare));
  return Math.max(0, Math.min(1, quality));
}

interface ScoredCorridor {
  readonly corridor: Corridor;
  readonly bendShare: number;
  readonly totalCurvature: number;
  readonly curvaturePerKm: number;
  readonly quality: number;
}

function scoreCorridors(corridors: readonly Corridor[]): readonly ScoredCorridor[] {
  return corridors.flatMap((corridor) => {
    const analysis = analyzeFrancoCurvature(corridor.line, { controlPoints: controlPointsNear(corridor.line) });
    // A paved backroad is only a prize when Franco calls it worth riding.
    if (corridor.kind === "backroad" && analysis.totalCurvature < 300) return [];
    const rough = Object.entries(corridor.gradeMix).reduce((sum, [grade, meters]) => sum + (/[34]$/.test(grade) ? meters : 0), 0);
    const quality = corridorQuality({
      lengthMeters: corridor.lengthMeters,
      curvaturePerKm: analysis.curvaturePerKm,
      legalConfidence: corridor.legalConfidence,
      roughShare: rough / Math.max(1, corridor.lengthMeters),
    });
    return [{ corridor, bendShare: analysis.bendShare, totalCurvature: analysis.totalCurvature, curvaturePerKm: analysis.curvaturePerKm, quality }];
  });
}

function writeAtlas(output: string, scored: readonly ScoredCorridor[]): void {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  if (existsSync(output)) unlinkSync(output);
  const database = new DatabaseSync(output);
  createSchema(database);
  const insert = database.prepare(`insert into corridors values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null)`);
  database.exec("begin");
  try {
    for (const { corridor, bendShare, totalCurvature, curvaturePerKm, quality } of scored) {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const point of corridor.line) {
        minLon = Math.min(minLon, point.lon); maxLon = Math.max(maxLon, point.lon);
        minLat = Math.min(minLat, point.lat); maxLat = Math.max(maxLat, point.lat);
      }
      insert.run(
        corridor.id, corridor.kind, JSON.stringify(corridor.line.map((point) => [Number(point.lon.toFixed(6)), Number(point.lat.toFixed(6))])), corridor.reversible ? 1 : 0, minLon, minLat, maxLon, maxLat,
        corridor.lengthMeters, corridor.kind === "dirt" ? corridor.lengthMeters : 0,
        bendShare, totalCurvature, curvaturePerKm, quality,
        JSON.stringify(corridor.gradeMix), corridor.maxTrackGrade,
        corridor.legalConfidence, 1, corridor.sandShare,
        JSON.stringify(corridor.unknownRestrictionFlags), corridor.closed ? 1 : 0,
        corridor.seasonalClosed ? 1 : 0, JSON.stringify(corridor.seasonalFlags),
        JSON.stringify(corridor.sourceIds), JSON.stringify(corridor.areaHints),
        corridor.links?.[0] ?? null, corridor.links?.[1] ?? null,
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
    if (feature.geometry?.type === "Point") {
      addControlPoint(feature);
      return;
    }
    seen += 1;
    const way = classify(feature);
    if (way !== null) ways.push(way);
  });
  const scored = scoreCorridors(mergeWays(ways));
  writeAtlas(output, scored);
  const corridors = scored.map((entry) => entry.corridor);
  const counts = corridors.reduce((result, corridor) => ({ ...result, [corridor.kind]: (result[corridor.kind] ?? 0) + 1 }), {} as Record<string, number>);
  const areas = Object.fromEntries(Object.keys(AREA_BOUNDS).map((area) => [area, corridors.filter((corridor) => corridor.areaHints.includes(area)).length]));
  console.log(JSON.stringify({ input, output, seenFeatures: seen, selectedWays: ways.length, controlCells: controlGrid.size, corridors: corridors.length, counts, knownAreas: areas }, null, 2));
}

if (process.argv[1] !== undefined && /build-gravel-atlas\.[tj]s$/.test(process.argv[1])) void main();
