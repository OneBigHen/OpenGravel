import { afterEach, describe, expect, it, vi } from "vitest";
import { readPlayerState } from "@/server/spotify/player-api";
import { sealJson } from "@/server/spotify/crypto";

const KEY = "d".repeat(64);
const CLIENT_ID = "e".repeat(32);
const ORIGIN = "https://ride.example.test";
const original = {
  origin: process.env.OGV_PUBLIC_ORIGIN,
  client: process.env.SPOTIFY_CLIENT_ID,
  key: process.env.OGV_SPOTIFY_SESSION_KEY,
};

function requestWithSession(expiresAt: number, accessToken = "old-access", clientId = CLIENT_ID, refreshToken = "refresh"): Request {
  const sealed = sealJson({ clientId, accessToken, refreshToken, expiresAt }, KEY)!;
  return new Request(`${ORIGIN}/api/spotify/state`, { headers: { cookie: `__Host-ogv_spotify_session=${encodeURIComponent(sealed)}` } });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (original.origin === undefined) delete process.env.OGV_PUBLIC_ORIGIN; else process.env.OGV_PUBLIC_ORIGIN = original.origin;
  if (original.client === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = original.client;
  if (original.key === undefined) delete process.env.OGV_SPOTIFY_SESSION_KEY; else process.env.OGV_SPOTIFY_SESSION_KEY = original.key;
});

describe("Spotify player server adapter", () => {
  it("refreshes one expired session once for concurrent state reads", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const tokenFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("api/token")) return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer new-access");
      return new Response(JSON.stringify({ is_playing: true, item: { uri: "spotify:track:1", name: "Road", artists: [{ name: "Rider" }], album: { images: [] } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", tokenFetch);
    const [one, two] = await Promise.all([readPlayerState(requestWithSession(Date.now() - 1)), readPlayerState(requestWithSession(Date.now() - 1))]);
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    expect(tokenFetch.mock.calls.filter(([input]) => String(input).includes("api/token"))).toHaveLength(1);
    expect(one.value?.track?.title).toBe("Road");
    await readPlayerState(requestWithSession(Date.now() - 1));
    expect(tokenFetch.mock.calls.filter(([input]) => String(input).includes("api/token"))).toHaveLength(1);
  });

  it("maps Premium and rate-limit responses without exposing tokens", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    const result = await readPlayerState(requestWithSession(Date.now() + 60_000, "old-access", CLIENT_ID, "refresh-retry"));
    expect(result).toMatchObject({ ok: false, error: { status: 403, code: "premium_required" } });
  });

  it("retries one expired access token through the serialized refresh path", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "refresh", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ is_playing: false, item: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await readPlayerState(requestWithSession(Date.now() + 60_000, "old-access", CLIENT_ID, "refresh-retry"));
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps two browser sessions on their own Spotify access tokens", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const authHeaders: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authHeaders.push((init?.headers as Record<string, string>).authorization ?? "");
      return new Response(JSON.stringify({ is_playing: false, item: null }), { status: 200 });
    }));
    await readPlayerState(requestWithSession(Date.now() + 60_000, "access-one", "a".repeat(32)));
    await readPlayerState(requestWithSession(Date.now() + 60_000, "access-two", "b".repeat(32)));
    expect(authHeaders).toEqual(["Bearer access-one", "Bearer access-two"]);
  });

  it("turns upstream transport failures into a safe API error", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private upstream detail"); }));
    const result = await readPlayerState(requestWithSession(Date.now() + 60_000, "safe-access", CLIENT_ID, "refresh-network"));
    expect(result).toMatchObject({ ok: false, error: { status: 502, code: "spotify_unavailable" } });
  });
});
