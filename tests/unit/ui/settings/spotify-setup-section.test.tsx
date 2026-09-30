import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpotifyPlayerPort } from "@/application/ride-session/ports/spotify-player";
import { SpotifySetupSection } from "@/ui/settings/SpotifySetupSection";
import { clearSpotifyClientId, readSpotifyClientId, saveSpotifyClientId } from "@/infrastructure/spotify/client-id-storage";

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Spotify setup", () => {
  it("uses the installed native player rather than starting a separate browser login on iPhone", () => {
    const nativePlayer: SpotifyPlayerPort = {
      snapshot: () => ({ connection: "disconnected", isPlaying: false, track: null, errorMessage: null }),
      subscribe: () => () => undefined,
      dispose: vi.fn(), connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined),
      togglePlayPause: vi.fn(async () => undefined), skipToPrevious: vi.fn(async () => undefined),
      skipToNext: vi.fn(async () => undefined), openSpotify: vi.fn(async () => undefined),
    };
    render(<SpotifySetupSection readClientId={readSpotifyClientId} saveClientId={saveSpotifyClientId} clearClientId={clearSpotifyClientId} nativePlayer={nativePlayer} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Spotify" }));
    expect(nativePlayer.connect).toHaveBeenCalledOnce();
  });

  it("stores only a valid public client ID and shows the current callback", async () => {
    render(<SpotifySetupSection readClientId={readSpotifyClientId} saveClientId={saveSpotifyClientId} clearClientId={clearSpotifyClientId} />);
    const input = await screen.findByTestId("spotify-client-id");
    await waitFor(() => expect(screen.getByText(`${window.location.origin}/api/spotify/callback`)).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save app ID" }));
    expect(screen.getByText("Enter the 32-character public Spotify client ID.")).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    fireEvent.change(input, { target: { value: "f".repeat(32) } });
    fireEvent.click(screen.getByRole("button", { name: "Save app ID" }));
    await waitFor(() => expect(window.localStorage.getItem("OGV_SPOTIFY_CLIENT_ID")).toBe("f".repeat(32)));
    expect(screen.getByText("Your public Spotify app ID is saved on this device.")).toBeInTheDocument();
  });
});
