import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpotifyPlayerPort, SpotifyPlayerSnapshot } from "@/application/ride-session/ports/spotify-player";
import { RideMusicEntry } from "@/ui/ride/RideMusicEntry";
import { readRideReturn } from "@/ui/ride/ride-return";

function player(snapshot: SpotifyPlayerSnapshot): SpotifyPlayerPort {
  return {
    snapshot: () => snapshot,
    subscribe: (listener) => { listener(snapshot); return () => undefined; },
    dispose: vi.fn(),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    togglePlayPause: vi.fn(async () => undefined),
    skipToPrevious: vi.fn(async () => undefined),
    skipToNext: vi.fn(async () => undefined),
    openSpotify: vi.fn(async () => undefined),
  };
}

const idle: SpotifyPlayerSnapshot = { connection: "disconnected", isPlaying: false, track: null, errorMessage: null };

beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, "", "/ride"); });
afterEach(() => cleanup());

describe("RideMusicEntry", () => {
  it("shows one title - artist line with play and next when connected", () => {
    const model = player({ connection: "connected", isPlaying: true, track: { uri: "u", title: "Open Road", artist: "Fixture Artist", artworkDataUrl: null }, errorMessage: null });
    render(<RideMusicEntry player={model} />);
    expect(screen.getByTestId("ride-music-line")).toHaveTextContent("Open Road · Fixture Artist");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Next song" }));
    expect(model.togglePlayPause).toHaveBeenCalledOnce();
    expect(model.skipToNext).toHaveBeenCalledOnce();
  });

  it("splits by placement: now-playing on the map, Connect Spotify in the sheet, never both", () => {
    const connected = player({ connection: "connected", isPlaying: true, track: { uri: "u", title: "Open Road", artist: "Fixture Artist", artworkDataUrl: null }, errorMessage: null });
    const { unmount } = render(<><RideMusicEntry player={connected} placement="map" /><RideMusicEntry player={connected} placement="sheet" /></>);
    expect(screen.getAllByTestId("ride-music")).toHaveLength(1);
    expect(screen.getByTestId("ride-music")).toHaveAttribute("data-placement", "map");
    unmount();
    render(<><RideMusicEntry player={player(idle)} placement="map" /><RideMusicEntry player={player(idle)} placement="sheet" /></>);
    expect(screen.getAllByTestId("ride-music")).toHaveLength(1);
    expect(screen.getByTestId("ride-music-connect")).toBeInTheDocument();
  });

  it("offers Play on this phone when connected with nothing playing", () => {
    const model = player({ connection: "connected", isPlaying: false, track: null, errorMessage: "No active Spotify device." });
    render(<RideMusicEntry player={model} />);
    expect(screen.getByTestId("ride-music-line")).toHaveTextContent("Play on this phone");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(model.togglePlayPause).toHaveBeenCalledOnce();
  });

  it("shows a single Connect Spotify entry that remembers the ride and starts sign-in", () => {
    window.history.replaceState(null, "", "/ride?x=1#map");
    const model = player(idle);
    render(<RideMusicEntry player={model} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Spotify" }));
    expect(model.connect).toHaveBeenCalledOnce();
    expect(readRideReturn()).toBe("/ride?x=1#map");
  });

  it("says plainly that Premium is needed", () => {
    render(<RideMusicEntry player={player({ connection: "error", isPlaying: false, track: null, errorMessage: "Spotify Premium is needed for playback." })} />);
    expect(screen.getByTestId("ride-music-message")).toHaveTextContent("Spotify Premium is needed for playback.");
    expect(screen.queryByRole("button", { name: "Connect Spotify" })).toBeNull();
  });

  it("reports a failed return from Spotify and cleans the URL", async () => {
    window.history.replaceState(null, "", "/ride?spotify=error");
    render(<RideMusicEntry player={player(idle)} />);
    expect(await screen.findByTestId("ride-music-message")).toHaveTextContent("Spotify could not connect");
    expect(window.location.search).toBe("");
  });
});
