import { spotifyOriginForRequest } from "./config";
import { serializeCookie } from "./cookies";
import type { SpotifyApiError } from "./types";

export function jsonResponse(body: unknown, status = 200, cookies: readonly string[] = []): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export function apiErrorResponse(error: SpotifyApiError, cookie?: string): Response {
  const message = error.code === "premium_required"
    ? "Spotify playback is restricted. Check Premium and this app's tester access in Spotify setup."
    : error.code === "no_device"
      ? "Open Spotify on a device and start playback first."
      : error.code === "rate_limited"
        ? "Spotify is rate limited. Try again shortly."
        : error.code === "reauthorize"
          ? "Connect Spotify again."
          : "Spotify is temporarily unavailable.";
  return jsonResponse({ ok: false, code: error.code, message, ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }) }, error.status, cookie === undefined ? [] : [cookie]);
}

export function originError(): Response {
  return jsonResponse({ ok: false, code: "origin", message: "This OpenGravel origin is not registered for Spotify." }, 400);
}

export function redirectWithCookie(location: string, cookie: string): Response {
  const response = new Response(null, { status: 303, headers: { location } });
  response.headers.append("set-cookie", cookie);
  response.headers.set("cache-control", "no-store");
  return response;
}

export function redirectOutcome(request: Request, returnTo: string, outcome: "connected" | "cancelled" | "error", cookie?: string): Response {
  const origin = spotifyOriginForRequest(request);
  const targetOrigin = origin ?? "https://invalid.invalid";
  const target = new URL(returnTo, targetOrigin);
  target.searchParams.set("spotify", outcome);
  const response = new Response(null, { status: 303, headers: { location: target.toString() } });
  if (cookie !== undefined) response.headers.append("set-cookie", cookie);
  response.headers.set("cache-control", "no-store");
  return response;
}

export function sessionCookieWithOrigin(cookie: string, request: Request): string {
  const origin = spotifyOriginForRequest(request);
  return origin === null ? cookie : serializeCookie("ogv_spotify_session", cookie, { secure: origin.startsWith("https://") });
}
