/** Optional ride-side music controls. Spotify never owns navigation state. */
export type SpotifyConnection = "unavailable" | "disconnected" | "connecting" | "connected" | "error";

export interface SpotifyTrack {
  readonly uri: string;
  readonly title: string;
  readonly artist: string;
  /** A data URL supplied by the native App Remote image adapter. */
  readonly artworkDataUrl: string | null;
}

export interface SpotifyPlayerSnapshot {
  readonly connection: SpotifyConnection;
  readonly isPlaying: boolean;
  readonly track: SpotifyTrack | null;
  readonly errorMessage: string | null;
}

export interface SpotifyPlayerPort {
  snapshot(): SpotifyPlayerSnapshot;
  subscribe(listener: (snapshot: SpotifyPlayerSnapshot) => void): () => void;
  /** Remove bridge listeners without disconnecting the rider's playback session. */
  dispose(): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  togglePlayPause(): Promise<void>;
  skipToPrevious(): Promise<void>;
  skipToNext(): Promise<void>;
  openSpotify(): Promise<void>;
}
