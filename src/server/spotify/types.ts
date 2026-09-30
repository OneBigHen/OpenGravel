import type { SpotifyPlayerSnapshot } from "@/application/ride-session/ports/spotify-player";

export interface SpotifyOAuthState {
  readonly state: string;
  readonly codeVerifier: string;
  readonly clientId: string;
  readonly origin: string;
  readonly returnTo: string;
  readonly expiresAt: number;
}

export interface SpotifySession {
  readonly clientId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope?: string;
}

export interface SpotifyApiError {
  readonly status: number;
  readonly code: "reauthorize" | "premium_required" | "no_device" | "rate_limited" | "spotify_unavailable";
  readonly retryAfterSeconds?: number;
}

export interface SpotifyStateResponse extends SpotifyPlayerSnapshot {
  readonly accountConnected: boolean;
  readonly errorCode?: SpotifyApiError["code"];
  readonly retryAfterSeconds?: number;
}

