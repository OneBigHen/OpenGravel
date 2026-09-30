import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogin, exchangeCode, readOAuthState } from "@/server/spotify/auth";
import { GET as callbackGET } from "@/app/api/spotify/callback/route";

const CLIENT_ID = "b".repeat(32);
const KEY = "c".repeat(64);
const original = {
  origin: process.env.OGV_PUBLIC_ORIGIN,
  allowed: process.env.OGV_SPOTIFY_ALLOWED_ORIGINS,
  client: process.env.SPOTIFY_CLIENT_ID,
  key: process.env.OGV_SPOTIFY_SESSION_KEY,
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(original)) {
    const envName = name === "origin" ? "OGV_PUBLIC_ORIGIN" : name === "allowed" ? "OGV_SPOTIFY_ALLOWED_ORIGINS" : name === "client" ? "SPOTIFY_CLIENT_ID" : "OGV_SPOTIFY_SESSION_KEY";
    if (value === undefined) delete process.env[envName]; else process.env[envName] = value;
  }
});

describe("Spotify PKCE auth", () => {
  it("creates a PKCE authorization redirect and encrypted state cookie", () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    process.env.SPOTIFY_CLIENT_ID = CLIENT_ID;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const request = new Request("https://ride.example.test/api/spotify/login?return_to=%2Fsettings");
    const result = createLogin(request);
    const redirect = new URL(result.redirect);
    expect(redirect.origin).toBe("https://accounts.spotify.com");
    expect(redirect.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirect.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
    const cookie = result.cookie.split(";", 1)[0]!;
    const stateRequest = new Request("https://ride.example.test/api/spotify/callback", { headers: { cookie } });
    const state = readOAuthState(stateRequest);
    expect(state?.clientId).toBe(CLIENT_ID);
    expect(state?.returnTo).toBe("/settings");
    expect(result.cookie).toContain("__Host-ogv_spotify_oauth=");
  });

  it("exchanges a code without a client secret", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      scope: "user-read-currently-playing",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const session = await exchangeCode({
      state: "state",
      codeVerifier: "verifier",
      clientId: CLIENT_ID,
      origin: "https://ride.example.test",
      returnTo: "/ride",
      expiresAt: Date.now() + 5000,
    }, "authorization-code");
    expect(session.clientId).toBe(CLIENT_ID);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).not.toContain("client_secret");
  });

  it("checks the stored state before honoring a provider cancellation", async () => {
    process.env.OGV_PUBLIC_ORIGIN = "https://ride.example.test";
    process.env.SPOTIFY_CLIENT_ID = CLIENT_ID;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const login = createLogin(new Request("https://ride.example.test/api/spotify/login?return_to=%2Fride"));
    const cookie = login.cookie.split(";", 1)[0]!;
    const response = await callbackGET(new Request("https://ride.example.test/api/spotify/callback?error=access_denied&state=attacker", { headers: { cookie } }));
    expect(response.status).toBe(400);
  });
});
