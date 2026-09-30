import type {
  SpotifyPlayerPort,
  SpotifyPlayerSnapshot,
  SpotifyTrack,
} from "@/application/ride-session/ports/spotify-player";
import { readSpotifyClientId } from "@/infrastructure/spotify/client-id-storage";

interface WebStateResponse {
  readonly connection?: SpotifyPlayerSnapshot["connection"];
  readonly isPlaying?: boolean;
  readonly track?: SpotifyTrack | null;
  readonly errorMessage?: string | null;
  readonly accountConnected?: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly retryAfterSeconds?: number;
}

const DISCONNECTED: SpotifyPlayerSnapshot = {
  connection: "disconnected",
  isPlaying: false,
  track: null,
  errorMessage: null,
};

export function createWebSpotifyPlayer(): SpotifyPlayerPort {
  return new WebSpotifyPlayer();
}

class WebSpotifyPlayer implements SpotifyPlayerPort {
  private current: SpotifyPlayerSnapshot = typeof window === "undefined"
    ? { ...DISCONNECTED, connection: "unavailable" }
    : DISCONNECTED;
  private readonly listeners = new Set<(snapshot: SpotifyPlayerSnapshot) => void>();
  private readonly requests = new Set<AbortController>();
  private disposed = false;
  private disconnecting = false;
  private sequence = 0;
  private commandTail: Promise<void> = Promise.resolve();
  private readonly visibilityListener = (): void => {
    if (document.visibilityState === "visible") void this.loadState();
    else this.stopRefresh();
  };
  private refreshTimer: number | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityListener);
      void this.loadState();
    }
  }

  snapshot(): SpotifyPlayerSnapshot { return this.current; }

  subscribe(listener: (snapshot: SpotifyPlayerSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.sequence += 1;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.visibilityListener);
    this.listeners.clear();
  }

  async connect(): Promise<void> {
    if (this.disposed || typeof window === "undefined") return;
    this.publish({ ...this.current, connection: "connecting", errorMessage: null });
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const url = new URL("/api/spotify/login", window.location.origin);
    url.searchParams.set("return_to", returnTo);
    const clientId = readSpotifyClientId();
    if (clientId !== null) url.searchParams.set("client_id", clientId);
    window.location.assign(url.toString());
  }

  async disconnect(): Promise<void> {
    if (this.disposed) return;
    this.disconnecting = true;
    this.sequence += 1;
    for (const request of this.requests) request.abort();
    try {
      const result = await this.request("/api/spotify/logout", { method: "POST" });
      if (result === null || result.code !== undefined) throw new Error("logout failed");
      this.publish(DISCONNECTED);
    } catch {
      this.publish({ ...this.current, connection: "error", errorMessage: "Spotify could not be disconnected." });
    }
  }

  async togglePlayPause(): Promise<void> {
    await this.queueCommand(this.current.isPlaying ? "pause" : "play");
  }

  async skipToPrevious(): Promise<void> { await this.queueCommand("previous"); }

  async skipToNext(): Promise<void> { await this.queueCommand("next"); }

  async openSpotify(): Promise<void> {
    if (typeof window !== "undefined") window.open("https://open.spotify.com", "_blank", "noopener,noreferrer");
  }

  private async loadState(): Promise<void> {
    const result = await this.request("/api/spotify/state");
    if (this.disposed || result === null) return;
    this.publish(mapResponse(result, this.current));
    this.stopRefresh();
    if (this.current.connection === "connected" && document.visibilityState === "visible") {
      this.refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void this.loadState();
      }, 15_000);
    }
  }

  private stopRefresh(): void {
    if (this.refreshTimer === null) return;
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async queueCommand(command: "play" | "pause" | "next" | "previous"): Promise<void> {
    const next = this.commandTail.then(() => this.command(command));
    this.commandTail = next.catch(() => undefined);
    await next;
  }

  private async command(command: "play" | "pause" | "next" | "previous"): Promise<void> {
    if (this.disposed || this.disconnecting) return;
    this.sequence += 1;
    const result = await this.request("/api/spotify/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (this.disposed || result === null) return;
    this.publish(mapResponse(result, this.current));
  }

  private async request(path: string, init: RequestInit = {}): Promise<WebStateResponse | null> {
    const controller = new AbortController();
    const requestSequence = this.sequence;
    this.requests.add(controller);
    try {
      const response = await fetch(path, { ...init, credentials: "include", signal: controller.signal });
      const body = await response.json() as WebStateResponse;
      if (this.disposed || requestSequence !== this.sequence) return null;
      return response.ok ? body : { ...body, code: body.code ?? `http_${response.status}` };
    } catch {
      return this.disposed || requestSequence !== this.sequence ? null : { code: "network", message: "Spotify could not be reached." };
    } finally {
      this.requests.delete(controller);
    }
  }

  private publish(snapshot: SpotifyPlayerSnapshot): void {
    if (this.disposed) return;
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

function mapResponse(response: WebStateResponse, previous: SpotifyPlayerSnapshot): SpotifyPlayerSnapshot {
  if (response.connection !== undefined) {
    return {
      connection: response.connection,
      isPlaying: response.isPlaying === true,
      track: response.track ?? null,
      errorMessage: response.errorMessage ?? null,
    };
  }
  if (response.code === "premium_required") return { ...previous, connection: "error", errorMessage: "Spotify playback is restricted. Check Premium and this app's tester access in Spotify setup." };
  if (response.code === "no_device") return { ...previous, connection: "connected", errorMessage: "Open Spotify on a device and start playback first." };
  if (response.code === "reauthorize") return { ...DISCONNECTED, errorMessage: "Connect Spotify again." };
  if (response.code === "network" || response.code === "spotify_unavailable") return { ...previous, connection: "error", errorMessage: response.message ?? "Spotify is temporarily unavailable." };
  if (response.code === "rate_limited") return { ...previous, connection: "error", errorMessage: "Spotify is rate limited. Try again shortly." };
  return { ...previous, connection: "error", errorMessage: response.message ?? "Spotify is unavailable." };
}
