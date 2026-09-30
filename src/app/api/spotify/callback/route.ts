import { clearOAuthCookie, exchangeCode, readOAuthState, storeSession, SpotifyAuthError } from "@/server/spotify/auth";
import { spotifyOriginForRequest } from "@/server/spotify/config";
import { jsonResponse, redirectOutcome } from "@/server/spotify/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const origin = spotifyOriginForRequest(request);
  if (origin === null) return jsonResponse({ ok: false, code: "origin", message: "This OpenGravel origin is not registered for Spotify." }, 400);
  const url = new URL(request.url);
  const state = readOAuthState(request);
  const clearCookie = clearOAuthCookie(origin);
  if (state === null || state.origin !== origin) return redirectOutcome(request, "/settings", "error", clearCookie);
  if (url.searchParams.get("state") !== state.state) return redirectOutcome(request, "/settings", "error", clearCookie);
  if (url.searchParams.get("error") !== null) return redirectOutcome(request, state.returnTo, "cancelled", clearCookie);
  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) {
    return redirectOutcome(request, state.returnTo, "error", clearCookie);
  }
  try {
    const session = await exchangeCode(state, code);
    const sessionCookie = storeSession(session, origin);
    const response = redirectOutcome(request, state.returnTo, "connected", clearCookie);
    response.headers.append("set-cookie", sessionCookie);
    return response;
  } catch (error) {
    if (error instanceof SpotifyAuthError && error.publicCode === "configuration") return jsonResponse({ ok: false, code: "configuration", message: error.message }, 503);
    return redirectOutcome(request, state.returnTo, "error", clearCookie);
  }
}
