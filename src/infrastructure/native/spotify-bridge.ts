import type {
  SpotifyPlayerPort,
  SpotifyPlayerSnapshot,
  SpotifyTrack,
} from "@/application/ride-session/ports/spotify-player";

interface SpotifyNativeTrack {
  readonly uri?: unknown;
  readonly title?: unknown;
  readonly artist?: unknown;
  readonly artworkBase64?: unknown;
}

interface SpotifyNativeSnapshot {
  readonly connection?: unknown;
  readonly isPlaying?: unknown;
  readonly track?: unknown;
  readonly errorMessage?: unknown;
}

interface SpotifyNativeListenerHandle {
  remove(): Promise<void> | void;
}

interface SpotifyNativePlugin {
  isAvailable(): Promise<{ readonly available?: boolean }>;
  getState(): Promise<SpotifyNativeSnapshot>;
  connect(): Promise<SpotifyNativeSnapshot>;
  disconnect(): Promise<SpotifyNativeSnapshot>;
  togglePlayPause(): Promise<SpotifyNativeSnapshot>;
  skipToPrevious(): Promise<SpotifyNativeSnapshot>;
  skipToNext(): Promise<SpotifyNativeSnapshot>;
  openSpotify(): Promise<void>;
  addListener(
    event: "stateChanged",
    listener: (snapshot: SpotifyNativeSnapshot) => void,
  ): Promise<SpotifyNativeListenerHandle> | SpotifyNativeListenerHandle;
}

interface CapacitorScope {
  readonly Capacitor?: {
    readonly isNativePlatform?: () => boolean;
    readonly Plugins?: { readonly OpenGravelSpotify?: Partial<SpotifyNativePlugin> };
  };
}

function parseTrack(value: unknown): SpotifyTrack | null {
  if (value === null || typeof value !== "object") return null;
  const track = value as SpotifyNativeTrack;
  if (typeof track.uri !== "string" || typeof track.title !== "string" || typeof track.artist !== "string") return null;
  return {
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    artworkDataUrl: typeof track.artworkBase64 === "string" ? `data:image/jpeg;base64,${track.artworkBase64}` : null,
  };
}

function parseSnapshot(value: SpotifyNativeSnapshot): SpotifyPlayerSnapshot {
  const connection = value.connection;
  return {
    connection:
      connection === "connected" || connection === "connecting" || connection === "error" || connection === "unavailable"
        ? connection
        : "disconnected",
    isPlaying: value.isPlaying === true,
    track: parseTrack(value.track),
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
  };
}

function nativeSpotifyPlugin(scope: unknown): SpotifyNativePlugin | undefined {
  const capacitor = (scope as CapacitorScope | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.OpenGravelSpotify;
  if (
    typeof plugin?.isAvailable !== "function" ||
    typeof plugin.getState !== "function" ||
    typeof plugin.connect !== "function" ||
    typeof plugin.disconnect !== "function" ||
    typeof plugin.togglePlayPause !== "function" ||
    typeof plugin.skipToPrevious !== "function" ||
    typeof plugin.skipToNext !== "function" ||
    typeof plugin.openSpotify !== "function" ||
    typeof plugin.addListener !== "function"
  ) return undefined;
  return plugin as SpotifyNativePlugin;
}

function createSpotifyPlayer(plugin: SpotifyNativePlugin): SpotifyPlayerPort {
  let disposed = false;
  let nativeListener: SpotifyNativeListenerHandle | undefined;
  let current: SpotifyPlayerSnapshot = {
    connection: "unavailable",
    isPlaying: false,
    track: null,
    errorMessage: null,
  };
  const listeners = new Set<(snapshot: SpotifyPlayerSnapshot) => void>();
  let stateSequence = 0;

  const publish = (next: SpotifyPlayerSnapshot): void => {
    if (disposed) return;
    current = next;
    listeners.forEach((listener) => listener(next));
  };

  const initialSequence = stateSequence;
  void plugin.getState().then((snapshot) => {
    if (stateSequence !== initialSequence) return;
    publish(parseSnapshot(snapshot));
  }).catch(() => {
    if (stateSequence !== initialSequence) return;
    publish({ ...current, connection: "error", errorMessage: "Spotify player is unavailable." });
  });
  void Promise.resolve(plugin.addListener("stateChanged", (snapshot) => {
    stateSequence += 1;
    publish(parseSnapshot(snapshot));
  }))
    .then((handle) => {
      if (disposed) {
        void Promise.resolve(handle.remove()).catch(() => undefined);
        return;
      }
      nativeListener = handle;
    })
    .catch(() => undefined);

  const run = async (action: () => Promise<SpotifyNativeSnapshot | void>): Promise<void> => {
    if (disposed) return;
    try {
      const result = await action();
      if (result !== undefined) {
        stateSequence += 1;
        publish(parseSnapshot(result));
      }
    } catch {
      stateSequence += 1;
      publish({ ...current, connection: "error", errorMessage: "Spotify could not complete that action." });
    }
  };

  return {
    snapshot: () => current,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      const handle = nativeListener;
      nativeListener = undefined;
      if (handle !== undefined) void Promise.resolve(handle.remove()).catch(() => undefined);
    },
    connect: () => run(() => plugin.connect()),
    disconnect: () => run(() => plugin.disconnect()),
    togglePlayPause: () => run(() => plugin.togglePlayPause()),
    skipToPrevious: () => run(() => plugin.skipToPrevious()),
    skipToNext: () => run(() => plugin.skipToNext()),
    openSpotify: () => run(() => plugin.openSpotify()),
  };
}

/** Returns the registered native player only in the installed iOS shell. */
export function nativeSpotifyPlayer(scope: unknown = globalThis): SpotifyPlayerPort | undefined {
  const plugin = nativeSpotifyPlugin(scope);
  return plugin === undefined ? undefined : createSpotifyPlayer(plugin);
}
