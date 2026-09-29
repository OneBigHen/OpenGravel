import type { ShareId, ShareToken } from "@/domain/sharing/ids";
import type { ShareRecord, ShareRepositoryPort } from "./ports/share-repository";

/**
 * In-memory share store for tests, SSR, and embeddings without persistence.
 *
 * It implements exactly the port — including the absence of any list call.
 */
export class MemoryShareRepository implements ShareRepositoryPort {
  readonly #byId = new Map<ShareId, ShareRecord>();
  readonly #byToken = new Map<ShareToken, ShareId>();

  async save(record: ShareRecord): Promise<void> {
    this.#byId.set(record.shareId, record);
    this.#byToken.set(record.token, record.shareId);
  }

  async findByToken(token: ShareToken): Promise<ShareRecord | null> {
    const shareId = this.#byToken.get(token);
    return shareId === undefined ? null : (this.#byId.get(shareId) ?? null);
  }

  async revoke(shareId: ShareId, revokedAt: string): Promise<ShareRecord | null> {
    const record = this.#byId.get(shareId);
    if (record === undefined) return null;
    if (record.state === "revoked") return record;
    const revoked: ShareRecord = { ...record, state: "revoked", revokedAt };
    this.#byId.set(shareId, revoked);
    return revoked;
  }
}
