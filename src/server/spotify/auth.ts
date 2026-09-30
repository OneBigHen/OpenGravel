import { createHash, randomBytes } from "node:crypto";
import {
  SPOTIFY_SCOPES,
  spotifyClientId,
  spotifyCookieSecure,
  spotifyOAuthCookieName,
  spotifyOriginForRequest,
  spotifyRedirectUri,
  spotifySessionKey,
  spotifySessionCookieName,
  safeReturnTo,
} from "./config";
import { sealJson, openJson } from "./crypto";
import { expiredCookie, readCookie, serializeCookie } from "./cookies";
import type { SpotifyOAuthState, SpotifySession } from "./types";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const STATE_MAX_AGE = 600;

export interface LoginResult {
  readonly redirect: string;
  readonly cookie: string;
}

export class SpotifyAuthError extends Error {
  readonly publicCode: "configuration" | "origin" | "state" | "spotify";
  constructor(publicCode: SpotifyAuthError["publicCode"], message: string) {
    super(message);
    this.name = "SpotifyAuthError";
    this.publicCode = publicCode;
  }
}

export function createLogin(request: Request): LoginResult {
  const origin = spotifyOriginForRequest(request);
  if (origin === null) throw new SpotifyAuthError("origin", "This OpenGravel origin is not registered for Spotify.");
  const url = new URL(request.url);
  const clientId = spotifyClientId(url.searchParams.get("client_id"));
  if (clientId === null) throw new SpotifyAuthError("configuration", "Spotify client setup is unavailable.");
  const key = spotifySessionKey();
  if (key === null || sealJson({}, key) === null) throw new SpotifyAuthError("configuration", "Spotify server session setup is unavailable.");
  const state: SpotifyOAuthState = {
    state: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    clientId,
    origin,
    returnTo: safeReturnTo(url.searchParams.get("return_to")),
    expiresAt: Date.now() + STATE_MAX_AGE * 1000,
  };
  const challenge = createCodeChallenge(state.codeVerifier);
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  authUrl.searchParams.set("redirect_uri", spotifyRedirectUri(origin));
  authUrl.searchParams.set("state", state.state);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);
  const sealed = sealJson(state, key);
  if (sealed === null) throw new SpotifyAuthError("configuration", "Spotify server session setup is unavailable.");
  return {
    redirect: authUrl.toString(),
    cookie: serializeCookie(spotifyOAuthCookieName(spotifyCookieSecure(origin)), sealed, {
      maxAge: STATE_MAX_AGE,
      secure: spotifyCookieSecure(origin),
    }),
  };
}

export function readOAuthState(request: Request): SpotifyOAuthState | null {
  const origin = spotifyOriginForRequest(request);
  if (origin === null) return null;
  const state = openJson<SpotifyOAuthState>(readCookie(request, spotifyOAuthCookieName(spotifyCookieSecure(origin))), spotifySessionKey());
  if (state === null || state.expiresAt <= Date.now() || !state.state || !state.codeVerifier || !state.clientId) return null;
  return state;
}

export async function exchangeCode(state: SpotifyOAuthState, code: string): Promise<SpotifySession> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: state.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(state.origin),
      code_verifier: state.codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new SpotifyAuthError("spotify", "Spotify did not accept the sign-in.");
  const body = await response.json() as Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  }>;
  if (typeof body.access_token !== "string" || body.access_token.length === 0 || typeof body.refresh_token !== "string" || body.refresh_token.length === 0 || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86_400) {
    throw new SpotifyAuthError("spotify", "Spotify returned an incomplete sign-in response.");
  }
  return {
    clientId: state.clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
    ...(body.scope === undefined ? {} : { scope: body.scope }),
  };
}

export async function refreshSession(session: SpotifySession): Promise<SpotifySession> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: session.clientId,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new SpotifyAuthError("spotify", "Spotify sign-in has expired.");
  const body = await response.json() as Partial<{ access_token: string; refresh_token: string; expires_in: number; scope: string }>;
  if (typeof body.access_token !== "string" || body.access_token.length === 0 || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86_400) {
    throw new SpotifyAuthError("spotify", "Spotify returned an incomplete refresh response.");
  }
  return {
    clientId: session.clientId,
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : session.refreshToken,
    expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
    ...(body.scope === undefined ? {} : { scope: body.scope }),
  };
}

export function clearOAuthCookie(origin: string): string {
  return expiredCookie(spotifyOAuthCookieName(spotifyCookieSecure(origin)), spotifyCookieSecure(origin));
}

export function storeSession(session: SpotifySession, origin: string): string {
  const sealed = sealJson(session, spotifySessionKey());
  if (sealed === null) throw new SpotifyAuthError("configuration", "Spotify server session setup is unavailable.");
  return serializeCookie(spotifySessionCookieName(spotifyCookieSecure(origin)), sealed, {
    maxAge: 60 * 60 * 24 * 30,
    secure: spotifyCookieSecure(origin),
  });
}

function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest().toString("base64url");
}
