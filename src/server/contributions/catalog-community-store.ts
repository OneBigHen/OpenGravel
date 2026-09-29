import { mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const CATALOG_COMMUNITY_WRITE_LIMIT = 10;
export const CATALOG_COMMUNITY_WINDOW_MS = 10 * 60_000;
export const DEFAULT_COMMUNITY_DATABASE_PATH = process.env.COMMUNITY_DB_PATH
  ?? process.env.OGV_CONTRIBUTIONS_DB_PATH
  ?? path.join(process.cwd(), "data", "community.sqlite");

export interface CatalogCommunityStoreOptions {
  readonly now?: () => string;
}

export interface CatalogRatingSummary {
  readonly average: number | null;
  readonly count: number;
}

export class SQLiteCatalogCommunityStore {
  private readonly database: DatabaseSync;
  private readonly now: () => string;

  public constructor(filePath: string = DEFAULT_COMMUNITY_DATABASE_PATH, options: CatalogCommunityStoreOptions = {}) {
    if (filePath !== ":memory:") mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_route_ratings (
        route_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (route_id, device_id)
      );
      CREATE TABLE IF NOT EXISTS catalog_community_writes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        written_at TEXT NOT NULL,
        client_ip_hash TEXT,
        client_ip_day TEXT
      );
      CREATE TABLE IF NOT EXISTS catalog_community_ip_salts (
        day TEXT PRIMARY KEY,
        salt TEXT NOT NULL
      );
    `);
    const writeColumns = this.database.prepare("PRAGMA table_info(catalog_community_writes)").all() as unknown as readonly { readonly name: string }[];
    if (!writeColumns.some((column) => column.name === "client_ip_hash")) {
      this.database.exec("ALTER TABLE catalog_community_writes ADD COLUMN client_ip_hash TEXT");
    }
    if (!writeColumns.some((column) => column.name === "client_ip_day")) {
      this.database.exec("ALTER TABLE catalog_community_writes ADD COLUMN client_ip_day TEXT");
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS catalog_community_writes_by_device
        ON catalog_community_writes(device_id, written_at DESC);
      CREATE INDEX IF NOT EXISTS catalog_community_writes_by_client_ip
        ON catalog_community_writes(client_ip_day, client_ip_hash, written_at DESC);
    `);
  }

  public recordRating(routeId: string, deviceId: string, rating: number, clientIp = "unknown-client"): CatalogRatingSummary | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (!this.acceptWrite(deviceId, clientIp)) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.prepare(`
        INSERT INTO catalog_route_ratings(route_id, device_id, rating, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(route_id, device_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at
      `).run(routeId, deviceId, rating, this.now());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.ratingSummary(routeId);
  }

  public ratingSummary(routeId: string): CatalogRatingSummary {
    const row = this.database.prepare(`
      SELECT AVG(rating) AS average, COUNT(*) AS count FROM catalog_route_ratings WHERE route_id = ?
    `).get(routeId) as { readonly average: number | null; readonly count: number };
    return { average: row.average === null ? null : Math.round(row.average * 10) / 10, count: row.count };
  }

  public clearForTest(): void {
    this.database.exec("DELETE FROM catalog_route_ratings; DELETE FROM catalog_community_writes; DELETE FROM catalog_community_ip_salts;");
  }

  public close(): void { this.database.close(); }

  private acceptWrite(deviceId: string, clientIp: string): boolean {
    const now = this.now();
    const threshold = new Date(Date.parse(now) - CATALOG_COMMUNITY_WINDOW_MS).toISOString();
    const currentDate = new Date(now);
    const currentDay = currentDate.toISOString().slice(0, 10);
    const previousDay = new Date(currentDate.getTime() - 86_400_000).toISOString().slice(0, 10);
    this.database.prepare("DELETE FROM catalog_community_writes WHERE written_at < ?").run(threshold);
    this.database.prepare("DELETE FROM catalog_community_ip_salts WHERE day < ?").run(previousDay);
    const ipHashes = [currentDay, previousDay].map((day) => ({ day, hash: this.hashClientIp(clientIp, day) }));
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM catalog_community_writes WHERE device_id = ? AND written_at >= ?
    `).get(deviceId, threshold) as { readonly count: number };
    const ipCount = this.database.prepare(`
      SELECT COUNT(*) AS count FROM catalog_community_writes
      WHERE written_at >= ? AND ((client_ip_day = ? AND client_ip_hash = ?) OR (client_ip_day = ? AND client_ip_hash = ?))
    `).get(threshold, ipHashes[0]!.day, ipHashes[0]!.hash, ipHashes[1]!.day, ipHashes[1]!.hash) as { readonly count: number };
    if (row.count >= CATALOG_COMMUNITY_WRITE_LIMIT || ipCount.count >= CATALOG_COMMUNITY_WRITE_LIMIT) return false;
    this.database.prepare(`
      INSERT INTO catalog_community_writes(device_id, written_at, client_ip_hash, client_ip_day) VALUES (?, ?, ?, ?)
    `).run(deviceId, now, ipHashes[0]!.hash, currentDay);
    return true;
  }

  private hashClientIp(clientIp: string, day: string): string {
    let row = this.database.prepare("SELECT salt FROM catalog_community_ip_salts WHERE day = ?").get(day) as { readonly salt: string } | undefined;
    if (row === undefined) {
      const salt = randomBytes(32).toString("hex");
      this.database.prepare("INSERT INTO catalog_community_ip_salts(day, salt) VALUES (?, ?)").run(day, salt);
      row = { salt };
    }
    return createHash("sha256").update(`${row.salt}\0${clientIp}`).digest("hex");
  }
}
