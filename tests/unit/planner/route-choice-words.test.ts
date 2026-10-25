/**
 * The one-word character of a phone option row (small-screen design system v2
 * §3). A word is a comparison, so it only appears where the cards can carry it:
 * every option measured the trait, one option is measurably the best at it by a
 * margin that means something, and the word does not merely repeat that
 * option's role name.
 */
import { describe, expect, it } from "vitest";

import type { RouteCardMeasurements, RouteCardVm } from "@/application/planner/planner-view-model";
import { routeChoiceWords } from "@/application/planner/route-choice-words";
import { asRouteCandidateId } from "@/domain/route/ids";

function measured(overrides: Partial<RouteCardMeasurements> = {}): RouteCardMeasurements {
  return { curvyMi: null, unpavedMi: null, busyShare: null, ...overrides };
}

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
    measurements: measured(),
    ...overrides,
  };
}

describe("routeChoiceWords", () => {
  it("gives each of three options the one trait it is best at", () => {
    const words = routeChoiceWords([
      card("a", { addedMinutes: 12, measurements: measured({ curvyMi: 18, unpavedMi: 2, busyShare: 0.3 }) }),
      card("b", { addedMinutes: 0, measurements: measured({ curvyMi: 3, unpavedMi: 0.4, busyShare: 0.5 }) }),
      card("c", { addedMinutes: 20, measurements: measured({ curvyMi: 6, unpavedMi: 9, busyShare: 0.22 }) }),
    ]);
    expect(words).toEqual({ a: "Twistiest", b: "Quickest", c: "Most dirt" });
  });

  it("says nothing when an option did not measure the trait", () => {
    // `c` has no curvature evidence: the known option is not "twistiest" over an
    // unknown one, so the word is withheld rather than guessed.
    const words = routeChoiceWords([
      card("a", { addedMinutes: 0, measurements: measured({ curvyMi: 18 }) }),
      card("b", { addedMinutes: 4, measurements: measured({ curvyMi: 3 }) }),
      card("c", { addedMinutes: 8 }),
    ]);
    expect(words["a"]).toBe("Quickest");
    expect(Object.values(words)).not.toContain("Twistiest");
  });

  it("withholds a word that two options tie for", () => {
    const words = routeChoiceWords([
      card("a", { addedMinutes: 3, measurements: measured({ curvyMi: 9 }) }),
      card("b", { addedMinutes: 0, measurements: measured({ curvyMi: 9 }) }),
    ]);
    expect(Object.values(words)).not.toContain("Twistiest");
    expect(words["b"]).toBe("Quickest");
  });

  it("does not repeat the option's own role name", () => {
    const words = routeChoiceWords([
      card("a", { roleKey: "best-ride", roleLabel: "Best Ride", addedMinutes: 6, measurements: measured({ curvyMi: 12 }) }),
      card("b", { roleKey: "fastest", roleLabel: "Fastest", addedMinutes: 0, measurements: measured({ curvyMi: 2 }) }),
    ]);
    expect(words).toEqual({ a: "Twistiest" });
  });

  it("gives one word per option at most", () => {
    const words = routeChoiceWords([
      card("a", { addedMinutes: 0, measurements: measured({ curvyMi: 18, unpavedMi: 7 }) }),
      card("b", { addedMinutes: 9, measurements: measured({ curvyMi: 2, unpavedMi: 1.2 }) }),
    ]);
    expect(words).toEqual({ a: "Twistiest" });
  });

  it("does not call an all-paved set 'most dirt'", () => {
    const words = routeChoiceWords([
      card("a", { measurements: measured({ unpavedMi: 0 }) }),
      card("b", { measurements: measured({ unpavedMi: 0 }) }),
    ]);
    expect(Object.values(words)).not.toContain("Most dirt");
  });

  it("needs over a mile of unpaved road before 'most dirt' is the reason", () => {
    const short = routeChoiceWords([
      card("a", { measurements: measured({ unpavedMi: 0.8 }) }),
      card("b", { measurements: measured({ unpavedMi: 0.2 }) }),
    ]);
    expect(Object.values(short)).not.toContain("Most dirt");

    const real = routeChoiceWords([
      card("a", { measurements: measured({ unpavedMi: 4.6 }) }),
      card("b", { measurements: measured({ unpavedMi: 1.2 }) }),
    ]);
    expect(real).toEqual({ a: "Most dirt" });
  });

  it("names the quietest option when it is clearly quieter", () => {
    const words = routeChoiceWords([
      card("a", { addedMinutes: 0, measurements: measured({ busyShare: 0.42 }) }),
      card("b", { addedMinutes: 5, measurements: measured({ busyShare: 0.18 }) }),
      card("c", { addedMinutes: 8, measurements: measured({ busyShare: 0.5 }) }),
    ]);
    expect(words).toEqual({ a: "Quickest", b: "Fewest busy roads" });
  });

  it("will not call a hair's-breadth quieter route the quietest", () => {
    const words = routeChoiceWords([
      card("a", { measurements: measured({ busyShare: 0.3 }) }),
      card("b", { measurements: measured({ busyShare: 0.26 }) }),
    ]);
    expect(Object.values(words)).not.toContain("Fewest busy roads");
  });

  it("says nothing about busy roads when one option did not measure them", () => {
    const words = routeChoiceWords([
      card("a", { measurements: measured({ busyShare: 0.4 }) }),
      card("b"),
    ]);
    expect(Object.values(words)).not.toContain("Fewest busy roads");
  });

  it("needs at least two options to compare", () => {
    expect(
      routeChoiceWords([card("a", { addedMinutes: 0, measurements: measured({ curvyMi: 18 }) })]),
    ).toEqual({});
  });
});
