import type { ShareRecord, ShareRepositoryPort } from "@/application/sharing/ports/share-repository";

/** Publish remotely before reporting success; local records retain owner UI state. */
export function createPublishedShareRepository(local: ShareRepositoryPort, request: typeof fetch = fetch): ShareRepositoryPort {
  const issued = new Map<string, ShareRecord>();
  async function send(path: string, method: string, body?: unknown): Promise<void> {
    const response = await request(path, {
      method, credentials: "same-origin", headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(result?.message ?? "Sharing is unavailable. Try again when online.");
    }
  }
  return {
    async save(record) {
      await send("/api/shares", "POST", record);
      issued.set(record.shareId, record);
      // IndexedDB is a cache here; a successful public link must stay available
      // even when storage is full. Its owner can also revoke from the link page.
      await local.save(record).catch(() => {});
    },
    findByToken: token => Promise.resolve([...issued.values()].find(r => r.token === token) ?? null).then(record => record ?? local.findByToken(token)),
    async revoke(shareId, revokedAt) {
      await send(`/api/shares/${encodeURIComponent(shareId)}`, "DELETE");
      const record = issued.get(shareId);
      const revoked = record === undefined ? null : { ...record, state: "revoked" as const, revokedAt };
      if (revoked !== null) issued.set(shareId, revoked);
      return await local.revoke(shareId, revokedAt).catch(() => null) ?? revoked;
    },
  };
}
