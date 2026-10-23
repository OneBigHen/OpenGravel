"use client";

/**
 * Music on the ride screen is one strip, like the now-playing bar in Google
 * Maps: artwork, what is playing, and previous / play-pause / next as big
 * glove-sized icons. Setup (connect, open Spotify, the settings link) shows
 * only while Spotify is not connected; a status line shows only when there is
 * something to say.
 */

import { useEffect, useState } from "react";

import type {
  SpotifyPlayerPort,
  SpotifyPlayerSnapshot,
} from "@/application/ride-session/ports/spotify-player";

export interface RideSpotifyPlayerProps {
  readonly player: SpotifyPlayerPort;
}

function statusText(snapshot: SpotifyPlayerSnapshot): string {
  switch (snapshot.connection) {
    case "unavailable":
      return snapshot.errorMessage ?? "Spotify is unavailable in this build.";
    case "connecting":
      return "Connecting…";
    case "connected":
      return snapshot.errorMessage ?? "Connected";
    default:
      return snapshot.errorMessage ?? "Disconnected";
  }
}

function Icon({ name }: { readonly name: "previous" | "play" | "pause" | "next" }) {
  const paths = {
    previous: "M6 5h2v14H6zM20 5v14L9 12z",
    play: "M8 5v14l11-7z",
    pause: "M7 5h4v14H7zM13 5h4v14h-4z",
    next: "M16 5h2v14h-2zM4 5v14l11-7z",
  } as const;
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function RideSpotifyPlayer({ player }: RideSpotifyPlayerProps) {
  const [snapshot, setSnapshot] = useState<SpotifyPlayerSnapshot>(() => player.snapshot());

  useEffect(() => player.subscribe(setSnapshot), [player]);

  const connected = snapshot.connection === "connected";
  const unavailable = snapshot.connection === "unavailable";
  const connecting = snapshot.connection === "connecting";
  const track = snapshot.track;
  const status = statusText(snapshot);
  // Connected and quiet: the strip itself says what is playing.
  const showStatus = !connected || snapshot.errorMessage !== null;
  const run = (action: () => Promise<void>): void => { void action(); };

  return (
    <section className="og-ride__spotify" data-testid="ride-spotify-player" aria-label="Spotify">
      <div className="og-ride__spotify-strip">
        {track?.artworkDataUrl === null || track?.artworkDataUrl === undefined ? (
          <span className="og-ride__spotify-art og-ride__spotify-art--empty" aria-hidden="true">♪</span>
        ) : (
          // The native adapter supplies a bounded 256px JPEG data URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="og-ride__spotify-art" src={track.artworkDataUrl} alt="" />
        )}
        <div className="og-ride__spotify-track" data-testid="ride-spotify-track">
          <strong>{track?.title ?? "Spotify"}</strong>
          {track === null ? null : <span>{track.artist}</span>}
          <p
            className={showStatus ? "og-ride__spotify-status" : "og-visually-hidden"}
            data-testid="ride-spotify-status"
            role="status"
          >
            {status}
          </p>
        </div>
        <div className="og-ride__spotify-controls" role="group" aria-label="Spotify playback controls">
          <button type="button" className="og-ride__spotify-button" data-testid="spotify-previous" aria-label="Previous" disabled={!connected} onClick={() => run(() => player.skipToPrevious())}>
            <Icon name="previous" />
          </button>
          <button type="button" className="og-ride__spotify-button og-ride__spotify-button--primary" data-testid="spotify-play-pause" disabled={!connected} onClick={() => run(() => player.togglePlayPause())}>
            <Icon name={snapshot.isPlaying ? "pause" : "play"} />
            <span className="og-visually-hidden">{snapshot.isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button type="button" className="og-ride__spotify-button" data-testid="spotify-next" aria-label="Next" disabled={!connected} onClick={() => run(() => player.skipToNext())}>
            <Icon name="next" />
          </button>
        </div>
      </div>
      <div className="og-ride__spotify-actions">
        {connected ? (
          <button type="button" className="og-ride__spotify-link" data-testid="spotify-disconnect" onClick={() => run(() => player.disconnect())}>
            Disconnect
          </button>
        ) : connecting ? (
          <button type="button" className="og-ride__spotify-link" data-testid="spotify-disconnect" onClick={() => run(() => player.disconnect())}>
            Cancel
          </button>
        ) : (
          <>
            <button type="button" className="og-ride__action og-ride__action--primary" data-testid="spotify-connect" disabled={unavailable} onClick={() => run(() => player.connect())}>
              Connect Spotify
            </button>
            <button type="button" className="og-ride__spotify-link" data-testid="spotify-open" onClick={() => run(() => player.openSpotify())}>
              Open Spotify
            </button>
            <a href="/settings#spotify" className="og-ride__spotify-link">Spotify setup</a>
          </>
        )}
      </div>
    </section>
  );
}
