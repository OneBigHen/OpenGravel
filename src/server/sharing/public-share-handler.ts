import { createHash, randomBytes } from "node:crypto";
import type { ShareSnapshot } from "@/domain/sharing/types";
import { serializeShareSnapshot } from "@/domain/sharing/snapshot";
import { routeDistanceMeters } from "@/domain/sharing/privacy";
import type { SQLitePublicShareStore } from "./public-share-store";

const MAX_BYTES = 256 * 1024;
const COOKIE = "og-share-owner";
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
const reply = (status: number, message: string) => Response.json({ message }, { status, headers });
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const aggregate = (v: unknown) => v === null || amount(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const hash = (owner: string) => createHash("sha256").update(owner).digest("hex");
export function shareOwnerHash(owner: string | undefined): string | null {
  return owner !== undefined && /^[0-9a-f]{64}$/.test(owner) ? hash(owner) : null;
}
function ownerCookie(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  return value !== undefined && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
function externalProtocol(request: Request): string {
  return request.headers.get("x-forwarded-proto") === "https" ? "https:" : new URL(request.url).protocol;
}
function sameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  // Next normalizes its internal URL host. The browser's Host stays authoritative.
  const host = request.headers.get("host") ?? url.host;
  const protocol = externalProtocol(request);
  return request.headers.get("origin") === `${protocol}//${host}`;
}

/** Rebuild the allowlist, never persist a client object or extra GPS fields. */
function snapshot(value: unknown): ShareSnapshot | null {
  if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.sourceRevision) || (value.sourceRevision as number) < 0 || !text(value.title, 200)) return null;
  if (!object(value.route) || !Array.isArray(value.route.segments) || value.route.segments.length > 1000) return null;
  let points = 0;
  const segments: { lon: number; lat: number }[][] = [];
  for (const segment of value.route.segments) {
    if (!Array.isArray(segment) || segment.length < 2) return null;
    const clean: { lon: number; lat: number }[] = [];
    for (const p of segment) {
      if (!object(p) || typeof p.lon !== "number" || typeof p.lat !== "number" || !Number.isFinite(p.lon) || !Number.isFinite(p.lat) || Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90 || ++points > 10000) return null;
      clean.push({ lon: p.lon, lat: p.lat });
    }
    segments.push(clean);
  }
  if (points < 2 || !amount(value.distanceMeters) || !aggregate(value.rideDistanceMeters) || !aggregate(value.rideDurationSeconds)) return null;
  const distanceMeters = routeDistanceMeters({ segments });
  if (value.distanceMeters !== distanceMeters || (value.rideDistanceMeters !== null && (value.rideDistanceMeters as number) > 100000000) || (value.rideDurationSeconds !== null && (value.rideDurationSeconds as number) > 31536000)) return null;
  if (!object(value.surface) || !["pavement", "mostly-pavement", "mixed", "dirt-preferred"].includes(String(value.surface.preference)) || !["allow-with-warning", "avoid-when-possible"].includes(String(value.surface.unknownSurfacePolicy))) return null;
  if (value.author !== null && (!object(value.author) || !text(value.author.pseudonym, 100))) return null;
  if (!object(value.source) || !["new", "import", "catalog", "shared", "recorded", "recreated-from-track", "derived"].includes(String(value.source.attribution))) return null;
  return {
    version: 1, sourceRevision: value.sourceRevision as number, title: value.title,
    route: { segments }, distanceMeters,
    rideDistanceMeters: value.rideDistanceMeters as number | null, rideDurationSeconds: value.rideDurationSeconds as number | null,
    surface: { preference: value.surface.preference as ShareSnapshot["surface"]["preference"], unknownSurfacePolicy: value.surface.unknownSurfacePolicy as ShareSnapshot["surface"]["unknownSurfacePolicy"] },
    author: value.author === null ? null : { pseudonym: (value.author as Record<string, unknown>).pseudonym as string },
    source: { attribution: value.source.attribution as ShareSnapshot["source"]["attribution"] },
  };
}

export async function handlePublishShare(request: Request, store: SQLitePublicShareStore): Promise<Response> {
  if (!sameOrigin(request)) return reply(403, "Publishing requires the same origin.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(400, "A JSON snapshot is required.");
  let body: unknown;
  if (!request.body) return reply(400, "A snapshot is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder(); let size = 0, input = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return reply(413, "This shared route is too large."); }
      input += decoder.decode(chunk.value, { stream: true });
    }
    body = JSON.parse(input + decoder.decode()) as unknown;
  } catch { return reply(400, "The snapshot is invalid."); }
  if (!object(body) || typeof body.shareId !== "string" || !/^share_[0-9a-f-]{36}$/.test(body.shareId) || typeof body.token !== "string" || !/^[0-9a-f]{64}$/.test(body.token) || body.state !== "active") return reply(400, "The share identity is invalid.");
  const clean = snapshot(body.snapshot);
  if (!clean) return reply(400, "The snapshot is invalid.");
  const owner = ownerCookie(request) ?? randomBytes(32).toString("hex");
  const result = store.publish(body.shareId, body.token, hash(owner), serializeShareSnapshot(clean));
  if (result === "exists") return reply(409, "This link has already been issued.");
  if (result === "limited") return reply(429, "Sharing is temporarily at capacity. Try again later.");
  const response = reply(201, "Share published.");
  response.headers.set("set-cookie", `${COOKIE}=${owner}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${externalProtocol(request) === "https:" ? "; Secure" : ""}`);
  return response;
}

export async function handleRevokeShare(request: Request, shareId: string, store: SQLitePublicShareStore): Promise<Response> {
  if (!sameOrigin(request)) return reply(403, "Revocation requires the same origin.");
  const owner = ownerCookie(request);
  return owner && store.revoke(shareId, hash(owner)) ? reply(200, "Share revoked.") : reply(404, "Share not found for this browser.");
}
