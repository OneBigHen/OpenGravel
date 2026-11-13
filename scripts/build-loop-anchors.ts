#!/usr/bin/env node

/**
 * Build the loop anchors table: good dirt roads and good twisty roads that the
 * running router agrees can be ridden through.
 *
 * Every Gravel Atlas corridor that is legal, open and routable becomes one
 * candidate. The router is asked one short question along the corridor's middle
 * 200 m (with details). A candidate stays only if the router rides that stretch
 * at about its own length; the answer also says whether the road is a way
 * through (`og_through`, `og_through_street`), how bendy it is (`og_curve`) and
 * how built-up its surroundings are (`urban_density`: rural 0, residential 0.7,
 * city 1 -> `town`). Dirt anchors are atlas dirt corridors; curvy anchors are
 * atlas backroad corridors whose mean `og_curve` is 0.25 or more.
 *
 * The router's `/info` import date goes into the `meta` table, so a table built
 * for another map is recognised and ignored by the loader.
 *
 *   npx tsx scripts/build-loop-anchors.ts --atlas atlas.sqlite --url http://127.0.0.1:8988 --out loop-anchors-v1.sqlite
 */

import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { parseRouterInfo, UNKNOWN } from "./scorecard/provenance";

export const ANCHOR_SCHEMA_VERSION = 1;
/** At most this many router calls in flight. */
export const MAX_IN_FLIGHT = 8;
/** Length of the stretch asked about, centred on the corridor midpoint. */
export const SLICE_METERS = 200;
/** A backroad is "curvy" from this mean `og_curve`. */
export const CURVY_MIN = 0.25;
/** Routed length may be this factor (plus slack) over the slice and still count as riding it. */
const ROUTED_FACTOR = 1.3;
const ROUTED_SLACK_METERS = 150;

type LonLat = readonly [number, number];

export type AnchorKind = "dirt" | "curvy";

export interface AnchorMeasure {
  readonly through: number;
  readonly throughStreet: number;
  readonly curve: number;
  readonly town: number;
  readonly routedMeters: number;
}

const URBAN_TOWN: Readonly<Record<string, number>> = { RURAL: 0, RESIDENTIAL: 0.7, CITY: 1 };

function haversine(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const dLon = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(b[1] * toRad);
  const x = Math.cos(a[1] * toRad) * Math.sin(b[1] * toRad) - Math.sin(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.cos(dLon);
  return ((Math.atan2(y, x) / toRad) + 360) % 360;
}

function pointAt(line: readonly LonLat[], cumulative: readonly number[], distance: number): LonLat {
  const last = line.length - 1;
  if (distance <= 0) return line[0] as LonLat;
  if (distance >= (cumulative[last] as number)) return line[last] as LonLat;
  let index = 1;
  while ((cumulative[index] as number) < distance) index += 1;
  const before = line[index - 1] as LonLat;
  const after = line[index] as LonLat;
  const span = (cumulative[index] as number) - (cumulative[index - 1] as number);
  const t = span <= 0 ? 0 : (distance - (cumulative[index - 1] as number)) / span;
  return [before[0] + (after[0] - before[0]) * t, before[1] + (after[1] - before[1]) * t];
}

/** The corridor's middle stretch (about 200 m): start, midpoint, end. Null for a degenerate line. */
export function middleSlice(line: readonly LonLat[], sliceMeters = SLICE_METERS): { readonly start: LonLat; readonly mid: LonLat; readonly end: LonLat } | null {
  if (line.length < 2) return null;
  const cumulative: number[] = [0];
  for (let index = 1; index < line.length; index += 1) {
    cumulative.push((cumulative[index - 1] as number) + haversine(line[index - 1] as LonLat, line[index] as LonLat));
  }
  const total = cumulative[cumulative.length - 1] as number;
  if (total <= 0) return null;
  const half = Math.min(sliceMeters, total) / 2;
  const centre = total / 2;
  return {
    start: pointAt(line, cumulative, centre - half),
    mid: pointAt(line, cumulative, centre),
    end: pointAt(line, cumulative, centre + half),
  };
}

type DetailInterval = readonly [number, number, unknown];

/** Length-weighted mean of a path detail; `score` turns each interval value into a number (or null to skip). */
function weighted(
  intervals: readonly DetailInterval[] | undefined,
  coordinates: readonly LonLat[],
  score: (value: unknown) => number | null,
): number {
  if (intervals === undefined || intervals.length === 0) return 0;
  let total = 0;
  let sum = 0;
  for (const [from, to, value] of intervals) {
    const s = score(value);
    if (s === null) continue;
    let meters = 0;
    for (let index = from + 1; index <= to && index < coordinates.length; index += 1) {
      meters += haversine(coordinates[index - 1] as LonLat, coordinates[index] as LonLat);
    }
    total += meters;
    sum += meters * s;
  }
  return total <= 0 ? 0 : sum / total;
}

interface RouteBody {
  readonly paths?: readonly {
    readonly distance?: number;
    readonly points?: { readonly coordinates?: readonly LonLat[] };
    readonly details?: Readonly<Record<string, readonly DetailInterval[]>>;
  }[];
}

/** Reads one short route answer into the numbers the table keeps. Null when the answer has no route. */
export function measureRoute(body: RouteBody): AnchorMeasure | null {
  const path = body.paths?.[0];
  const coordinates = path?.points?.coordinates;
  if (path === undefined || coordinates === undefined || coordinates.length < 2 || typeof path.distance !== "number") return null;
  const details = path.details ?? {};
  const truth = (value: unknown): number => (value === true || value === "true" || value === 1 ? 1 : 0);
  const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    through: weighted(details["og_through"], coordinates, truth),
    throughStreet: weighted(details["og_through_street"], coordinates, truth),
    curve: weighted(details["og_curve"], coordinates, number),
    town: weighted(details["urban_density"], coordinates, (value) => URBAN_TOWN[String(value).toUpperCase()] ?? null),
    routedMeters: path.distance,
  };
}

export function ridesTheSlice(routedMeters: number, sliceMeters: number): boolean {
  return routedMeters <= sliceMeters * ROUTED_FACTOR + ROUTED_SLACK_METERS;
}

export function kindFor(atlasKind: string, curve: number): AnchorKind | null {
  if (atlasKind === "dirt") return "dirt";
  if (atlasKind === "backroad" && curve >= CURVY_MIN) return "curvy";
  return null;
}

interface AtlasRow {
  readonly id: string;
  readonly kind: string;
  readonly geometry_json: string;
  readonly length_meters: number;
  readonly quality: number;
  readonly max_track_grade: number | null;
  readonly sand_share: number;
  readonly seasonal_flags_json: string;
  readonly bend_share: number;
  readonly routable?: number | null;
}

function parseArgs(): { atlas: string; url: string; out: string } {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key?.startsWith("--") && value !== undefined) values.set(key.slice(2), value);
  }
  const atlas = values.get("atlas");
  const out = values.get("out");
  if (atlas === undefined) throw new Error("--atlas is required");
  if (out === undefined) throw new Error("--out is required");
  return { atlas, url: (values.get("url") ?? "http://127.0.0.1:8988").replace(/\/+$/, ""), out };
}

async function askRouter(url: string, slice: NonNullable<ReturnType<typeof middleSlice>>, profile: string): Promise<AnchorMeasure | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${url}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: [slice.start, slice.mid, slice.end],
          profile,
          "ch.disable": true,
          points_encoded: false,
          instructions: false,
          details: ["og_through", "og_through_street", "og_curve", "urban_density"],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok && response.status < 500) return null;
      if (!response.ok) continue;
      return measureRoute((await response.json()) as RouteBody);
    } catch {
      /* try once more, then give the corridor up */
    }
  }
  return null;
}

async function main(): Promise<void> {
  const { atlas, url, out } = parseArgs();
  const info = parseRouterInfo(await (await fetch(`${url}/info`, { signal: AbortSignal.timeout(10_000) })).json());
  if (info.graphBuildDate === UNKNOWN) throw new Error("The router /info did not report an import date; refusing to build a table that cannot be matched to a map.");

  const source = new DatabaseSync(atlas, { readOnly: true });
  const columns = (source.prepare("pragma table_info(corridors)").all() as { name: string }[]).map((column) => column.name);
  // Rows the old map never validated (routable null: the atlas counted a dead end) are asked about too;
  // the new map decides, and they stay only when it calls the road a way through.
  const routableFilter = columns.includes("routable") ? "and (routable = 1 or routable is null)" : "";
  const rows = source.prepare(
    `select id, kind, geometry_json, length_meters, quality, max_track_grade, sand_share, seasonal_flags_json, bend_share, routable
     from corridors
     where access_legal = 1 and closed = 0 and seasonal_closed = 0 ${routableFilter}
     order by id`,
  ).all() as unknown as AtlasRow[];
  source.close();

  if (existsSync(out)) rmSync(out);
  const db = new DatabaseSync(out);
  db.exec(`
    pragma user_version = ${ANCHOR_SCHEMA_VERSION};
    create table meta (key text primary key, value text not null);
    create table anchors (
      id text primary key, kind text not null,
      lat real not null, lon real not null, heading real not null,
      length_m real not null, quality real not null, max_grade integer,
      sand_share real not null, seasonal_flags_json text not null,
      through real not null, through_street real not null, curve real not null, town real not null
    );
    create index anchors_box on anchors(kind, lat, lon);
  `);
  const insert = db.prepare("insert into anchors values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

  let next = 0;
  let done = 0;
  let notRidden = 0;
  let tooStraight = 0;
  const started = Date.now();
  const worker = async (): Promise<void> => {
    for (let index = next++; index < rows.length; index = next++) {
      const row = rows[index] as AtlasRow;
      done += 1;
      if (done % 500 === 0) console.log(`${done}/${rows.length} (${Math.round((Date.now() - started) / 1000)}s)`);
      let line: LonLat[];
      try { line = JSON.parse(row.geometry_json) as LonLat[]; } catch { continue; }
      const slice = middleSlice(line);
      if (slice === null) continue;
      const sliceMeters = Math.min(SLICE_METERS, row.length_meters);
      const measure = await askRouter(url, slice, row.kind === "dirt" ? "motorcycle_adventure" : "motorcycle_twisty");
      if (measure === null || !ridesTheSlice(measure.routedMeters, sliceMeters)) { notRidden += 1; continue; }
      if (row.routable === null && measure.through < 0.5) { notRidden += 1; continue; }
      const kind = kindFor(row.kind, measure.curve);
      if (kind === null) { tooStraight += 1; continue; }
      insert.run(
        row.id, kind, slice.mid[1], slice.mid[0], Math.round(bearingDegrees(slice.start, slice.end)),
        row.length_meters, row.quality, row.max_track_grade, row.sand_share, row.seasonal_flags_json,
        measure.through, measure.throughStreet, measure.curve, measure.town,
      );
    }
  };
  db.exec("begin");
  await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, () => worker()));
  db.exec("commit");

  const put = db.prepare("insert into meta values (?, ?)");
  put.run("import_date", info.graphBuildDate);
  put.run("profile_hash", info.profileHash);
  put.run("built_at", new Date().toISOString());
  put.run("atlas", atlas);
  put.run("schema", String(ANCHOR_SCHEMA_VERSION));

  const perKind = db.prepare("select kind, count(*) as n from anchors group by kind").all() as { kind: string; n: number }[];
  const nj = db.prepare("select count(*) as n from anchors where lat between 38.9 and 41.4 and lon between -75.6 and -73.9").get() as { n: number };
  db.close();
  console.log(JSON.stringify({ out, importDate: info.graphBuildDate, candidates: rows.length, notRidden, tooStraight, perKind, newJersey: nj.n }));
}

if (process.argv[1] !== undefined && /build-loop-anchors\.[tj]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
