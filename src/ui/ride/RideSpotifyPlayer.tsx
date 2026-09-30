"use client";

import { useEffect, useState } from "react";

import type {
  SpotifyPlayerPort,
  SpotifyPlayerSnapshot,
} from "@/application/ride-session/ports/spotify-player";

export interface RideSpotifyPlayerProps {
  readonly player: SpotifyPlayerPort;
}

export function RideSpotifyPlayer({ player }: RideSpotifyPlayerProps) {
  const [snapshot, setSnapshot] = useState<SpotifyPlayerSnapshot>(() => player.snapshot());

  useEffect(() => player.subscribe(setSnapshot), [player]);

  const connected = snapshot.connection === "connected";
  const unavailable = snapshot.connection === "unavailable";
  const track = snapshot.track;
  const run = (action: () => Promise<void>): void => { void action(); };

  return (
    <section className="og-ride__spotify" data-testid="ride-spotify-player" aria-label="Spotify">
      <div className="og-ride__spotify-header">
        <div>
          <h2 className="og-ride__spotify-title">Spotify</h2>
          <p className="og-ride__spotify-status" data-testid="ride-spotify-status" role="status">
            {unavailable
              ? "Spotify is unavailable in this build."
              : snapshot.connection === "connecting"
                ? "Connecting…"
                : connected
                  ? "Connected"
                  : snapshot.errorMessage ?? "Disconnected"}
          </p>
        </div>
        {track?.artworkDataUrl === null || track?.artworkDataUrl === undefined ? null : (
          // The native adapter supplies a bounded 256px JPEG data URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="og-ride__spotify-art" src={track.artworkDataUrl} alt="" />
        )}
      </div>
      <div className="og-ride__spotify-track" data-testid="ride-spotify-track">
        <strong>{track?.title ?? "Nothing playing"}</strong>
        {track === null ? null : <span>{track.artist}</span>}
      </div>
      <div className="og-ride__spotify-controls" role="group" aria-label="Spotify playback controls">
        <button type="button" className="og-ride__action" data-testid="spotify-previous" disabled={!connected} onClick={() => run(player.skipToPrevious)}>
          Previous
        </button>
        <button type="button" className="og-ride__action og-ride__action--primary" data-testid="spotify-play-pause" disabled={!connected} onClick={() => run(player.togglePlayPause)}>
          {snapshot.isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" className="og-ride__action" data-testid="spotify-next" disabled={!connected} onClick={() => run(player.skipToNext)}>
          Next
        </button>
      </div>
      <div className="og-ride__spotify-actions">
        {connected ? (
          <button type="button" className="og-ride__action" data-testid="spotify-disconnect" onClick={() => run(player.disconnect)}>
            Disconnect
          </button>
        ) : snapshot.connection === "connecting" ? (
          <button type="button" className="og-ride__action" data-testid="spotify-disconnect" onClick={() => run(player.disconnect)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="og-ride__action og-ride__action--primary" data-testid="spotify-connect" disabled={unavailable} onClick={() => run(player.connect)}>
            Connect Spotify
          </button>
        )}
        <button type="button" className="og-ride__action" data-testid="spotify-open" onClick={() => run(player.openSpotify)}>
          Open Spotify
        </button>
      </div>
    </section>
  );
}
