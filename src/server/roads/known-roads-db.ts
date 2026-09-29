/**
 * The known-roads catalogues on disk (M3, OGV-D-264), read with Node 24's
 * built-in `node:sqlite`, read-only.
 *
 * - `CURVATURE_DB_PATH` — the rated curvy-road catalogue (`segments`: name,
 *   score, midpoint, GeoJSON-style `[[lon, lat], …]` line), ~7,800 PA/NJ/NY roads;
 * - `GRAVEL_ATLAS_DB_PATH` — SwitchBack's Gravel Atlas (`gravel_atlas_corridors`,
 *   verified `routable` corridors with their own bounds).
 *
 * A missing or unreadable file is an empty catalogue, never a planning failure:
 * the route simply names no roads. Parsed lines are cached by id (the whole
 * curvature file is ~10 MB, so the cache is bounded by the catalogue itself).
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type {
  Bounds,
  KnownCurvyRoad,
  KnownGravelCorridor,
  KnownRoadsPort,
} from "@/application/roads/known-roads";
import type { Coordinate } from "@/domain/ride/types";

/** A route box never asks for more than this many catalogue rows. */
const MAX_ROWS = 4_000;

function parseLine(text: unknown): readonly Coordinate[] | null {
  if (typeof text !== "string") return null;
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return null;
    const line: Coordinate[] = [];
    for (const pair of raw) {
      if (!Array.isArray(pair) || typeof pair[0] !== "number" || typeof pair[1] !== "number") return null;
      line.push({ lon: pair[0], lat: pair[1] });
    }
    return line.length >= 2 ? line : null;
  } catch {
    return null;
  }
}

function open(path: string | undefined): DatabaseSync | null {
  if (path === undefined || path === "" || !existsSync(path)) return null;
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

export interface KnownRoadsDbOptions {
  readonly curvatureDbPath?: string;
  readonly gravelAtlasDbPath?: string;
}

export function createKnownRoadsDb(options: KnownRoadsDbOptions): KnownRoadsPort {
  let curvature: DatabaseSync | null | undefined;
  let atlas: DatabaseSync | null | undefined;
  const lines = new Map<string, readonly Coordinate[] | null>();

  const cachedLine = (id: string, text: unknown): readonly Coordinate[] | null => {
    if (!lines.has(id)) lines.set(id, parseLine(text));
    return lines.get(id) ?? null;
  };

  return {
    curvyRoadsNear(bounds: Bounds): readonly KnownCurvyRoad[] {
      if (curvature === undefined) curvature = open(options.curvatureDbPath);
      if (curvature === null) return [];
      try {
        const rows = curvature
          .prepare(
            `select id, name, score, geometry from segments
             where mid_lat between ? and ? and mid_lon between ? and ? limit ${MAX_ROWS}`,
          )
          .all(bounds.south, bounds.north, bounds.west, bounds.east) as Record<string, unknown>[];
        return rows.flatMap((row) => {
          const id = String(row["id"]);
          const line = cachedLine(`c:${id}`, row["geometry"]);
          const rating = Number(row["score"]);
          if (line === null || !Number.isFinite(rating)) return [];
          return [{ id, name: typeof row["name"] === "string" ? row["name"] : "", rating, line }];
        });
      } catch {
        return [];
      }
    },

    gravelCorridorsNear(bounds: Bounds): readonly KnownGravelCorridor[] {
      if (atlas === undefined) atlas = open(options.gravelAtlasDbPath);
      if (atlas === null) return [];
      try {
        const rows = atlas
          .prepare(
            `select id, label, geometry, confidence from gravel_atlas_corridors
             where verification_status = 'routable'
               and east >= ? and west <= ? and north >= ? and south <= ? limit ${MAX_ROWS}`,
          )
          .all(bounds.west, bounds.east, bounds.south, bounds.north) as Record<string, unknown>[];
        return rows.flatMap((row) => {
          const id = String(row["id"]);
          const line = cachedLine(`g:${id}`, row["geometry"]);
          const confidence = Number(row["confidence"]);
          if (line === null) return [];
          return [{
            id,
            label: typeof row["label"] === "string" ? row["label"] : "",
            line,
            confidence: Number.isFinite(confidence) ? confidence : 0.5,
          }];
        });
      } catch {
        return [];
      }
    },
  };
}

let shared: { readonly key: string; readonly port: KnownRoadsPort } | null = null;

/** The deployment's catalogues from the environment, opened once per process. */
export function knownRoadsFromEnv(env: Readonly<Record<string, string | undefined>>): KnownRoadsPort {
  const options = {
    curvatureDbPath: env["CURVATURE_DB_PATH"],
    gravelAtlasDbPath: env["GRAVEL_ATLAS_DB_PATH"],
  };
  const key = `${options.curvatureDbPath ?? ""}|${options.gravelAtlasDbPath ?? ""}`;
  if (shared === null || shared.key !== key) shared = { key, port: createKnownRoadsDb(options) };
  return shared.port;
}
