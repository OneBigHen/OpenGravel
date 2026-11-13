/** Read-only loader for the loop anchors table (scripts/build-loop-anchors.ts).
 *
 * The table lists good dirt and good twisty roads the running router agreed it
 * can ride through. It is optional: a missing file, an unreadable file, or a
 * table built for another map (import date differs from the running router's)
 * gives an empty result and one health line, never an error. */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const MAX_ROWS = 500;

export type LoopAnchorKind = "dirt" | "curvy";

export interface LoopAnchorBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface LoopAnchor {
  readonly id: string;
  readonly kind: LoopAnchorKind;
  readonly lat: number;
  readonly lon: number;
  /** Degrees clockwise from north along the checked stretch. */
  readonly heading: number;
  readonly lengthMeters: number;
  readonly quality: number;
  readonly maxGrade: number | null;
  readonly sandShare: number;
  readonly seasonalFlags: readonly string[];
  /** Share (0 to 1) of the checked stretch that is not dead-end territory. */
  readonly through: number;
  /** The same, counting only paved roads and easy tracks (for street and touring bikes). */
  readonly throughStreet: number;
  /** Mean bend measure of the stretch, 0 to 1. */
  readonly curve: number;
  /** Built-up share around the anchor: rural 0, residential 0.7, city 1. */
  readonly town: number;
}

/** What the rider's bike can take. All optional. */
export interface LoopAnchorFilter {
  readonly kind?: LoopAnchorKind;
  readonly minQuality?: number;
  /** Highest track grade the bike can ride (anchors with no grade pass). */
  readonly maxGrade?: number;
  /** Highest sand share, 0 to 1. */
  readonly maxSandShare?: number;
  /** Keep only anchors that are a way through (street bikes use the street flag). */
  readonly requireThrough?: "any" | "street";
  /** Highest built-up share. */
  readonly maxTown?: number;
  readonly limit?: number;
}

export interface LoopAnchorAvailability {
  readonly available: boolean;
  readonly path: string | null;
  readonly count: number;
  readonly importDate: string | null;
  /** The single health line when the table is not usable. */
  readonly healthLine?: string;
}

export interface LoopAnchorsPort {
  anchorsNear(bounds: LoopAnchorBounds, filter?: LoopAnchorFilter): readonly LoopAnchor[];
  availability(): LoopAnchorAvailability;
}

const THROUGH_MIN = 0.5;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function flags(value: unknown): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toAnchor(row: Record<string, unknown>): LoopAnchor | null {
  const kind = row["kind"] === "dirt" ? "dirt" : row["kind"] === "curvy" ? "curvy" : null;
  if (kind === null) return null;
  return {
    id: String(row["id"] ?? ""),
    kind,
    lat: num(row["lat"]),
    lon: num(row["lon"]),
    heading: num(row["heading"]),
    lengthMeters: num(row["length_m"]),
    quality: num(row["quality"]),
    maxGrade: row["max_grade"] === null || row["max_grade"] === undefined ? null : num(row["max_grade"]),
    sandShare: num(row["sand_share"]),
    seasonalFlags: flags(row["seasonal_flags_json"]),
    through: num(row["through"]),
    throughStreet: num(row["through_street"]),
    curve: num(row["curve"]),
    town: num(row["town"]),
  };
}

function unavailable(path: string | null, healthLine: string): LoopAnchorsPort {
  return {
    anchorsNear: () => [],
    availability: () => ({ available: false, path, count: 0, importDate: null, healthLine }),
  };
}

/**
 * @param path file written by build-loop-anchors.ts
 * @param routerImportDate the running router's graph import date (from /info); null or "unknown" means the table cannot be matched and is not used
 * @param log receives the one health line when the table is unusable
 */
export function createLoopAnchors(
  path: string | null | undefined,
  routerImportDate: string | null | undefined,
  log: (line: string) => void = (line) => console.warn(line),
): LoopAnchorsPort {
  const fail = (reason: string): LoopAnchorsPort => {
    const line = `loop-anchors: not used (${reason})`;
    log(line);
    return unavailable(path ?? null, line);
  };

  if (path === null || path === undefined || path === "") return fail("no file configured");
  if (!existsSync(path)) return fail("file missing");

  let database: DatabaseSync;
  let count = 0;
  let importDate: string | null = null;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const version = num(database.prepare("pragma user_version").get()?.["user_version"], 0);
    if (version !== SCHEMA_VERSION) {
      database.close();
      return fail(`unsupported table version ${version}`);
    }
    const meta = database.prepare("select value from meta where key = 'import_date'").get();
    importDate = meta === undefined ? null : String(meta["value"]);
    if (routerImportDate === null || routerImportDate === undefined || routerImportDate === "" || routerImportDate === "unknown") {
      database.close();
      return fail("the running map's import date is unknown");
    }
    if (importDate !== routerImportDate) {
      database.close();
      return fail("table was built for another map");
    }
    count = num(database.prepare("select count(*) as n from anchors").get()?.["n"], 0);
  } catch {
    return fail("file unreadable");
  }

  const db = database;
  return {
    anchorsNear(bounds, filter = {}) {
      const where = ["lat >= ?", "lat <= ?", "lon >= ?", "lon <= ?"];
      const params: (string | number)[] = [bounds.south, bounds.north, bounds.west, bounds.east];
      if (filter.kind !== undefined) { where.push("kind = ?"); params.push(filter.kind); }
      if (filter.minQuality !== undefined) { where.push("quality >= ?"); params.push(filter.minQuality); }
      if (filter.maxGrade !== undefined) { where.push("(max_grade is null or max_grade <= ?)"); params.push(filter.maxGrade); }
      if (filter.maxSandShare !== undefined) { where.push("sand_share <= ?"); params.push(filter.maxSandShare); }
      if (filter.maxTown !== undefined) { where.push("town <= ?"); params.push(filter.maxTown); }
      if (filter.requireThrough === "any") { where.push("through >= ?"); params.push(THROUGH_MIN); }
      if (filter.requireThrough === "street") { where.push("through_street >= ?"); params.push(THROUGH_MIN); }
      const limit = Math.max(1, Math.min(MAX_ROWS, Math.floor(filter.limit ?? MAX_ROWS)));
      try {
        const rows = db
          .prepare(`select * from anchors where ${where.join(" and ")} order by quality desc, length_m desc limit ${limit}`)
          .all(...params) as Record<string, unknown>[];
        return rows.flatMap((row) => {
          const anchor = toAnchor(row);
          return anchor === null ? [] : [anchor];
        });
      } catch {
        return [];
      }
    },
    availability: () => ({ available: true, path, count, importDate }),
  };
}
