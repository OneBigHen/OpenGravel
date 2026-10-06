import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

  public addRoute(id: string, raw: Record<string, unknown>, now: string): void {
    this.database.prepare("INSERT INTO community_routes (id, raw_json, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify(raw), now);
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
