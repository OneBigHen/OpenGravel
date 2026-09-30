/**
 * Opt-in 511PA HLS resolver/relay for personal OpenGravel deployments.
 *
 * 511PA's public camera UI resolves a short-lived DIVAS URL before playback.
 * The browser never receives the 511PA session cookie or anti-CSRF token here.
 * Playlists and media are fetched server-side with the upstream Origin/Referer
 * and playlist child URIs are rewritten back through this same-origin route.
 *
 * Child resource URLs are AES-GCM encrypted into opaque relay tokens so the
 * short-lived upstream stream URL is not exposed in markup or network URLs.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import {
  PA511_CCTV_URL,
  PA511_ORIGIN,
  PA511_USER_AGENT,
  createPa511Session,
  loadPa511CameraCatalog,
  type Pa511Camera,
} from "@/server/map-layers/pa511-cameras";
import type { ProviderContext } from "@/server/map-layers/providers";

const PA_AUTH_URL = "https://pa.arcadis-ivds.com/api/SecureTokenUri/GetSecureTokenUriBySourceId";
const RELAY_TOKEN_TTL_MS = 10 * 60_000;
const MIN_SECRET_LENGTH = 24;

interface RelayTokenPayload {
  readonly version: 1;
  readonly cameraId: string;
  readonly upstreamUrl: string;
  readonly expiresAt: number;
}

export interface Pa511HlsDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

function videoEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env["PA511_VIDEO_ENABLED"] === "1";
}

function proxySecret(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env["PA511_VIDEO_PROXY_SECRET"]?.trim() ?? "";
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function keyFor(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptPa511RelayToken(payload: RelayTokenPayload, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptPa511RelayToken(token: string, secret: string): RelayTokenPayload {
  const packed = Buffer.from(token, "base64url");
  if (packed.length < 29) throw new Error("Malformed relay token");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Malformed relay token payload");
  const value = parsed as Partial<RelayTokenPayload>;
  if (
    value.version !== 1 ||
    typeof value.cameraId !== "string" ||
    typeof value.upstreamUrl !== "string" ||
    typeof value.expiresAt !== "number"
  ) {
    throw new Error("Malformed relay token payload");
  }
  return value as RelayTokenPayload;
}

function parseJsonOrText(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw.trim();
  }
}

function stringResult(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function cameraById(cameraId: string, context: ProviderContext): Promise<Pa511Camera> {
  const cameras = await loadPa511CameraCatalog(context);
  const camera = cameras.find((entry) => entry.id === cameraId);
  if (camera === undefined) throw new Error("Unknown 511PA camera");
  if (camera.videoUrl === null) throw new Error("Camera has no live video");
  return camera;
}

export async function resolvePa511VideoUrl(
  cameraId: string,
  context: ProviderContext,
): Promise<URL> {
  const camera = await cameraById(cameraId, context);
  const session = await createPa511Session(context);

  const authResponse = await context.fetch(
    `${PA511_ORIGIN}/Camera/GetVideoUrl?imageId=${encodeURIComponent(camera.imageId)}`,
    {
      headers: {
        accept: "application/json, text/plain, */*",
        cookie: session.cookie,
        "user-agent": PA511_USER_AGENT,
        "x-requested-with": "XMLHttpRequest",
        "__requestverificationtoken": session.verificationToken,
      },
      signal: withTimeout(context.signal, 12_000),
    },
  );
  if (!authResponse.ok) throw new Error(`511PA video authorization ${authResponse.status}`);
  const authorization = parseJsonOrText(await authResponse.text());

  const direct = stringResult(authorization);
  if (direct !== null) {
    const url = new URL(direct, PA511_ORIGIN);
    if (url.protocol !== "https:") throw new Error("511PA returned a non-HTTPS stream");
    return url;
  }

  const tokenResponse = await context.fetch(PA_AUTH_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: PA511_ORIGIN,
      referer: `${PA511_ORIGIN}/`,
      "user-agent": PA511_USER_AGENT,
    },
    body: JSON.stringify(authorization),
    signal: withTimeout(context.signal, 12_000),
  });
  if (!tokenResponse.ok) throw new Error(`PA DIVAS token exchange ${tokenResponse.status}`);
  const suffix = stringResult(parseJsonOrText(await tokenResponse.text()));
  if (suffix === null) throw new Error("PA DIVAS did not return a stream token");

  const url = new URL(`${camera.videoUrl}${suffix}`);
  if (url.protocol !== "https:") throw new Error("PA DIVAS returned a non-HTTPS stream");
  return url;
}

function relayUrl(relayPath: string, token: string): string {
  return `${relayPath}?r=${encodeURIComponent(token)}`;
}

function resourceUrl(uri: string, base: URL): URL {
  const resolved = new URL(uri, base);
  // Some HLS origins issue a token only on the parent playlist. Preserve that
  // query for otherwise-unqualified child resources.
  if (resolved.search === "" && base.search !== "") resolved.search = base.search;
  return resolved;
}

function rewriteUri(
  uri: string,
  base: URL,
  cameraId: string,
  secret: string,
  relayPath: string,
  now: number,
): string {
  const upstream = resourceUrl(uri, base);
  if (upstream.protocol !== "https:") throw new Error("Refusing non-HTTPS HLS resource");
  const token = encryptPa511RelayToken({
    version: 1,
    cameraId,
    upstreamUrl: upstream.toString(),
    expiresAt: now + RELAY_TOKEN_TTL_MS,
  }, secret);
  return relayUrl(relayPath, token);
}

export function rewritePa511Manifest(
  manifest: string,
  base: URL,
  cameraId: string,
  secret: string,
  relayPath: string,
  now = Date.now(),
): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return line;
      if (!trimmed.startsWith("#")) {
        return rewriteUri(trimmed, base, cameraId, secret, relayPath, now);
      }
      if (!line.includes("URI=\"")) return line;
      return line.replace(/URI="([^"]+)"/g, (_whole, uri: string) =>
        `URI="${rewriteUri(uri, base, cameraId, secret, relayPath, now)}"`);
    })
    .join("\n");
}

function looksLikePlaylist(url: URL, contentType: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  return url.pathname.toLowerCase().endsWith(".m3u8") || type.includes("mpegurl");
}

function upstreamHeaders(request: Request): Headers {
  const headers = new Headers({
    accept: "*/*",
    origin: PA511_ORIGIN,
    referer: `${PA511_ORIGIN}/`,
    "user-agent": PA511_USER_AGENT,
  });
  const range = request.headers.get("range");
  if (range !== null) headers.set("range", range);
  return headers;
}

function mediaHeaders(upstream: Response): Headers {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export async function handlePa511HlsRequest(
  request: Request,
  cameraId: string,
  deps: Pa511HlsDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  if (!videoEnabled(env)) return new Response("Traffic camera video is disabled.", { status: 404 });
  const secret = proxySecret(env);
  if (secret === null) return new Response("Traffic camera video proxy is not configured.", { status: 503 });
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cameraId)) return new Response("Invalid camera.", { status: 400 });

  const now = deps.now ?? Date.now;
  const fetcher = deps.fetch ?? fetch;
  const url = new URL(request.url);
  const relayPath = url.pathname;
  const token = url.searchParams.get("r");

  let upstreamUrl: URL;
  if (token === null) {
    try {
      upstreamUrl = await resolvePa511VideoUrl(cameraId, { fetch: fetcher, env, signal: request.signal });
    } catch {
      return new Response("Live camera is unavailable.", { status: 502 });
    }
  } else {
    try {
      const payload = decryptPa511RelayToken(token, secret);
      if (payload.cameraId !== cameraId || payload.expiresAt <= now()) {
        return new Response("Live camera relay token expired.", { status: 410 });
      }
      upstreamUrl = new URL(payload.upstreamUrl);
      if (upstreamUrl.protocol !== "https:") throw new Error("non-HTTPS resource");
    } catch {
      return new Response("Invalid live camera relay token.", { status: 400 });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetcher(upstreamUrl, {
      headers: upstreamHeaders(request),
      signal: withTimeout(request.signal, 15_000),
      redirect: "follow",
    });
  } catch {
    return new Response("Live camera upstream failed.", { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Live camera upstream rejected the request.", { status: 502 });
  }

  if (looksLikePlaylist(upstreamUrl, upstream.headers.get("content-type"))) {
    const manifest = await upstream.text();
    if (!manifest.trimStart().startsWith("#EXTM3U")) {
      return new Response("Live camera returned an invalid playlist.", { status: 502 });
    }
    const rewritten = rewritePa511Manifest(manifest, upstreamUrl, cameraId, secret, relayPath, now());
    return new Response(rewritten, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: mediaHeaders(upstream),
  });
}
