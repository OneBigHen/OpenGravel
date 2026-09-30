import { describe, expect, it } from "vitest";
import { keyFromConfig, openJson, sealJson } from "@/server/spotify/crypto";

const KEY = "a".repeat(64);

describe("Spotify cookie crypto", () => {
  it("round trips authenticated JSON with a hex key", () => {
    const sealed = sealJson({ account: "one", expiresAt: 123 }, KEY);
    expect(sealed).not.toBeNull();
    expect(openJson(sealed, KEY)).toEqual({ account: "one", expiresAt: 123 });
    const tampered = `${sealed!.slice(0, -1)}${sealed!.endsWith("a") ? "b" : "a"}`;
    expect(openJson(tampered, KEY)).toBeNull();
  });

  it("accepts exactly 32-byte base64 keys and bounds the cookie payload", () => {
    const base64Key = Buffer.alloc(32, 7).toString("base64");
    expect(keyFromConfig(base64Key)?.length).toBe(32);
    expect(keyFromConfig("too-short")).toBeNull();
    expect(sealJson({ large: "x".repeat(4000) }, KEY)).toBeNull();
  });
});
