import { readPlayerState } from "@/server/spotify/player-api";
import { apiErrorResponse, jsonResponse } from "@/server/spotify/http";
import { readSession } from "@/server/spotify/player-api";
import type { SpotifyStateResponse } from "@/server/spotify/types";
import { spotifyOriginForRequest, spotifySessionKey } from "@/server/spotify/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (spotifyOriginForRequest(request) === null) return jsonResponse({ ok: false, code: "origin", message: "This OpenGravel origin is not registered for Spotify." }, 400);
  if (spotifySessionKey() === null) {
    return jsonResponse({ connection: "unavailable", isPlaying: false, track: null, errorMessage: "Spotify web controls are not configured on this server.", accountConnected: false });
  }
  if (readSession(request) === null) {
    const disconnected: SpotifyStateResponse = {
      connection: "disconnected",
      isPlaying: false,
      track: null,
      errorMessage: null,
      accountConnected: false,
    };
    return jsonResponse(disconnected);
  }
  const result = await readPlayerState(request);
  if (!result.ok || result.value === undefined) return apiErrorResponse(result.error!, result.setCookie);
  return jsonResponse(result.value, 200, result.setCookie === undefined ? [] : [result.setCookie]);
}
