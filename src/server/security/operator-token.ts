import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of an operator credential carried as
 * `Authorization: Bearer <token>`. Used by the moderation queue and by an
 * operator takedown, which both answer only to the server token, never to
 * something a client mints.
 */
export function bearerTokenMatches(request: Request, token: string): boolean {
  if (token.length === 0) return false;
  const candidate = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (candidate.length === 0) return false;
  // Hashing first makes the comparison length-independent, so it cannot leak
  // how much of the token matched.
  const expected = createHash("sha256").update(token).digest();
  const supplied = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expected, supplied);
}
