import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type PublicShareResolution = { state: "active"; output: string } | { state: "revoked" } | { state: "not-found" };

export type PublicSharePublishResult =
  | { readonly state: "created" }
  | { readonly state: "exists" }
  /** `owner-hourly` is this browser's own budget; `capacity` is the disk budget. */
  | { readonly state: "limited"; readonly reason: "owner-hourly" | "capacity" };

export const PUBLIC_SHARE_CAPACITY = 2000;
export const PUBLIC_SHARE_PER_OWNER_PER_HOUR = 60;
/** A link stops resolving after this window; older rows are pruned on publish. */
export const PUBLIC_SHARE_RETENTION_MS = 180 * 86_400_000;
export const PUBLIC_SHARE_HOUR_MS = 3_600_000;

export interface PublicShareStoreOptions {
  readonly now?: () => number;
  /** Unrevoked links allowed on disk: the disk budget, not a per-rider one. */
  readonly capacity?: number;
  /** Links one browser may create per rolling hour. */
  readonly perOwnerPerHour?: number;
  /** How long a published link stays resolvable. */
  readonly retentionMs?: number;
}

/** Public snapshots are immutable. Owner capabilities never leave the server. */
export class SQLitePublicShareStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  readonly #capacity: number;
  readonly #perOwnerPerHour: number;
  readonly #retentionMs: number;
  constructor(path: string, options: PublicShareStoreOptions = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#now = options.now ?? Date.now;
    this.#capacity = options.capacity ?? PUBLIC_SHARE_CAPACITY;
    this.#perOwnerPerHour = options.perOwnerPerHour ?? PUBLIC_SHARE_PER_OWNER_PER_HOUR;
    this.#retentionMs = options.retentionMs ?? PUBLIC_SHARE_RETENTION_MS;
    this.#db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS public_shares (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, owner TEXT NOT NULL,
      output TEXT, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    ); CREATE INDEX IF NOT EXISTS public_shares_created ON public_shares(created_at);
    CREATE INDEX IF NOT EXISTS public_shares_owner_created ON public_shares(owner, created_at);`);
  }
  /**
   * Persists one snapshot if this browser and the disk still have room. The
   * hourly budget is per owner (one browser cannot exhaust an hour for every
   * rider) and capacity counts live links, so revoking one frees its slot.
   */
  publish(id: string, token: string, owner: string, output: string): PublicSharePublishResult {
    const now = this.#now();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.#db.prepare("SELECT id FROM public_shares WHERE id=? OR token=?").get(id, token) !== undefined) {
        return { state: "exists" };
      }
      // A row past the retention window no longer resolves, so drop it before
      // the budget is counted instead of refusing riders forever.
      this.#db.prepare("DELETE FROM public_shares WHERE created_at < ?").run(now - this.#retentionMs);
      const mine = this.#db.prepare("SELECT COUNT(*) AS n FROM public_shares WHERE owner=? AND created_at>?").get(owner, now - PUBLIC_SHARE_HOUR_MS) as { n: number };
      if (mine.n >= this.#perOwnerPerHour) return { state: "limited", reason: "owner-hourly" };
      const live = this.#db.prepare("SELECT COUNT(*) AS n FROM public_shares WHERE revoked=0").get() as { n: number };
      if (live.n >= this.#capacity) return { state: "limited", reason: "capacity" };
      this.#db.prepare("INSERT INTO public_shares(id,token,owner,output,created_at) VALUES(?,?,?,?,?)").run(id, token, owner, output, now);
      return { state: "created" };
    } finally { this.#db.exec("COMMIT"); }
  }
  resolve(token: string): PublicShareResolution {
    if (!/^[0-9a-f]{64}$/.test(token)) return { state: "not-found" };
    const row = this.#db.prepare("SELECT output,revoked,created_at FROM public_shares WHERE token=?").get(token) as { output: string; revoked: number; created_at: number } | undefined;
    if (row === undefined) return { state: "not-found" };
    if (row.created_at < this.#now() - this.#retentionMs) return { state: "not-found" };
    return row.revoked ? { state: "revoked" } : { state: "active", output: row.output };
  }
  revoke(id: string, owner: string): boolean {
    return Number(this.#db.prepare("UPDATE public_shares SET revoked=1,output=NULL WHERE id=? AND owner=?").run(id, owner).changes) > 0;
  }
  ownedShareId(token: string, owner: string | null): string | null {
    if (owner === null) return null;
    const row = this.#db.prepare("SELECT id FROM public_shares WHERE token=? AND owner=? AND revoked=0").get(token, owner) as { id: string } | undefined;
    return row?.id ?? null;
  }
  close(): void { this.#db.close(); }
}

let shared: SQLitePublicShareStore | undefined;
export function publicShareStore(): SQLitePublicShareStore {
  return shared ??= new SQLitePublicShareStore(process.env.OGV_SHARE_DB_PATH?.trim() || resolve(process.cwd(), "data/public-shares.sqlite"));
}
