"use client";

/**
 * Music on the ride screen: **nothing until Spotify is connected**, and then one
 * 64 px now-playing row (small-screen-v2: 56 px targets, plain words, no badges)
 * on the map just above the bottom strip.
 *
 * The ride is not where a rider sets Spotify up. Before this, a deployment
 * without a registered Spotify origin put a developer message — "This OpenGravel
 * origin is not registered for Spotify" with a "Setup" link — at the top of the
 * ride sheet, above "Add a stop". Setting up, connecting, a missing Premium
 * account and every other outcome belong in Settings
 * (`/settings#settings-music-title`, the Music group), which is one screen away
 * and can explain itself in full. The ride only shows music that is already
 * working.
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
import { clearRideReturn, spotifyOutcomeOf, withoutSpotifyOutcome } from "./ride-return";

export interface RideMusicEntryProps {
  readonly player: SpotifyPlayerPort;
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

export function RideMusicEntry({ player }: RideMusicEntryProps) {
  const [snapshot, setSnapshot] = useState<SpotifyPlayerSnapshot>(() => player.snapshot());

  useEffect(() => player.subscribe(setSnapshot), [player]);

  /*
    Back from Spotify's sign-in page (a rider who connected in Settings and came
    back): the one-shot result is read only to tidy it out of the URL. What
    happened is not reported here — Settings owns the answer, and a failed
    connect leaves this row absent rather than raising a notice over the road.
  */
  useEffect(() => {
    const found = spotifyOutcomeOf(window.location.search);
    if (found === null) return;
    window.history.replaceState(
      window.history.state,
      "",
      withoutSpotifyOutcome(window.location.pathname, window.location.search, window.location.hash),
    );
    clearRideReturn();
  }, []);

  const { connection, track, isPlaying, errorMessage } = snapshot;
  // Not connected, connecting, unavailable or broken: no row at all. Unknown is
  // never dressed up as a control, and set-up is not a riding-screen task.
  if (connection !== "connected") return null;

  const run = (action: () => Promise<void>): void => { void action(); };
  const line = track === null
    ? (errorMessage === null ? "Spotify" : "Play on this phone")
    : `${track.title} · ${track.artist}`;

  return (
    <section className="og-ride-music" data-testid="ride-music" data-state="connected" aria-label="Music">
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
