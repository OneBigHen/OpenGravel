import type { ShareId, ShareToken } from "@/domain/sharing/ids";
import type { ShareSnapshot } from "@/domain/sharing/types";

/**
 * The share record store (10-SHARING-AND-OFFLINE §10).
 *
 * The port is deliberately capability-shaped: look a record up by its opaque
 * token, and revoke one by id. There is no `list` and no enumeration — a store
 * that cannot list shares keeps the "unlistable" half of the link promise even
 * if some later adapter wanted to be helpful.
 */
export interface ShareRecord {
  readonly shareId: ShareId;
  readonly token: ShareToken;
  readonly state: "active" | "revoked";
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly snapshot: ShareSnapshot;
}

export interface ShareRepositoryPort {
  save(record: ShareRecord): Promise<void>;
  findByToken(token: ShareToken): Promise<ShareRecord | null>;
  /** Revokes by id; `null` means no such share. Re-revoking keeps the first time. */
  revoke(shareId: ShareId, revokedAt: string): Promise<ShareRecord | null>;
}
