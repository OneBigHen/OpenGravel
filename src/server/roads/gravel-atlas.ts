/** Read-only Gravel Atlas v3 adapter. OSM evidence is never presented as
 * proof that the imported GraphHopper graph can route a corridor. */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type {
  GravelAtlasAvailability,
  GravelAtlasBounds,
  GravelAtlasCorridor,
  GravelAtlasCorridorKind,
  GravelAtlasPort,
} from "@/application/roads/gravel-atlas";
import {
  parseAtlasCoordinates,
  parseGradeMix,
  parseJsonArray,
} from "@/application/roads/gravel-atlas";

const SCHEMA_VERSION = 3;
const MAX_ROWS = 2_000;

function openDatabase(path: string): DatabaseSync | null {
  if (!existsSync(path)) return null;
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolValue(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function rowToCorridor(row: Record<string, unknown>): GravelAtlasCorridor | null {
  const geometry = parseAtlasCoordinates(row["geometry_json"] ?? row["geometry"]);
  if (geometry.length < 2) return null;
  const kind = row["kind"] === "backroad" ? "backroad" : row["kind"] === "dirt" ? "dirt" : null;
  if (kind === null) return null;
  const unknownRestrictionFlags = parseJsonArray(row["unknown_restriction_flags_json"]);
  const seasonalFlags = parseJsonArray(row["seasonal_flags_json"]);
  return {
    id: String(row["id"] ?? ""),
    kind,
    geometry,
    lengthMeters: numberValue(row["length_meters"]),
    longestDirtRunMeters: numberValue(row["longest_dirt_run_meters"]),
    bendShare: numberValue(row["bend_share"]),
    francoScore: numberValue(row["franco_score"]),
    curvaturePerKm: numberValue(row["curvature_per_km"]),
    quality: numberValue(row["quality"]),
    reversible: boolValue(row["reversible"]),
    gradeMix: parseGradeMix(row["grade_mix_json"]),
    maxTrackGrade: optionalNumber(row["max_track_grade"]),
    legalConfidence: numberValue(row["legal_confidence"]),
    access: {
      legal: boolValue(row["access_legal"]),
      unknownRestrictionFlags,
      sandShare: numberValue(row["sand_share"]),
    },
    seasonal: {
      closed: boolValue(row["closed"]),
      seasonalClosed: boolValue(row["seasonal_closed"]),
      flags: seasonalFlags,
    },
    sourceIds: parseJsonArray(row["source_ids_json"]),
    areaHints: parseJsonArray(row["area_hints_json"]),
  };
}

export interface GravelAtlasOptions {
  readonly path: string;
}

export function createGravelAtlas(path: string): GravelAtlasPort {
  const database = openDatabase(path);
  let valid = false;
  let reason: string | undefined;
  let count = 0;
  let schemaVersion: number | null = null;

  if (database === null) {
    reason = "file-missing-or-unreadable";
  } else {
    try {
      schemaVersion = numberValue(database.prepare("pragma user_version").get()?.user_version, 0);
      if (schemaVersion !== SCHEMA_VERSION) {
        reason = `unsupported-schema-${schemaVersion}`;
      } else {
        count = numberValue(database.prepare("select count(*) as count from corridors").get()?.count, 0);
        valid = true;
      }
    } catch {
      reason = "invalid-atlas-schema";
    }
  }

  return {
    corridorsNear(bounds: GravelAtlasBounds, kind: GravelAtlasCorridorKind, limit = MAX_ROWS): readonly GravelAtlasCorridor[] {
      if (!valid || database === null) return [];
      const boundedLimit = Math.max(1, Math.min(MAX_ROWS, Math.floor(limit)));
      try {
        const rows = database.prepare(
          `select * from corridors
           where kind = ?
             and east >= ? and west <= ? and north >= ? and south <= ?
             and access_legal = 1 and closed = 0 and seasonal_closed = 0
           order by quality desc, franco_score desc, length_meters desc
           limit ${boundedLimit}`,
        ).all(kind, bounds.west, bounds.east, bounds.south, bounds.north) as Record<string, unknown>[];
        return rows.flatMap((row) => {
          const corridor = rowToCorridor(row);
          if (corridor === null || !corridor.access.legal || corridor.seasonal.closed || corridor.seasonal.seasonalClosed) return [];
          return [corridor];
        });
      } catch {
        return [];
      }
    },
    availability(): GravelAtlasAvailability {
      return {
        available: valid,
        path,
        schemaVersion,
        corridorCount: count,
        ...(reason === undefined ? {} : { reason }),
      };
    },
  };
}

let shared: { key: string; port: GravelAtlasPort } | null = null;

export function gravelAtlasFromEnv(env: Readonly<Record<string, string | undefined>>): GravelAtlasPort {
  const path = env["OGV_GRAVEL_ATLAS_PATH"]?.trim() || "/var/lib/opengravel/gravel-atlas-v3.sqlite";
  if (shared?.key !== path) shared = { key: path, port: createGravelAtlas(path) };
  return shared.port;
}
