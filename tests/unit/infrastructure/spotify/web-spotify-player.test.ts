import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSpotifyPlayer } from "@/infrastructure/spotify/web-spotify-player";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web Spotify player", () => {
  it("loads state, sends controls, and maps a current track", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "disconnected", isPlaying: false, track: null, errorMessage: null, accountConnected: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "connected", isPlaying: true, track: { uri: "spotify:track:1", title: "Road", artist: "Rider", artworkDataUrl: null }, errorMessage: null, accountConnected: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const player = createWebSpotifyPlayer();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(player.snapshot().connection).toBe("disconnected");
    await player.skipToNext();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/spotify/command");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ command: "next" });
    expect(player.snapshot().track?.title).toBe("Road");
    player.dispose();
  });

  it("does not publish a late state response after disposal", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const player = createWebSpotifyPlayer();
    const listener = vi.fn();
    player.subscribe(listener);
    listener.mockClear();
    player.dispose();
    resolveFetch?.(new Response(JSON.stringify({ connection: "connected", isPlaying: true, track: null }), { status: 200 }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
  });

  it("maps reauthorization and Premium failures without exposing a token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "disconnected", isPlaying: false, track: null, errorMessage: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "premium_required", message: "safe" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const player = createWebSpotifyPlayer();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await player.togglePlayPause();
    expect(player.snapshot()).toMatchObject({ connection: "error", errorMessage: "Spotify playback is restricted. Check Premium and this app's tester access in Spotify setup." });
    expect(JSON.stringify(player.snapshot())).not.toContain("token");
    player.dispose();
  });

  it("ignores a poll that resolves after a playback command", async () => {
    let resolvePoll: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePoll = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "connected", isPlaying: true, track: { uri: "spotify:track:new", title: "New", artist: "Rider", artworkDataUrl: null }, errorMessage: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const player = createWebSpotifyPlayer();
    await player.skipToNext();
    expect(player.snapshot().track?.title).toBe("New");
    resolvePoll?.(new Response(JSON.stringify({ connection: "connected", isPlaying: false, track: { uri: "spotify:track:old", title: "Old", artist: "Rider", artworkDataUrl: null }, errorMessage: null }), { status: 200 }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(player.snapshot().track?.title).toBe("New");
    player.dispose();
  });

  it("retries a foreground rate-limited state after Retry-After", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "rate_limited", retryAfterSeconds: 1 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "connected", isPlaying: false, track: null, errorMessage: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const player = createWebSpotifyPlayer();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(player.snapshot().connection).toBe("connected");
    player.dispose();
    vi.useRealTimers();
  });

  it("preserves a long Retry-After across hidden and visible transitions", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "rate_limited", retryAfterSeconds: 120 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "connected", isPlaying: false, track: null, errorMessage: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const player = createWebSpotifyPlayer();
    const setVisibility = (visibilityState: "hidden" | "visible"): void => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: visibilityState });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    try {
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      setVisibility("hidden");
      setVisibility("visible");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(player.snapshot().connection).toBe("connected");
    } finally {
      setVisibility("visible");
      player.dispose();
      vi.useRealTimers();
    }
  });

  it("keeps transient transport errors recoverable while the page is visible", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: "connected", isPlaying: false, track: null, errorMessage: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const player = createWebSpotifyPlayer();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(player.snapshot().connection).toBe("connected");
    player.dispose();
    vi.useRealTimers();
  });
});
