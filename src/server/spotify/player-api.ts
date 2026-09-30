import { spotifyCookieSecure, spotifySessionCookieName, spotifySessionKey, spotifyOriginForRequest } from "./config";
import { opaqueHash, openJson, sealJson } from "./crypto";
import { expiredCookie, readCookie, serializeCookie } from "./cookies";
import { refreshSession } from "./auth";
import type { SpotifyApiError, SpotifySession, SpotifyStateResponse } from "./types";
import type { SpotifyPlayerSnapshot, SpotifyTrack } from "@/application/ride-session/ports/spotify-player";

const API_URL = "https://api.spotify.com/v1";
const refreshFlights = new Map<string, Promise<SpotifySession>>();
const refreshResults = new Map<string, { readonly session: SpotifySession; readonly expiresAt: number }>();

interface AccessResult {
  readonly session: SpotifySession;
  readonly setCookie?: string;
}

export interface PlayerApiResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: SpotifyApiError;
  readonly setCookie?: string;
}

export async function readPlayerState(request: Request): Promise<PlayerApiResult<SpotifyStateResponse>> {
  let access = await accessForRequest(request);
  if ("error" in access) return { ok: false, error: access.error, setCookie: access.setCookie };
  let response = await spotifyFetch(access.session, "/me/player");
  if (response.status === 401 && access.setCookie === undefined) {
    const retryAccess = await refreshAccess(request, access.session);
    if ("error" in retryAccess) return { ok: false, error: retryAccess.error, setCookie: retryAccess.setCookie };
    access = retryAccess;
    response = await spotifyFetch(access.session, "/me/player");
  }
  if (!response.ok && response.status !== 204) return withError(response, access.setCookie);
  let snapshot: SpotifyPlayerSnapshot;
  if (response.status === 204) {
    snapshot = connectedSnapshot("No active Spotify device.");
  } else {
    try {
      snapshot = snapshotFromPayload(await response.json());
    } catch {
      return { ok: false, error: { status: 502, code: "spotify_unavailable" }, setCookie: access.setCookie };
    }
  }
  return { ok: true, value: { ...snapshot, accountConnected: true }, setCookie: access.setCookie };
}

export async function sendPlayerCommand(
  request: Request,
  command: "play" | "pause" | "next" | "previous",
): Promise<PlayerApiResult<SpotifyStateResponse>> {
  let access = await accessForRequest(request);
  if ("error" in access) return { ok: false, error: access.error, setCookie: access.setCookie };
  const paths: Record<typeof command, { method: "PUT" | "POST"; path: string }> = {
    play: { method: "PUT", path: "/me/player/play" },
    pause: { method: "PUT", path: "/me/player/pause" },
    next: { method: "POST", path: "/me/player/next" },
    previous: { method: "POST", path: "/me/player/previous" },
  };
  let commandResponse = await spotifyFetch(access.session, paths[command].path, paths[command].method);
  if (commandResponse.status === 401 && access.setCookie === undefined) {
    const retryAccess = await refreshAccess(request, access.session);
    if ("error" in retryAccess) return { ok: false, error: retryAccess.error, setCookie: retryAccess.setCookie };
    access = retryAccess;
    commandResponse = await spotifyFetch(access.session, paths[command].path, paths[command].method);
  }
  if (!commandResponse.ok && commandResponse.status !== 204) return withError(commandResponse, access.setCookie);
  const state = await readPlayerState(requestWithCookie(request, access.session, access.setCookie));
  return state.setCookie === undefined && access.setCookie !== undefined
    ? { ...state, setCookie: access.setCookie }
    : state;
}

export function readSession(request: Request): SpotifySession | null {
  const origin = spotifyOriginForRequest(request);
  return origin === null ? null : openJson<SpotifySession>(readCookie(request, spotifySessionCookieName(spotifyCookieSecure(origin))), spotifySessionKey());
}

export function clearSessionCookie(origin: string): string {
  return expiredCookie(spotifySessionCookieName(spotifyCookieSecure(origin)), spotifyCookieSecure(origin));
}

async function accessForRequest(request: Request): Promise<
  AccessResult | { readonly error: SpotifyApiError; readonly setCookie?: string }
> {
  const origin = spotifyOriginForRequest(request);
  const rawCookie = origin === null ? null : readCookie(request, spotifySessionCookieName(spotifyCookieSecure(origin)));
  const session = openJson<SpotifySession>(rawCookie, spotifySessionKey());
  if (session === null || session.expiresAt <= 0 || session.accessToken.length === 0 || session.refreshToken.length === 0) {
    return { error: { status: 401, code: "reauthorize" } };
  }
  if (session.expiresAt > Date.now() + 30_000) return { session };
  return refreshAccess(request, session);
}

async function refreshAccess(request: Request, session: SpotifySession): Promise<
  AccessResult | { readonly error: SpotifyApiError; readonly setCookie?: string }
> {
  const key = opaqueHash(`${session.clientId}:${session.refreshToken}`);
  const cached = refreshResults.get(key);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return sessionAccessResult(request, cached.session);
  }
  if (cached !== undefined) refreshResults.delete(key);
  let flight = refreshFlights.get(key);
  if (flight === undefined) {
    flight = refreshSession(session)
      .then((refreshed) => {
        refreshResults.set(key, { session: refreshed, expiresAt: Date.now() + 30_000 });
        while (refreshResults.size > 16) {
          const oldest = refreshResults.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          refreshResults.delete(oldest);
        }
        return refreshed;
      })
      .finally(() => { refreshFlights.delete(key); });
    refreshFlights.set(key, flight);
  }
  try {
    const refreshed = await flight;
    return sessionAccessResult(request, refreshed);
  } catch {
    return { error: { status: 401, code: "reauthorize" }, setCookie: clearSessionCookie(new URL(request.url).origin) };
  }
}

function sessionAccessResult(request: Request, session: SpotifySession): AccessResult | { readonly error: SpotifyApiError } {
  const sealed = sealJson(session, spotifySessionKey());
  if (sealed === null) return { error: { status: 503, code: "spotify_unavailable" } };
  const origin = new URL(request.url).origin;
  return {
    session,
    setCookie: serializeCookie(spotifySessionCookieName(spotifyCookieSecure(origin)), sealed, {
      maxAge: 60 * 60 * 24 * 30,
      secure: spotifyCookieSecure(origin),
    }),
  };
}

async function spotifyFetch(session: SpotifySession, path: string, method: "GET" | "PUT" | "POST" = "GET"): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response(null, { status: 599 });
  }
}

function requestWithCookie(request: Request, session: SpotifySession, setCookie: string | undefined): Request {
  if (setCookie === undefined) return request;
  // The state read after a command must use the refreshed access token even
  // before the browser receives the Set-Cookie response.
  const sealed = sealJson(session, spotifySessionKey());
  if (sealed === null) return request;
  const origin = spotifyOriginForRequest(request);
  if (origin === null) return request;
  const headers = new Headers(request.headers);
  headers.set("cookie", `${spotifySessionCookieName(spotifyCookieSecure(origin))}=${encodeURIComponent(sealed)}`);
  return new Request(request, { headers });
}

async function withError(response: Response, setCookie?: string): Promise<PlayerApiResult<never>> {
  if (response.status === 401) return { ok: false, error: { status: 401, code: "reauthorize" }, setCookie };
  if (response.status === 403) return { ok: false, error: { status: 403, code: "premium_required" }, setCookie };
  if (response.status === 404) return { ok: false, error: { status: 404, code: "no_device" }, setCookie };
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const retryAfterSeconds = header === null ? undefined : Number.parseInt(header, 10);
    return {
      ok: false,
      error: { status: 429, code: "rate_limited", ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {}) },
      setCookie,
    };
  }
  return { ok: false, error: { status: 502, code: "spotify_unavailable" }, setCookie };
}

function connectedSnapshot(errorMessage: string | null): SpotifyPlayerSnapshot {
  return { connection: "connected", isPlaying: false, track: null, errorMessage };
}

function snapshotFromPayload(payload: unknown): SpotifyPlayerSnapshot {
  if (typeof payload !== "object" || payload === null) return connectedSnapshot("Spotify returned an unreadable player state.");
  const data = payload as { is_playing?: unknown; item?: unknown };
  const item = data.item as { uri?: unknown; name?: unknown; artists?: unknown; album?: { images?: unknown } } | null | undefined;
  const artist = Array.isArray(item?.artists) && typeof item.artists[0] === "object" && item.artists[0] !== null && "name" in item.artists[0]
    ? String((item.artists[0] as { name?: unknown }).name ?? "")
    : "";
  const track: SpotifyTrack | null = typeof item?.uri === "string" && typeof item.name === "string"
    ? { uri: item.uri, title: item.name, artist, artworkDataUrl: null }
    : null;
  return { connection: "connected", isPlaying: data.is_playing === true, track, errorMessage: track === null ? "No active Spotify device." : null };
}
