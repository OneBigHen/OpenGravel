import { deepFreeze } from "@/domain/util/freeze";

/**
 * Share identities (10-SHARING-AND-OFFLINE §10).
 *
 * Two distinct opaque handles, and the distinction is the privacy rule:
 *
 * - `ShareId` is the internal identity of a share record. It never appears in
 *   a link and never appears in a snapshot.
 * - `ShareToken` is the only thing a link carries: 256 bits of randomness in a
 *   URL-safe alphabet. There is no listable sequence to enumerate and no way to
 *   derive one token from another, which is what "unguessable and unlistable"
 *   means in practice.
 */

/** Internal identity of one share record. Never link-facing. */
export type ShareId = string & { readonly __brand: "ShareId" };

/** The unguessable, unlistable capability a share link carries. */
export type ShareToken = string & { readonly __brand: "ShareToken" };

/** 256 bits, rendered as 64 lowercase hex characters. */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function newShareId(): ShareId {
  return `share_${crypto.randomUUID()}` as ShareId;
}

export function asShareId(value: string): ShareId | null {
  return value.startsWith("share_") ? (value as ShareId) : null;
}

export function newShareToken(): ShareToken {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let token = "";
  for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
  return token as ShareToken;
}

/** Structural narrowing only: an unlisted token of the wrong shape is not one. */
export function asShareToken(value: string): ShareToken | null {
  return TOKEN_PATTERN.test(value) ? (value as ShareToken) : null;
}

export { deepFreeze };
