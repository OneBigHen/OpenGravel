import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { PublicRoutePhoto } from "./photos";

import { DEFAULT_COMMUNITY_DATABASE_PATH } from "@/server/contributions/catalog-community-store";

/** One shared route, as the catalog's raw JSON plus its bookkeeping. */
export interface CommunityRouteRow {
  readonly id: string;
  readonly raw: Record<string, unknown>;
  readonly createdAt: string;
}

export interface RouteRemovalRow {
  readonly routeId: string;
  readonly removedAt: string;
  readonly reason: string;
}

/**
 * Riders' shared routes and the soft removals of any catalog route. A removal
 * hides a route; it never deletes the bytes, so the owner can restore it from
 * the email link. Every removal and restore is kept in an append-only log.
 */
export class CommunityRouteStore {
  private readonly database: DatabaseSync;

  public constructor(filePath: string = DEFAULT_COMMUNITY_DATABASE_PATH) {
    if (filePath !== ":memory:") mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS community_routes (
        id TEXT PRIMARY KEY,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_route_photos (
        route_id TEXT NOT NULL,
        photo_index INTEGER NOT NULL,
        bytes BLOB NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        PRIMARY KEY (route_id, photo_index)
      );
      CREATE TABLE IF NOT EXISTS route_removals (
        route_id TEXT PRIMARY KEY,
        removed_at TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS route_removal_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('remove', 'restore')),
        at TEXT NOT NULL,
        reason TEXT NOT NULL
      );
    `);
  }

  /** Changes whenever the visible catalog could have: a cache key. */
  public version(): string {
    const shared = this.database.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(created_at), '') AS m FROM community_routes").get() as { n: number; m: string };
    const removed = this.database.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(removed_at), '') AS m FROM route_removals").get() as { n: number; m: string };
    return `${shared.n}:${shared.m}:${removed.n}:${removed.m}`;
  }

  public addRoute(id: string, raw: Record<string, unknown>, now: string, photos: readonly PublicRoutePhoto[] = [], maximum = 2000): boolean {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error("Invalid shared-route capacity.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.routeCount() >= maximum) { this.database.exec("ROLLBACK"); return false; }
      this.database.prepare("INSERT INTO community_routes (id, raw_json, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify(raw), now);
      const insert = this.database.prepare("INSERT INTO community_route_photos (route_id, photo_index, bytes, width, height) VALUES (?, ?, ?, ?, ?)");
      photos.forEach((photo, index) => insert.run(id, index, photo.bytes, photo.width, photo.height));
      this.database.exec("COMMIT");
      return true;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  public photo(routeId: string, index: number): PublicRoutePhoto | null {
    if (this.removal(routeId) !== null) return null;
    const row = this.database.prepare("SELECT bytes, width, height FROM community_route_photos WHERE route_id = ? AND photo_index = ?").get(routeId, index) as { bytes: Uint8Array; width: number; height: number } | undefined;
    return row === undefined ? null : { bytes: Buffer.from(row.bytes), width: row.width, height: row.height };
  }

  public routeCount(): number {
    return (this.database.prepare("SELECT COUNT(*) AS n FROM community_routes").get() as { n: number }).n;
  }

  public routes(): readonly CommunityRouteRow[] {
    const rows = this.database.prepare("SELECT id, raw_json, created_at FROM community_routes ORDER BY created_at").all() as unknown as readonly { id: string; raw_json: string; created_at: string }[];
    return rows.map((row) => ({ id: row.id, raw: JSON.parse(row.raw_json) as Record<string, unknown>, createdAt: row.created_at }));
  }

  public removedIds(): ReadonlySet<string> {
    const rows = this.database.prepare("SELECT route_id FROM route_removals").all() as unknown as readonly { route_id: string }[];
    return new Set(rows.map((row) => row.route_id));
  }

  public removal(routeId: string): RouteRemovalRow | null {
    const row = this.database.prepare("SELECT route_id, removed_at, reason FROM route_removals WHERE route_id = ?").get(routeId) as { route_id: string; removed_at: string; reason: string } | undefined;
    return row === undefined ? null : { routeId: row.route_id, removedAt: row.removed_at, reason: row.reason };
  }

  /** Hides a route. Returns false when it was already hidden. */
  public remove(routeId: string, reason: string, now: string): boolean {
    if (this.removal(routeId) !== null) return false;
    this.database.prepare("INSERT INTO route_removals (route_id, removed_at, reason) VALUES (?, ?, ?)").run(routeId, now, reason);
    this.database.prepare("INSERT INTO route_removal_log (route_id, action, at, reason) VALUES (?, 'remove', ?, ?)").run(routeId, now, reason);
    return true;
  }

  /** Brings a hidden route back. Returns false when it was not hidden. */
  public restore(routeId: string, now: string): boolean {
    const result = this.database.prepare("DELETE FROM route_removals WHERE route_id = ?").run(routeId);
    if (Number(result.changes) === 0) return false;
    this.database.prepare("INSERT INTO route_removal_log (route_id, action, at, reason) VALUES (?, 'restore', ?, '')").run(routeId, now);
    return true;
  }
}

let shared: CommunityRouteStore | undefined;

/** One store per process, kept on `globalThis` so every route bundle shares it. */
export function sharedCommunityRouteStore(): CommunityRouteStore {
  const holder = globalThis as { __ogvCommunityRouteStore?: CommunityRouteStore };
  shared ??= holder.__ogvCommunityRouteStore ??= new CommunityRouteStore();
  return shared;
}
