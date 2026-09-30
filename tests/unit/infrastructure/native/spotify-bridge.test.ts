import { describe, expect, it, vi } from "vitest";

import { nativeSpotifyPlayer } from "@/infrastructure/native/spotify-bridge";

function plugin() {
  let stateChanged: ((state: Record<string, unknown>) => void) | undefined;
  const listenerHandle = { remove: vi.fn() };
  const registered = {
    isAvailable: vi.fn(async () => ({ available: true })),
    getState: vi.fn(async () => ({ connection: "disconnected", isPlaying: false, track: null })),
    connect: vi.fn(async () => ({ connection: "connecting", isPlaying: false, track: null })),
    disconnect: vi.fn(async () => ({ connection: "disconnected", isPlaying: false, track: null })),
    togglePlayPause: vi.fn(async () => ({ connection: "connected", isPlaying: true, track: null })),
    skipToPrevious: vi.fn(async () => ({ connection: "connected", isPlaying: true, track: null })),
    skipToNext: vi.fn(async () => ({ connection: "connected", isPlaying: true, track: null })),
    openSpotify: vi.fn(async () => undefined),
    addListener: vi.fn(async (_event: "stateChanged", listener: (state: Record<string, unknown>) => void) => {
      stateChanged = listener;
      return listenerHandle;
    }),
  };
  return { registered, listenerHandle, emit: (state: Record<string, unknown>) => stateChanged?.(state) };
}

describe("nativeSpotifyPlayer", () => {
  it("is absent outside the native shell", () => {
    expect(nativeSpotifyPlayer({})).toBeUndefined();
  });

  it("is absent when the shell does not expose the complete plugin", () => {
    expect(nativeSpotifyPlayer({
      Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: { getState: vi.fn() } } },
    })).toBeUndefined();
  });

  it("maps native state events into the typed player snapshot", async () => {
    const native = plugin();
    const player = nativeSpotifyPlayer({
      Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: native.registered } },
    });
    if (player === undefined) throw new Error("expected native player");
    await Promise.resolve();
    expect(player.snapshot().connection).toBe("disconnected");

    const seen: string[] = [];
    player.subscribe((snapshot) => seen.push(snapshot.connection));
    native.emit({
      connection: "connected",
      isPlaying: true,
      track: { uri: "spotify:track:one", title: "One", artist: "Artist", artworkBase64: "YQ==" },
    });
    expect(player.snapshot()).toMatchObject({
      connection: "connected",
      isPlaying: true,
      track: { title: "One", artist: "Artist", artworkDataUrl: "data:image/jpeg;base64,YQ==" },
    });
    expect(seen).toContain("connected");
  });

  it("does not let a delayed initial state overwrite a newer native event", async () => {
    const native = plugin();
    type DeferredSnapshot = { connection: string; isPlaying: boolean; track: null };
    let resolveState: ((snapshot: DeferredSnapshot) => void) | undefined;
    native.registered.getState = vi.fn(() => new Promise<DeferredSnapshot>((resolve) => {
      resolveState = resolve;
    }));
    const player = nativeSpotifyPlayer({
      Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: native.registered } },
    });
    if (player === undefined) throw new Error("expected native player");

    native.emit({ connection: "connected", isPlaying: true, track: null });
    resolveState?.({ connection: "disconnected", isPlaying: false, track: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(player.snapshot()).toMatchObject({ connection: "connected", isPlaying: true });
  });

  it("contains native action failures so navigation callers do not see a rejection", async () => {
    const native = plugin();
    native.registered.skipToNext.mockRejectedValueOnce(new Error("Spotify unavailable"));
    const player = nativeSpotifyPlayer({
      Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: native.registered } },
    });
    if (player === undefined) throw new Error("expected native player");
    await expect(player.skipToNext()).resolves.toBeUndefined();
    expect(player.snapshot().connection).toBe("error");
    expect(player.snapshot().errorMessage).toContain("Spotify could not complete");
  });

  it("removes a late native listener and ignores late state after disposal", async () => {
    const native = plugin();
    type DeferredSnapshot = { connection: string; isPlaying: boolean; track: null };
    let resolveState: ((snapshot: DeferredSnapshot) => void) | undefined;
    let resolveListener: ((handle: typeof native.listenerHandle) => void) | undefined;
    let emit: ((state: Record<string, unknown>) => void) | undefined;
    native.registered.getState = vi.fn(() => new Promise<DeferredSnapshot>((resolve) => {
      resolveState = resolve;
    }));
    native.registered.addListener = vi.fn(async (_event, listener) => {
      emit = listener;
      return new Promise<typeof native.listenerHandle>((resolve) => {
        resolveListener = resolve;
      });
    });

    const player = nativeSpotifyPlayer({
      Capacitor: { isNativePlatform: () => true, Plugins: { OpenGravelSpotify: native.registered } },
    });
    if (player === undefined) throw new Error("expected native player");
    const seen: string[] = [];
    player.subscribe((snapshot) => seen.push(snapshot.connection));
    seen.length = 0;
    player.dispose();
    player.dispose();

    resolveListener?.(native.listenerHandle);
    resolveState?.({ connection: "connected", isPlaying: true, track: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    emit?.({ connection: "connected", isPlaying: true, track: null });

    expect(native.listenerHandle.remove).toHaveBeenCalledOnce();
    expect(seen).toEqual([]);
    expect(player.snapshot().connection).toBe("unavailable");
  });
});
