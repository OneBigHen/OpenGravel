import { createLogin, SpotifyAuthError } from "@/server/spotify/auth";
import { jsonResponse, redirectOutcome, redirectWithCookie } from "@/server/spotify/http";
import { spotifyOriginForRequest } from "@/server/spotify/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  try {
    const login = createLogin(request);
    return redirectWithCookie(login.redirect, login.cookie);
  } catch (error) {
    const authError = error instanceof SpotifyAuthError ? error : new SpotifyAuthError("configuration", "Spotify sign-in is unavailable.");
    if (authError.publicCode === "configuration" && spotifyOriginForRequest(request) !== null) return redirectOutcome(request, "/settings", "error");
    return jsonResponse({ ok: false, code: authError.publicCode, message: authError.message }, authError.publicCode === "origin" ? 400 : 503);
  }
}
