import { describe, expect, it } from "vitest";

import { isRideReturnPath, readRideReturn, rememberRideReturn, spotifyOutcomeOf, withoutSpotifyOutcome } from "@/ui/ride/ride-return";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("ride return path", () => {
  it("persists the ride path and expires it after 30 minutes", () => {
    const storage = memory();
    rememberRideReturn("/ride?a=1", 1_000, storage);
    expect(readRideReturn(2_000, storage)).toBe("/ride?a=1");
    expect(readRideReturn(1_000 + 31 * 60_000, storage)).toBeNull();
  });

  it("only accepts the ride screen and survives broken storage", () => {
    const storage = memory();
    rememberRideReturn("https://evil.example/ride", 1, storage);
    rememberRideReturn("//evil.example", 1, storage);
    expect(readRideReturn(2, storage)).toBeNull();
    expect(isRideReturnPath("/ride")).toBe(true);
    expect(isRideReturnPath("/settings")).toBe(false);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => rememberRideReturn("/ride", 1, broken)).not.toThrow();
    expect(readRideReturn(1, broken)).toBeNull();
  });

  it("reads and strips the one-shot spotify outcome", () => {
    expect(spotifyOutcomeOf("?spotify=connected&x=1")).toBe("connected");
    expect(spotifyOutcomeOf("?spotify=nope")).toBeNull();
    expect(withoutSpotifyOutcome("/ride", "?spotify=connected&x=1", "#m")).toBe("/ride?x=1#m");
    expect(withoutSpotifyOutcome("/ride", "?spotify=error", "")).toBe("/ride");
  });
});
