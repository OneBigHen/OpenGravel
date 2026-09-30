import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as commandPOST } from "@/app/api/spotify/command/route";
import { GET as callbackGET } from "@/app/api/spotify/callback/route";
import { createLogin } from "@/server/spotify/auth";

const CLIENT_ID = "1".repeat(32);
const KEY = "2".repeat(64);
const ORIGIN = "https://ride.example.test";
const original = {
  origin: process.env.OGV_PUBLIC_ORIGIN,
  client: process.env.SPOTIFY_CLIENT_ID,
  key: process.env.OGV_SPOTIFY_SESSION_KEY,
};

afterEach(() => {
  vi.restoreAllMocks();
  if (original.origin === undefined) delete process.env.OGV_PUBLIC_ORIGIN; else process.env.OGV_PUBLIC_ORIGIN = original.origin;
  if (original.client === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = original.client;
  if (original.key === undefined) delete process.env.OGV_SPOTIFY_SESSION_KEY; else process.env.OGV_SPOTIFY_SESSION_KEY = original.key;
});

describe("Spotify route boundaries", () => {
  it("rejects a cross-origin command before it can call Spotify", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await commandPOST(new Request(`${ORIGIN}/api/spotify/command`, {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body: JSON.stringify({ command: "pause" }),
    }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept an unregistered callback host even with a valid state cookie", async () => {
    process.env.OGV_PUBLIC_ORIGIN = ORIGIN;
    process.env.SPOTIFY_CLIENT_ID = CLIENT_ID;
    process.env.OGV_SPOTIFY_SESSION_KEY = KEY;
    const login = createLogin(new Request(`${ORIGIN}/api/spotify/login`));
    const cookie = login.cookie.split(";", 1)[0]!;
    const response = await callbackGET(new Request(`https://attacker.example/api/spotify/callback?code=code&state=state`, { headers: { cookie } }));
    expect(response.status).toBe(400);
  });
});
