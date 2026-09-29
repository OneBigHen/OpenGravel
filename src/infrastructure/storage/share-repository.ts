import type { ShareId, ShareToken } from "@/domain/sharing/ids";
import type { ShareSnapshot } from "@/domain/sharing/types";
import type {
  ShareRecord,
  ShareRepositoryPort,
} from "@/application/sharing/ports/share-repository";
import { vnextDatabase, type VNextDatabase } from "./db";

/**
 * The IndexedDB adapter for the share record store (10-SHARING-AND-OFFLINE §10).
 *
 * Row contract mirrors `isValidRideRecord`: a row that cannot be trusted is
 * read as absent (`null`), never coerced — an unknown state stays unknown. The
 * port has no list call and neither does this adapter: revocation is served by
 * lookup on the opaque token alone.
 */
export function isValidShareRecord(value: unknown): value is ShareRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ShareRecord>;
  return (
    typeof record.shareId === "string" &&
    typeof record.token === "string" &&
    (record.state === "active" || record.state === "revoked") &&
    typeof record.createdAt === "string" &&
    (record.revokedAt === null || typeof record.revokedAt === "string") &&
    typeof record.snapshot === "object" &&
    record.snapshot !== null
  );
}

class DexieShareRepository implements ShareRepositoryPort {
  readonly #db: VNextDatabase;

  constructor(db: VNextDatabase) {
    this.#db = db;
  }

  async save(record: ShareRecord): Promise<void> {
    await this.#db.shares.put(record);
  }

  async findByToken(token: ShareToken): Promise<ShareRecord | null> {
    const row = await this.#db.shares.where("token").equals(token).first();
    return isValidShareRecord(row) ? row : null;
  }

  async revoke(shareId: ShareId, revokedAt: string): Promise<ShareRecord | null> {
    return this.#db.transaction("rw", this.#db.shares, async () => {
      const row = await this.#db.shares.get(shareId);
      if (!isValidShareRecord(row)) return null;
      if (row.state === "revoked") return row;
      const revoked: ShareRecord = { ...row, state: "revoked", revokedAt };
      await this.#db.shares.put(revoked);
      return revoked;
    });
  }
}

export function createShareRepository(db: VNextDatabase = vnextDatabase()): ShareRepositoryPort {
  return new DexieShareRepository(db);
}

export type { ShareSnapshot };
