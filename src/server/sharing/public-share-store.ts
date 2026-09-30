import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type PublicShareResolution = { state: "active"; output: string } | { state: "revoked" } | { state: "not-found" };

/** Public snapshots are immutable. Owner capabilities never leave the server. */
export class SQLitePublicShareStore {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS public_shares (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, owner TEXT NOT NULL,
      output TEXT, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    ); CREATE INDEX IF NOT EXISTS public_shares_created ON public_shares(created_at);`);
  }
  publish(id: string, token: string, owner: string, output: string): "created" | "exists" | "limited" {
    // Persist the budget as well as the records; restarting cannot reset it.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.#db.prepare("SELECT id FROM public_shares WHERE id=? OR token=?").get(id, token)) return "exists";
      const count = this.#db.prepare("SELECT COUNT(*) AS total, SUM(created_at>?) AS recent FROM public_shares").get(Date.now() - 3600000) as { total: number; recent: number | null };
      if (count.total >= 2000 || (count.recent ?? 0) >= 60) return "limited";
      this.#db.prepare("INSERT INTO public_shares(id,token,owner,output,created_at) VALUES(?,?,?,?,?)").run(id, token, owner, output, Date.now());
      return "created";
    } finally { this.#db.exec("COMMIT"); }
  }
  resolve(token: string): PublicShareResolution {
    if (!/^[0-9a-f]{64}$/.test(token)) return { state: "not-found" };
    const row = this.#db.prepare("SELECT output,revoked FROM public_shares WHERE token=?").get(token) as { output: string; revoked: number } | undefined;
    return row === undefined ? { state: "not-found" } : row.revoked ? { state: "revoked" } : { state: "active", output: row.output };
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
