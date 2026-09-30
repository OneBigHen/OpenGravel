import { afterEach, describe, expect, it } from "vitest";
import {
  allowedSpotifyOrigins,
  safeReturnTo,
  spotifyClientId,
  spotifyOriginForRequest,
} from "@/server/spotify/config";

const saved = {
  publicOrigin: process.env.OGV_PUBLIC_ORIGIN,
  allowed: process.env.OGV_SPOTIFY_ALLOWED_ORIGINS,
  client: process.env.SPOTIFY_CLIENT_ID,
};

afterEach(() => {
  if (saved.publicOrigin === undefined) delete process.env.OGV_PUBLIC_ORIGIN; else process.env.OGV_PUBLIC_ORIGIN = saved.publicOrigin;
  if (saved.allowed === undefined) delete process.env.OGV_SPOTIFY_ALLOWED_ORIGINS; else process.env.OGV_SPOTIFY_ALLOWED_ORIGINS = saved.allowed;
  if (saved.client === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = saved.client;
});

describe("Spotify web configuration", () => {
  it("allows only explicitly configured origins", () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    process.env.OGV_SPOTIFY_ALLOWED_ORIGINS = "https://other.example.test,https://ride.example.test, http://bad.example.test";
    expect(allowedSpotifyOrigins()).toEqual(["https://ride.example.test", "https://other.example.test"]);
    expect(spotifyOriginForRequest(new Request("https://ride.example.test/api/spotify/login"))).toBe("https://ride.example.test");
    expect(spotifyOriginForRequest(new Request("https://attacker.example/api/spotify/login"))).toBeNull();
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

