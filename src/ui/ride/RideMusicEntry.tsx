"use client";

/**
 * Music on the ride sheet, as one 64 px row (small-screen-v2: 56 px targets,
 * plain words, no badges).
 *
 *  - Connected: art, "title · artist" on one line, play/pause, next.
 *  - Not connected: one line, "Connect Spotify". It remembers this ride, goes
 *    to Spotify, and comes back to the same ride screen.
 *  - Premium missing / other trouble: one plain sentence.
 *
 * The phone's native App Remote player uses the same port, so it renders the
 * same row; nothing here knows which adapter it has.
 */

import { useEffect, useState } from "react";

import "./ride-music.css";
import type {
  SpotifyPlayerPort,
  SpotifyPlayerSnapshot,
} from "@/application/ride-session/ports/spotify-player";
import {
  clearRideReturn,
  rememberRideReturn,
  spotifyOutcomeOf,
  withoutSpotifyOutcome,
  type SpotifyOutcome,
} from "./ride-return";

export interface RideMusicEntryProps {
  readonly player: SpotifyPlayerPort;
  /**
   * Where this copy lives. `map`: the connected now-playing row, on the map
   * surface above the strip (nothing at all when not connected). `sheet`: the
   * "Connect Spotify" row and its notes (nothing when connected, because the
   * map already shows it). Absent: everything, in one place.
   */
  readonly placement?: "map" | "sheet";
}

function Icon({ name }: { readonly name: "note" | "play" | "pause" | "next" }) {
  const paths = {
    note: "M9 17V5l10-2v12M9 17a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z",
    play: "M8 5v14l11-7z",
    pause: "M7 5h4v14H7zM13 5h4v14h-4z",
    next: "M16 5h2v14h-2zM4 5v14l11-7z",
  } as const;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={name === "note" ? "none" : "currentColor"} stroke={name === "note" ? "currentColor" : "none"} strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function outcomeText(outcome: SpotifyOutcome | null): string | null {
  if (outcome === "cancelled") return "Spotify was not connected.";
  if (outcome === "error") return "Spotify could not connect. Check Spotify setup in Settings.";
  return null;
}

export function RideMusicEntry({ player, placement }: RideMusicEntryProps) {
  const [snapshot, setSnapshot] = useState<SpotifyPlayerSnapshot>(() => player.snapshot());
  const [outcome, setOutcome] = useState<SpotifyOutcome | null>(null);

  useEffect(() => player.subscribe(setSnapshot), [player]);

  // Back from Spotify's sign-in page: read the one-shot result, tidy the URL.
  useEffect(() => {
    // The map copy never reads the one-shot result: the sheet's copy owns the note.
    if (placement === "map") return;
    const found = spotifyOutcomeOf(window.location.search);
    if (found === null) return;
    window.history.replaceState(
      window.history.state,
      "",
      withoutSpotifyOutcome(window.location.pathname, window.location.search, window.location.hash),
    );
    clearRideReturn();
    queueMicrotask(() => setOutcome(found));
  }, [placement]);

  const run = (action: () => Promise<void>): void => { void action(); };
  const connect = (): void => {
    rememberRideReturn(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    run(() => player.connect());
  };

  const { connection, track, isPlaying, errorMessage } = snapshot;
  if (placement === "map" && connection !== "connected") return null;
  if (placement === "sheet" && connection === "connected") return null;

  if (connection === "connected") {
    const line = track === null
      ? (errorMessage === null ? "Spotify" : "Play on this phone")
      : `${track.title} · ${track.artist}`;
    return (
      <section className="og-ride-music" data-testid="ride-music" data-state="connected" data-placement={placement} aria-label="Music">
        {track?.artworkDataUrl === null || track?.artworkDataUrl === undefined ? (
          <span className="og-ride-music__art" aria-hidden="true"><Icon name="note" /></span>
        ) : (
          // Bounded 256px JPEG data URL supplied by the native adapter.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="og-ride-music__art" src={track.artworkDataUrl} alt="" />
        )}
        <p className="og-ride-music__line" data-testid="ride-music-line">{line}</p>
        <button type="button" className="og-ride-music__button" data-testid="ride-music-play" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => run(() => player.togglePlayPause())}>
          <Icon name={isPlaying ? "pause" : "play"} />
        </button>
        <button type="button" className="og-ride-music__button" data-testid="ride-music-next" aria-label="Next song" onClick={() => run(() => player.skipToNext())}>
          <Icon name="next" />
        </button>
      </section>
    );
  }

  if (connection === "connecting") {
    return (
      <section className="og-ride-music" data-testid="ride-music" data-state="connecting" aria-label="Music">
        <p className="og-ride-music__line" role="status">Connecting to Spotify…</p>
        <button type="button" className="og-ride-music__text-button" data-testid="ride-music-cancel" onClick={() => run(() => player.disconnect())}>
          Cancel
        </button>
      </section>
    );
  }

  if (connection === "error" && errorMessage !== null) {
    return (
      <section className="og-ride-music" data-testid="ride-music" data-state="error" aria-label="Music">
        <p className="og-ride-music__line og-ride-music__line--wrap" role="status" data-testid="ride-music-message">{errorMessage}</p>
        <a className="og-ride-music__text-button" href="/settings#spotify">Setup</a>
      </section>
    );
  }

  const unavailable = connection === "unavailable";
  const note = outcomeText(outcome) ?? (unavailable ? errorMessage : null);
  return (
    <section className="og-ride-music og-ride-music--connect" data-testid="ride-music" data-state="disconnected" aria-label="Music">
      <button type="button" className="og-ride-music__connect" data-testid="ride-music-connect" disabled={unavailable} onClick={connect}>
        <Icon name="note" />
        <span>Connect Spotify</span>
      </button>
      {note === null ? null : <p className="og-ride-music__note" role="status" data-testid="ride-music-message">{note}</p>}
    </section>
  );
}
