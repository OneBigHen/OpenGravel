/**
 * Internal profile mapping (06-ROUTING-AND-DECISION-ENGINE §6) — the published
 * rider-intent → engine-profile table, independent of any request body.
 */

import { describe, expect, it } from "vitest";

import { defaultRideIntent } from "@/domain/ride/create";
import type { RideIntent } from "@/domain/ride/types";
import {
  GRAPHHOPPER_ENGINE_PROFILES,
  profileFor,
  profileImpliesNonPavedSurface,
} from "@/infrastructure/routing/graphhopper/profiles";

/** The default intent with only the given routing-relevant slots replaced. */
function intent(overrides: Partial<RideIntent>): RideIntent {
  return { ...defaultRideIntent(), ...overrides };
}

/** A pavement envelope, so a character under test is not overridden by surface. */
const PAVEMENT: RideIntent["surface"] = {
  preference: "pavement",
  unknownSurfacePolicy: "allow-with-warning",
};

describe("GraphHopper profile mapping", () => {
  it("maps road character onto engine profiles", () => {
    expect(profileFor(intent({ roadCharacter: "efficient", surface: PAVEMENT }))).toBe(
      "motorcycle_fastest",
    );
    expect(profileFor(intent({ roadCharacter: "balanced", surface: PAVEMENT }))).toBe(
      "motorcycle_fastest",
    );
    expect(profileFor(intent({ roadCharacter: "curvy", surface: PAVEMENT }))).toBe(
      "motorcycle_twisty",
    );
    expect(profileFor(intent({ roadCharacter: "backroads", surface: PAVEMENT }))).toBe(
      "motorcycle_scenic",
    );
  });

  it("lets only a dirt-seeking surface override the road character (OGV-D-262)", () => {
    const mixed = {
      ...defaultRideIntent().surface,
      preference: "mixed",
    } as RideIntent["surface"];
    const dirt = {
      ...defaultRideIntent().surface,
      preference: "dirt-preferred",
    } as RideIntent["surface"];
    const pavement = {
      ...defaultRideIntent().surface,
      preference: "pavement",
    } as RideIntent["surface"];

    // `mixed` is the default envelope; it must not erase the character.
    expect(profileFor(intent({ roadCharacter: "curvy", surface: mixed }))).toBe(
      "motorcycle_twisty",
    );
    expect(profileFor(intent({ roadCharacter: "backroads", surface: dirt }))).toBe(
      "motorcycle_adventure",
    );
    // A pavement envelope states what the rider accepts, not which model to use.
    expect(profileFor(intent({ roadCharacter: "curvy", surface: pavement }))).toBe(
      "motorcycle_twisty",
    );
  });

  it("only ever resolves to a profile the deployment can serve", () => {
    const characters = ["efficient", "balanced", "curvy", "backroads"] as const;
    for (const roadCharacter of characters) {
      const resolved = profileFor(intent({ roadCharacter, surface: PAVEMENT }));
      expect(GRAPHHOPPER_ENGINE_PROFILES).toContain(resolved);
      expect(resolved).not.toContain("neural");
    }
  });
});

describe("dual-sport graph access", () => {
  it("uses the adventure weighting for permitted rough tracks while preserving paved intent", () => {
    const bike = { ...defaultRideIntent().bike, category: "dual-sport" as const, roughTracks: "allow" as const };
    expect(profileFor(intent({ bike, surface: { ...defaultRideIntent().surface, preference: "mixed" } }))).toBe("motorcycle_adventure");
    expect(profileFor(intent({ bike, surface: PAVEMENT }))).toBe("motorcycle_fastest");
  });
});

it("does not infer a dirt preference from an ambiguous dual-sport profile", () => {
  expect(profileImpliesNonPavedSurface("motorcycle_adventure")).toBe(true);
  expect(profileImpliesNonPavedSurface("motorcycle_adventure", "dual-sport")).toBe(false);
});
