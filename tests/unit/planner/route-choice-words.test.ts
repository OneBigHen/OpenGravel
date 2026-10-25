/**
 * The one-word character of a phone option row (small-screen design system v2
 * §3). A word is a comparison, so it only appears where the cards can carry it:
 * every option measured the trait, one option is strictly the best at it, and
 * the word does not merely repeat that option's role name.
 */
import { describe, expect, it } from "vitest";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { routeChoiceWords } from "@/application/planner/route-choice-words";
import { asRouteCandidateId } from "@/domain/route/ids";

function card(id: string, overrides: Partial<RouteCardVm> = {}): RouteCardVm {
  return {
    routeId: asRouteCandidateId(id),
    roleKey: "alternative",
    roleLabel: "Alternative",
    durationLabel: "53 min",
    distanceLabel: "33 mi",
    addedTimeLabel: null,
    badges: [],
    unknownSurfaceMi: null,
    whyKey: id,
    isSelected: false,
    ...overrides,
  };
}

const curvy = (level: 1 | 2 | 3 | 4 | 5): RouteCardVm["curviness"] => ({ level, label: `Curvy ${level}` });
const dirt = (share: number): RouteCardVm["surfaceStrip"] => ({
  paved: 1 - share,
  gravel: 0,
  dirt: share,
  unknown: 0,
});

describe("routeChoiceWords", () => {
  it("gives each of three options the one trait it is best at", () => {
    const words = routeChoiceWords([
      card("a", { curviness: curvy(5), addedMinutes: 12, surfaceStrip: dirt(0.1) }),
      card("b", { curviness: curvy(2), addedMinutes: 0, surfaceStrip: dirt(0.2) }),
      card("c", { curviness: curvy(3), addedMinutes: 20, surfaceStrip: dirt(0.6) }),
    ]);
    expect(words).toEqual({ a: "Twistiest", b: "Quickest", c: "Most dirt" });
  });

  it("says nothing when an option did not measure the trait", () => {
    // `c` has no curvature evidence: the known option is not "twistiest" over an
    // unknown one, so the word is withheld rather than guessed.
    const words = routeChoiceWords([
      card("a", { curviness: curvy(5), addedMinutes: 0 }),
      card("b", { curviness: curvy(2), addedMinutes: 4 }),
      card("c", { addedMinutes: 8 }),
    ]);
    expect(words["a"]).toBe("Quickest");
    expect(Object.values(words)).not.toContain("Twistiest");
  });

  it("withholds a word that two options tie for", () => {
    const words = routeChoiceWords([
      card("a", { curviness: curvy(4), addedMinutes: 3 }),
      card("b", { curviness: curvy(4), addedMinutes: 0 }),
    ]);
    expect(Object.values(words)).not.toContain("Twistiest");
    expect(words["b"]).toBe("Quickest");
  });

  it("does not repeat the option's own role name", () => {
    const words = routeChoiceWords([
      card("a", { roleKey: "best-ride", roleLabel: "Best Ride", curviness: curvy(4), addedMinutes: 6 }),
      card("b", { roleKey: "fastest", roleLabel: "Fastest", curviness: curvy(2), addedMinutes: 0 }),
    ]);
    expect(words).toEqual({ a: "Twistiest" });
  });

  it("gives one word per option at most", () => {
    const words = routeChoiceWords([
      card("a", { curviness: curvy(5), addedMinutes: 0, surfaceStrip: dirt(0.7) }),
      card("b", { curviness: curvy(2), addedMinutes: 9, surfaceStrip: dirt(0.1) }),
    ]);
    expect(words).toEqual({ a: "Twistiest" });
  });

  it("does not call an all-paved set 'most dirt'", () => {
    const words = routeChoiceWords([
      card("a", { surfaceStrip: dirt(0) }),
      card("b", { surfaceStrip: dirt(0) }),
    ]);
    expect(Object.values(words)).not.toContain("Most dirt");
  });

  it("needs at least two options to compare", () => {
    expect(routeChoiceWords([card("a", { curviness: curvy(5), addedMinutes: 0 })])).toEqual({});
  });
});
