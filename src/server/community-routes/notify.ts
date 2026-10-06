import { createHmac, timingSafeEqual } from "node:crypto";

import { escapeHtml, sendOwnerMail } from "@/server/mail/resend";

type Env = Readonly<Record<string, string | undefined>>;

/** The signed link in the email: restoring needs no login, only this link. */
export function restoreSignature(routeId: string, removedAt: string, env: Env = process.env): string | null {
  const secret = env["OGV_RESTORE_SECRET"];
  if (secret === undefined || secret.length < 16) return null;
  return createHmac("sha256", secret).update(`restore:${routeId}:${removedAt}`).digest("hex");
}

export function validRestoreSignature(routeId: string, removedAt: string, signature: string, env: Env = process.env): boolean {
  const expected = restoreSignature(routeId, removedAt, env);
  if (expected === null || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function restoreUrl(routeId: string, removedAt: string, env: Env = process.env): string | null {
  const signature = restoreSignature(routeId, removedAt, env);
  const origin = env["OGV_PUBLIC_ORIGIN"];
  if (signature === null || origin === undefined) return null;
  const query = new URLSearchParams({ id: routeId, at: removedAt, sig: signature });
  return `${origin}/api/community/restore?${query.toString()}`;
}

/**
 * Tells the owner a route was removed, with the link that brings it back.
 * Best effort: the removal is already saved and can be restored later.
 */
export async function notifyRouteRemoved(
  input: { readonly routeId: string; readonly name: string; readonly reason: string; readonly removedAt: string },
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const restore = restoreUrl(input.routeId, input.removedAt, env);
  const reason = input.reason === "" ? "(no reason given)" : input.reason;
  const text = [
    `A route was removed from OpenGravel.`,
    ``,
    `Route: ${input.name}`,
    `Id: ${input.routeId}`,
    `When: ${input.removedAt}`,
    `Reason: ${reason}`,
    ``,
    restore === null ? "Restore link unavailable (OGV_RESTORE_SECRET is not set)." : `Restore it: ${restore}`,
  ].join("\n");
  const html = `<p>A route was removed from OpenGravel.</p><p><b>${escapeHtml(input.name)}</b><br>Id: ${escapeHtml(input.routeId)}<br>When: ${escapeHtml(input.removedAt)}<br>Reason: ${escapeHtml(reason)}</p>${restore === null ? "" : `<p><a href="${escapeHtml(restore)}">Restore this route</a></p>`}`;
  return sendOwnerMail({ subject: `OpenGravel route removed: ${input.name}`, text, html, event: "route-removed" }, env, fetcher);
}
