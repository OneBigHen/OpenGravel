import { knownRouteName } from "@/server/community-routes/live-catalog";
import { validRestoreSignature } from "@/server/community-routes/notify";
import { sharedCommunityRouteStore } from "@/server/community-routes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font-family:system-ui;background:#f4efe6;color:#1d2a20;max-width:30rem;margin:3rem auto;padding:0 1rem"><h1>${escapeHtml(title)}</h1>${body}</body>`, { status, headers: HTML });
}

function params(url: URL): { id: string; at: string; sig: string } | null {
  const id = url.searchParams.get("id") ?? "";
  const at = url.searchParams.get("at") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || at.length > 40 || sig.length > 128) return null;
  return validRestoreSignature(id, at, sig) ? { id, at, sig } : null;
}

/** The email link opens a confirm page; a mail scanner's GET must not restore anything. */
export function GET(request: Request): Response {
  const link = params(new URL(request.url));
  if (link === null) return page("Link not valid", "<p>This restore link is not valid.</p>", 403);
  const name = knownRouteName(link.id) ?? link.id;
  const hidden = sharedCommunityRouteStore().removal(link.id) !== null;
  if (!hidden) return page("Already live", `<p><b>${escapeHtml(name)}</b> is already visible.</p>`);
  return page("Restore this route?", `<p><b>${escapeHtml(name)}</b> will appear on Explore again.</p><form method="post"><input type="hidden" name="id" value="${escapeHtml(link.id)}"><input type="hidden" name="at" value="${escapeHtml(link.at)}"><input type="hidden" name="sig" value="${escapeHtml(link.sig)}"><button style="font-size:1.1rem;padding:.7rem 1.2rem">Restore route</button></form>`);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const url = new URL(request.url);
  for (const key of ["id", "at", "sig"]) url.searchParams.set(key, String(form.get(key) ?? ""));
  const link = params(url);
  if (link === null) return page("Link not valid", "<p>This restore link is not valid.</p>", 403);
  const restored = sharedCommunityRouteStore().restore(link.id, new Date().toISOString());
  return page(restored ? "Restored" : "Already live", `<p>${restored ? "The route is back on Explore." : "That route was already visible."}</p>`);
}
