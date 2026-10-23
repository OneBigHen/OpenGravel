/**
 * The device storage budget shared by the two halves of an offline area.
 *
 * An area is a road graph in IndexedDB (planning) and a map archive in OPFS
 * (drawing); the browser reports one budget for both, and either half can fill
 * the phone. Nothing here decides what is enough on its own: the caller asks
 * for the bytes the whole area still needs, so a region whose archive is four
 * times its roads is refused before the rider waits for the roads.
 */

/** What a rider sees when the area they picked cannot fit. */
export const STORAGE_QUOTA_MESSAGE = "There is not enough storage on this device for this area.";

/** Bytes written between two storage-estimate reads during a long download. */
export const QUOTA_RECHECK_BYTES = 64 * 1024 * 1024;

/**
 * Whether the origin ran out of its storage budget.
 *
 * Chromium and Firefox both use `QuotaExceededError`; the Gecko DOM name is
 * kept because it still surfaces from a few file-system writes.
 */
export function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { readonly name?: unknown }).name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/**
 * True when the device can hold `requiredBytes` more of this origin's data.
 *
 * A browser that cannot answer (no StorageManager, a blocked estimate) is not
 * treated as full: the write itself is the authority then, and its
 * `QuotaExceededError` is mapped by the caller.
 */
export async function hasSpaceFor(
  requiredBytes: number,
  options: { readonly requestPersistence?: boolean } = {},
): Promise<boolean> {
  if (!(requiredBytes > 0)) return true;
  try {
    if (options.requestPersistence === true) {
      // A persisted origin is evicted last, which is the only promise a big
      // download on a phone can honestly make. A refusal changes nothing.
      await globalThis.navigator?.storage?.persist?.().catch(() => false);
    }
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    const quota = estimate?.quota;
    if (quota === undefined) return true;
    return quota - (estimate?.usage ?? 0) >= requiredBytes;
  } catch {
    return true;
  }
}
