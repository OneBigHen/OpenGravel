import { isSameOriginMutation, spotifyCookieSecure, spotifyOAuthCookieName, spotifyOriginForRequest, spotifySessionCookieName } from "@/server/spotify/config";
import { expiredCookie } from "@/server/spotify/cookies";
import { jsonResponse } from "@/server/spotify/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Response {
  if (!isSameOriginMutation(request)) return jsonResponse({ ok: false, code: "origin", message: "This request must come from OpenGravel." }, 403);
  const origin = spotifyOriginForRequest(request);
  if (origin === null) return jsonResponse({ ok: false, code: "origin", message: "This OpenGravel origin is not registered for Spotify." }, 400);
  return jsonResponse({ ok: true }, 200, [
    expiredCookie(spotifySessionCookieName(spotifyCookieSecure(origin)), spotifyCookieSecure(origin)),
    expiredCookie(spotifyOAuthCookieName(spotifyCookieSecure(origin)), spotifyCookieSecure(origin)),
  ]);
}
