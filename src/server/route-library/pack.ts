import "server-only";

import { statSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import type { RideDetail } from "@/application/route-library/types";

/** The environment variable that points at the published pack (`current.sqlite`). */
export const ROUTE_LIBRARY_PACK_ENV = "OGV_ROUTE_LIBRARY_PACK";

export interface PackManifest {
  readonly version: string;
  readonly builtAt: string;
  readonly rides: number;
  readonly located: number;
  readonly withLine: number;
  /** Rides removed from the library; an old link to one answers 410. */
  readonly removed: number;
  readonly states: Readonly<Record<string, number>>;
  /** Decimal places of every stored polyline. */
  readonly polylinePrecision: number;
}

export interface PackTombstone {
  readonly id: string;
  readonly removedAt: string;
  readonly reason: string;
}

export interface PackRide {
  /** The id that was stored (differs from the asked id when an alias was followed). */
  readonly id: string;
  readonly detail: RideDetail;
  /** Stored line: `polyline5`, bundle segments joined with `;`. Empty when the ride has no line. */
  readonly line: string;
  readonly points: number;
}

export interface PackAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

interface OpenPack {
  readonly key: string;
  readonly database: DatabaseSync;
  readonly version: string;
  readonly manifest: PackManifest;
  readonly asset: StatementSync;
  readonly ride: StatementSync;
  readonly alias: StatementSync;
  readonly tombstone: StatementSync | null;
}

let open: OpenPack | null = null;

function closeOpen(): void {
  if (open === null) return;
  try {
    open.database.close();
  } catch {
    // Already closed.
  }
  open = null;
}

/**
 * Opens the pack lazily, read-only, and again whenever the file changes
 * (the publish script switches a symlink, so the key is the target's identity).
 * No variable, no file, or a file that is not a pack: `null`, never a throw.
 */
function pack(): OpenPack | null {
  const location = process.env[ROUTE_LIBRARY_PACK_ENV];
  if (location === undefined || location.trim() === "") {
    closeOpen();
    return null;
  }
  let key: string;
  try {
    const stat = statSync(location);
    if (!stat.isFile()) throw new Error("not a file");
    key = `${location}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    closeOpen();
    return null;
  }
  if (open !== null && open.key === key) return open;
  closeOpen();
  try {
    const database = new DatabaseSync(location, { readOnly: true });
    const meta = database.prepare("SELECT value FROM meta WHERE key = ?");
    const manifestRow = meta.get("manifest") as { value: string } | undefined;
    const versionRow = meta.get("version") as { value: string } | undefined;
    const precisionRow = meta.get("polyline_precision") as { value: string } | undefined;
    if (manifestRow === undefined || versionRow === undefined) {
      database.close();
      return null;
    }
    let removed = 0;
    let tombstone: StatementSync | null = null;
    try {
      const count = database.prepare("SELECT COUNT(*) AS removed FROM tombstone").get() as { removed: number } | undefined;
      removed = Number(count?.removed ?? 0);
      tombstone = database.prepare("SELECT removed_at, reason FROM tombstone WHERE id = ?");
    } catch {
      // A pack built before the tombstone table existed: every ride is either
      // present or an ordinary 404, and the library still serves normally.
      tombstone = null;
    }
    const stored = JSON.parse(manifestRow.value) as Omit<PackManifest, "polylinePrecision" | "removed">;
    const manifest = { ...stored, removed, polylinePrecision: Number(precisionRow?.value ?? 5) };
    open = {
      key,
      database,
      version: versionRow.value,
      manifest,
      asset: database.prepare("SELECT body, content_type FROM asset WHERE key = ?"),
      ride: database.prepare("SELECT id, detail, line, points FROM ride WHERE id = ?"),
      alias: database.prepare("SELECT primary_id FROM alias WHERE id = ?"),
      tombstone,
    };
    return open;
  } catch {
    return null;
  }
}

/** True when a pack is configured and readable. */
export function routeLibraryAvailable(): boolean {
  return pack() !== null;
}

export function packManifest(): PackManifest | null {
  return pack()?.manifest ?? null;
}

export function packVersion(): string | null {
  return pack()?.version ?? null;
}

/** A stored, already gzipped file: `index` or `lines/<ST>`. */
export function packAsset(key: string): PackAsset | null {
  const current = pack();
  if (current === null) return null;
  const row = current.asset.get(key) as { body: Uint8Array; content_type: string } | undefined;
  return row === undefined ? null : { body: Buffer.from(row.body), contentType: row.content_type };
}

/** One ride by id, following `alias` to the primary card. */
export function packRide(id: string): PackRide | null {
  const current = pack();
  if (current === null) return null;
  let row = current.ride.get(id) as { id: string; detail: Uint8Array; line: string; points: number } | undefined;
  if (row === undefined) {
    const alias = current.alias.get(id) as { primary_id: string } | undefined;
    if (alias !== undefined) row = current.ride.get(alias.primary_id) as typeof row;
  }
  if (row === undefined) return null;
  return { id: row.id, detail: JSON.parse(gunzipSync(row.detail).toString("utf8")) as RideDetail, line: row.line, points: row.points };
}

/** A ride the library removed, so an old link can say so instead of a bare 404. */
export function packTombstone(id: string): PackTombstone | null {
  const current = pack();
  if (current === null || current.tombstone === null) return null;
  const row = current.tombstone.get(id) as { removed_at: string; reason: string } | undefined;
  return row === undefined ? null : { id, removedAt: row.removed_at, reason: row.reason };
}

/** Test helper: forget the open pack so the next call reads the environment again. */
export function resetPackForTests(): void {
  closeOpen();
}
