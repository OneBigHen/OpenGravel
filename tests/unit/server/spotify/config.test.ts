import { afterEach, describe, expect, it } from "vitest";
import {
  allowedSpotifyOrigins,
  isSameOriginMutation,
  safeReturnTo,
  spotifyClientId,
  spotifyOriginForRequest,
  spotifySessionKey,
} from "@/server/spotify/config";

const saved = {
  publicOrigin: process.env.OGV_PUBLIC_ORIGIN,
  allowed: process.env.OGV_SPOTIFY_ALLOWED_ORIGINS,
  client: process.env.SPOTIFY_CLIENT_ID,
  key: process.env.OGV_SPOTIFY_SESSION_KEY,
};

afterEach(() => {
  if (saved.publicOrigin === undefined) delete process.env.OGV_PUBLIC_ORIGIN; else process.env.OGV_PUBLIC_ORIGIN = saved.publicOrigin;
  if (saved.allowed === undefined) delete process.env.OGV_SPOTIFY_ALLOWED_ORIGINS; else process.env.OGV_SPOTIFY_ALLOWED_ORIGINS = saved.allowed;
  if (saved.client === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = saved.client;
  if (saved.key === undefined) delete process.env.OGV_SPOTIFY_SESSION_KEY; else process.env.OGV_SPOTIFY_SESSION_KEY = saved.key;
});

describe("Spotify web configuration", () => {
  it("declares Spotify unavailable for a malformed session encryption key", () => {
    process.env.OGV_SPOTIFY_SESSION_KEY = "abc";
    expect(spotifySessionKey()).toBeNull();
    process.env.OGV_SPOTIFY_SESSION_KEY = "a".repeat(64);
    expect(spotifySessionKey()).toBe("a".repeat(64));
  });

  it("allows only explicitly configured origins", () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    process.env.OGV_SPOTIFY_ALLOWED_ORIGINS = "https://other.example.test,https://ride.example.test, http://bad.example.test";
    expect(allowedSpotifyOrigins()).toEqual(["https://ride.example.test", "https://other.example.test"]);
    expect(spotifyOriginForRequest(new Request("https://ride.example.test/api/spotify/login"))).toBe("https://ride.example.test");
    expect(spotifyOriginForRequest(new Request("https://attacker.example/api/spotify/login"))).toBeNull();
  });

  it("uses the public Host when Next internally constructs the URL", () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    const internal = new Request("http://0.0.0.0:3200/api/spotify/login", { headers: { host: "ride.example.test" } });
    expect(spotifyOriginForRequest(internal)).toBe("https://ride.example.test");
    const forwarded = new Request("http://0.0.0.0:3200/api/spotify/login", { headers: { "x-forwarded-host": "ride.example.test" } });
    expect(spotifyOriginForRequest(forwarded)).toBe("https://ride.example.test");
  });

  it("rejects a host that conflicts with the URL or forwarded host", () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    expect(spotifyOriginForRequest(new Request("https://ride.example.test/api/spotify/login", { headers: { host: "attacker.example" } }))).toBeNull();
    expect(spotifyOriginForRequest(new Request("http://0.0.0.0:3200/api/spotify/login", { headers: { host: "ride.example.test", "x-forwarded-host": "attacker.example" } }))).toBeNull();
    expect(spotifyOriginForRequest(new Request("https://ride.example.test/api/spotify/login", { headers: { host: "ride.example.test,attacker.example" } }))).toBeNull();
  });

  it("checks mutation Origin against the validated public origin", () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    const internal = "http://0.0.0.0:3200/api/spotify/command";
    expect(isSameOriginMutation(new Request(internal, { method: "POST", headers: { host: "ride.example.test", origin: "https://ride.example.test" } }))).toBe(true);
    expect(isSameOriginMutation(new Request(internal, { method: "POST", headers: { host: "ride.example.test", origin: "https://attacker.example" } }))).toBe(false);
  });

  it("rejects an invalid explicit client ID instead of falling back", () => {
    process.env.SPOTIFY_CLIENT_ID = "a".repeat(32);
    expect(spotifyClientId(null)).toBe("a".repeat(32));
    expect(spotifyClientId("not-a-client-id")).toBeNull();
  });

  it("keeps return targets on the ride or settings surface", () => {
    expect(safeReturnTo("/ride?record=1#map")).toBe("/ride?record=1#map");
    expect(safeReturnTo("//attacker.example/steal")).toBe("/ride");
    expect(safeReturnTo("/\t/attacker.example")).toBe("/ride");
    expect(safeReturnTo("https://attacker.example")).toBe("/ride");
    expect(safeReturnTo("/admin")).toBe("/ride");
  });
});
