import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpotifyPlayerPort, SpotifyPlayerSnapshot } from "@/application/ride-session/ports/spotify-player";
import { RideMusicEntry } from "@/ui/ride/RideMusicEntry";

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
const playing: SpotifyPlayerSnapshot = {
  connection: "connected",
  isPlaying: true,
  track: { uri: "u", title: "Open Road", artist: "Fixture Artist", artworkDataUrl: null },
  errorMessage: null,
};

beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, "", "/ride"); });
afterEach(() => cleanup());

describe("RideMusicEntry", () => {
  it("shows one title - artist line with play and next when connected", () => {
    const model = player(playing);
    render(<RideMusicEntry player={model} />);
    expect(screen.getByTestId("ride-music-line")).toHaveTextContent("Open Road · Fixture Artist");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Next song" }));
    expect(model.togglePlayPause).toHaveBeenCalledOnce();
    expect(model.skipToNext).toHaveBeenCalledOnce();
  });

  it("draws nothing at all when Spotify is not connected", () => {
    render(<RideMusicEntry player={player(idle)} />);
    expect(screen.queryByTestId("ride-music")).toBeNull();
    expect(screen.queryByRole("button", { name: /spotify/i })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never shows a set-up message on the ride, even one about this origin", () => {
    // What a deployment without a registered Spotify origin reported: a
    // developer sentence with a Setup link, at the top of the ride sheet.
    render(
      <RideMusicEntry
        player={player({
          connection: "error",
          isPlaying: false,
          track: null,
          errorMessage: "This OpenGravel origin is not registered for Spotify.",
        })}
      />,
    );
    expect(screen.queryByTestId("ride-music")).toBeNull();
    expect(screen.queryByText(/not registered for Spotify/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Setup" })).toBeNull();
  });

  it("says nothing while connecting, or when the build has no Spotify", () => {
    const connecting = render(
      <RideMusicEntry player={player({ connection: "connecting", isPlaying: false, track: null, errorMessage: null })} />,
    );
    expect(screen.queryByTestId("ride-music")).toBeNull();
    connecting.unmount();
    render(
      <RideMusicEntry
        player={player({
          connection: "unavailable",
          isPlaying: false,
          track: null,
          errorMessage: "Spotify is unavailable in this build.",
        })}
      />,
    );
    expect(screen.queryByTestId("ride-music")).toBeNull();
  });

  it("offers Play on this phone when connected with nothing playing", () => {
    const model = player({ connection: "connected", isPlaying: false, track: null, errorMessage: "No active Spotify device." });
    render(<RideMusicEntry player={model} />);
    expect(screen.getByTestId("ride-music-line")).toHaveTextContent("Play on this phone");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(model.togglePlayPause).toHaveBeenCalledOnce();
  });

  it("tidies a one-shot return from Spotify out of the URL and reports nothing", () => {
    window.history.replaceState(null, "", "/ride?spotify=error");
    render(<RideMusicEntry player={player(idle)} />);
    expect(window.location.search).toBe("");
    expect(screen.queryByTestId("ride-music")).toBeNull();
    expect(screen.queryByText(/Spotify could not connect/)).toBeNull();
  });
});
