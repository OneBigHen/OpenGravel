import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SpotifyPlayerPort,
  SpotifyPlayerSnapshot,
} from "@/application/ride-session/ports/spotify-player";
import { RideSpotifyPlayer } from "@/ui/ride/RideSpotifyPlayer";

afterEach(() => cleanup());

function player(snapshot: SpotifyPlayerSnapshot): SpotifyPlayerPort {
  const listeners = new Set<(next: SpotifyPlayerSnapshot) => void>();
  let current = snapshot;
  const update = (next: SpotifyPlayerSnapshot): void => {
    current = next;
    listeners.forEach((listener) => listener(next));
  };
  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
    connect: vi.fn(async () => update({ ...current, connection: "connected" })),
    disconnect: vi.fn(async () => update({ ...current, connection: "disconnected" })),
    togglePlayPause: vi.fn(async () => update({ ...current, isPlaying: !current.isPlaying })),
    skipToPrevious: vi.fn(async () => undefined),
    skipToNext: vi.fn(async () => undefined),
    openSpotify: vi.fn(async () => undefined),
  };
}

describe("RideSpotifyPlayer", () => {
  it("explains server setup when browser Spotify is unavailable", () => {
    const model = player({ connection: "unavailable", isPlaying: false, track: null, errorMessage: "Spotify server setup is unavailable." });
    render(<RideSpotifyPlayer player={model} />);
    expect(screen.getByTestId("ride-spotify-status")).toHaveTextContent("Spotify server setup is unavailable.");
    expect(screen.getByTestId("spotify-connect")).toBeDisabled();
  });

  it("shows how to recover when authorized Spotify has no active playback device", () => {
    const model = player({ connection: "connected", isPlaying: false, track: null, errorMessage: "Open Spotify on a device and start playback first." });
    render(<RideSpotifyPlayer player={model} />);
    expect(screen.getByTestId("ride-spotify-status")).toHaveTextContent("Open Spotify on a device and start playback first.");
    expect(screen.getByTestId("spotify-open")).toBeEnabled();
    expect(screen.getByRole("link", { name: "Spotify setup" })).toHaveAttribute("href", "/settings#spotify");
  });

  it("renders metadata and keeps playback controls disabled while disconnected", () => {
    const model = player({ connection: "disconnected", isPlaying: false, track: null, errorMessage: null });
    render(<RideSpotifyPlayer player={model} />);
    expect(screen.getByTestId("ride-spotify-status")).toHaveTextContent("Disconnected");
    expect(screen.getByTestId("spotify-connect")).toBeEnabled();
    expect(screen.getByTestId("spotify-play-pause")).toBeDisabled();
    expect(screen.getByTestId("spotify-previous")).toBeDisabled();
  });

  it("connects and exposes the current track controls", async () => {
    const model = player({
      connection: "connected",
      isPlaying: true,
      track: { uri: "spotify:track:test", title: "Track", artist: "Artist", artworkDataUrl: "data:image/jpeg;base64,YQ==" },
      errorMessage: null,
    });
    render(<RideSpotifyPlayer player={model} />);
    expect(screen.getByTestId("ride-spotify-track")).toHaveTextContent("Track");
    expect(screen.getByTestId("ride-spotify-track")).toHaveTextContent("Artist");
    expect(screen.getByTestId("spotify-play-pause")).toHaveTextContent("Pause");
    fireEvent.click(screen.getByTestId("spotify-play-pause"));
    expect(model.togglePlayPause).toHaveBeenCalledOnce();
    expect(vi.mocked(model.togglePlayPause).mock.contexts[0]).toBe(model);
    fireEvent.click(screen.getByTestId("spotify-next"));
    expect(model.skipToNext).toHaveBeenCalledOnce();
    expect(vi.mocked(model.skipToNext).mock.contexts[0]).toBe(model);
    fireEvent.click(screen.getByTestId("spotify-disconnect"));
    expect(model.disconnect).toHaveBeenCalledOnce();
    expect(vi.mocked(model.disconnect).mock.contexts[0]).toBe(model);
  });

  it("keeps open Spotify available when playback is disconnected", () => {
    const model = player({ connection: "error", isPlaying: false, track: null, errorMessage: "No Spotify app" });
    render(<RideSpotifyPlayer player={model} />);
    expect(screen.getByTestId("ride-spotify-status")).toHaveTextContent("No Spotify app");
    fireEvent.click(screen.getByTestId("spotify-open"));
    expect(model.openSpotify).toHaveBeenCalledOnce();
    expect(vi.mocked(model.openSpotify).mock.contexts[0]).toBe(model);
  });

  it("lets the rider cancel a pending connection so it can be retried", () => {
    const model = player({ connection: "connecting", isPlaying: false, track: null, errorMessage: null });
    render(<RideSpotifyPlayer player={model} />);
    expect(screen.getByTestId("spotify-disconnect")).toBeEnabled();
    expect(screen.queryByTestId("spotify-connect")).toBeNull();
    fireEvent.click(screen.getByTestId("spotify-disconnect"));
    expect(model.disconnect).toHaveBeenCalledOnce();
    expect(vi.mocked(model.disconnect).mock.contexts[0]).toBe(model);
  });
});
