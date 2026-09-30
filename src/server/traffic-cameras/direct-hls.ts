/**
 * Same-origin HLS relay for state feeds that already publish direct HLS URLs.
 *
 * This is deliberately separate from PA's DIVAS resolver: PA must first
 * resolve a short-lived upstream stream URL, while DE/MD/VA/WV/NJ can hand us
 * an HLS URL directly from their public camera metadata.
 */

import {
  decryptPa511RelayToken,
  rewritePa511Manifest,
} from "@/server/traffic-cameras/pa511-hls";
import {
  TRAFFIC_CAMERA_ADAPTERS,
  type TrafficCameraState,
} from "@/server/traffic-cameras/registry";
import type { ProviderContext } from "@/server/map-layers/providers";

const SUPPORTED_DIRECT_STATES = new Set<TrafficCameraState>(["NJ", "DE", "MD", "VA", "WV"]);

export interface DirectCameraHlsDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

function secret(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env["TRAFFIC_CAMERA_VIDEO_PROXY_SECRET"]?.trim() ?? "";
  return value.length >= 24 ? value : null;
}

function stateOf(raw: string): TrafficCameraState | null {
  const value = raw.toUpperCase() as TrafficCameraState;
  return SUPPORTED_DIRECT_STATES.has(value) ? value : null;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function refererFor(state: TrafficCameraState): string {
  return {
    NJ: "https://511nj.org/camera",
    DE: "https://deldot.gov/map/",
    MD: "https://chart.maryland.gov/TrafficCameras/GetTrafficCameras",
    VA: "https://511.vdot.virginia.gov/",
    WV: "https://wv511.org/",
    PA: "https://www.511pa.com/cctv",
    NY: "https://511ny.org/cctv",
    OH: "https://ohgo.com/",
  }[state];
}

async function resolveCameraUrl(
  state: TrafficCameraState,
  cameraId: string,
  context: ProviderContext,
): Promise<URL> {
  const adapter = TRAFFIC_CAMERA_ADAPTERS.find((candidate) => candidate.state === state);
  if (adapter === undefined) throw new Error("Unsupported camera state");
  const cameras = await adapter.load(context);
  const camera = cameras.find((candidate) => candidate.id === cameraId);
  if (camera?.playbackUrl === null || camera?.playbackUrl === undefined) throw new Error("Camera has no HLS stream");
  const url = new URL(camera.playbackUrl);
  if (url.protocol !== "https:") throw new Error("Camera stream must use HTTPS");
  return url;
}

function relayPath(state: TrafficCameraState, cameraId: string): string {
  return `/api/traffic-cameras/direct/${state}/${encodeURIComponent(cameraId)}/hls`;
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

function isPlaylist(url: URL, contentType: string | null): boolean {
  return url.pathname.toLowerCase().endsWith(".m3u8") || (contentType ?? "").toLowerCase().includes("mpegurl");
}

export async function handleDirectCameraHls(
  request: Request,
  rawState: string,
  cameraId: string,
  deps: DirectCameraHlsDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  if (env["TRAFFIC_CAMERAS_ENABLED"] !== "1") return new Response("Traffic camera video is disabled.", { status: 404 });
  const state = stateOf(rawState);
  if (state === null || !/^[A-Za-z0-9_.:-]{1,120}$/.test(cameraId)) return new Response("Invalid camera.", { status: 400 });
  const relaySecret = secret(env);
  if (relaySecret === null) return new Response("Traffic camera video proxy is not configured.", { status: 503 });

  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("r");
  const relayIdentity = `${state}:${cameraId}`;
  let upstreamUrl: URL;

  if (token === null) {
    try {
      upstreamUrl = await resolveCameraUrl(state, cameraId, { fetch: fetcher, env, signal: request.signal });
    } catch {
      return new Response("Live camera is unavailable.", { status: 502 });
    }
  } else {
    try {
      const payload = decryptPa511RelayToken(token, relaySecret);
      if (payload.cameraId !== relayIdentity || payload.expiresAt <= now()) {
        return new Response("Live camera relay token expired.", { status: 410 });
      }
      upstreamUrl = new URL(payload.upstreamUrl);
      if (upstreamUrl.protocol !== "https:") throw new Error("non-HTTPS resource");
    } catch {
      return new Response("Invalid live camera relay token.", { status: 400 });
    }
  }

  const referer = refererFor(state);
  const headers = new Headers({
    accept: "*/*",
    origin: new URL(referer).origin,
    referer,
    "user-agent": "OpenGravel/0.1 personal route planner (traffic cameras)",
  });
  const range = request.headers.get("range");
  if (range !== null) headers.set("range", range);

  let upstream: Response;
  try {
    upstream = await fetcher(upstreamUrl, {
      headers,
      redirect: "follow",
      signal: withTimeout(request.signal, 15_000),
    });
  } catch {
    return new Response("Live camera upstream failed.", { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) return new Response("Live camera upstream rejected the request.", { status: 502 });

  if (isPlaylist(upstreamUrl, upstream.headers.get("content-type"))) {
    const manifest = await upstream.text();
    if (!manifest.trimStart().startsWith("#EXTM3U")) return new Response("Live camera returned an invalid playlist.", { status: 502 });
    const rewritten = rewritePa511Manifest(
      manifest,
      upstreamUrl,
      relayIdentity,
      relaySecret,
      relayPath(state, cameraId),
      now(),
    );
    return new Response(rewritten, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return new Response(upstream.body, { status: upstream.status, headers: mediaHeaders(upstream) });
}

export function directCameraPlaybackPath(
  rawState: string,
  cameraId: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const state = stateOf(rawState);
  if (state === null) return null;
  return secret(env) === null ? null : relayPath(state, cameraId);
}
