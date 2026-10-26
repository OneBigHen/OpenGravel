/**
 * The route page's facts line (Explore → a route).
 *
 * Read on a 320 px phone the line used to break inside the time figure: "~2 h
 * 15 min" / "at 28 mph", then the stylesheet's trailing middot alone on a line
 * of its own, where it read as a fact. These tests hold the shape that fixes
 * it: one fact is one whole string, the pace behind an estimate is a note (a
 * title, never words on the line), and the separator is drawn by the
 * stylesheet only between facts, so it cannot be orphaned.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  RIDE_TIME_PACE_MPH,
  estimatedRideMinutes,
  formatRideMinutes,
  routeFacts,
  type RideFactsInput,
} from "@/ui/explore/route-facts";

/** The page's own distance wording, so the facts own no units. */
const miles = (metres: number): string => `${Math.round(metres / 1609.344)} mi`;

function factsOf(overrides: Partial<RideFactsInput> = {}) {
  return routeFacts({
    distanceKm: 27,
    estimatedTimeMinutes: undefined,
    surfaceLabel: null,
    curvatureSummary: undefined,
    formatDistance: miles,
    ...overrides,
  });
}

describe("ride time", () => {
  it("writes minutes, whole hours and both the way a rider says them", () => {
    expect(formatRideMinutes(30)).toBe("30 min");
    expect(formatRideMinutes(60)).toBe("1 h");
    expect(formatRideMinutes(95)).toBe("1 h 35 min");
    expect(formatRideMinutes(150)).toBe("2 h 30 min");
    // A ride is never "0 min".
    expect(formatRideMinutes(0.4)).toBe("1 min");
  });

  it("estimates only from a distance somebody measured, to the quarter hour", () => {
    // 27 km is 17 mi, which is 36 minutes at the stated pace.
    expect(estimatedRideMinutes(27)).toBe(30);
    expect(estimatedRideMinutes(17)).toBe(30);
    // 43 km is 27 mi, or a little under an hour.
    expect(estimatedRideMinutes(43)).toBe(60);
    // A walk to the corner is still a quarter hour, not "2 min".
    expect(estimatedRideMinutes(0.2)).toBe(15);
    expect(estimatedRideMinutes(null)).toBeNull();
    expect(estimatedRideMinutes(undefined)).toBeNull();
    expect(estimatedRideMinutes(0)).toBeNull();
    expect(estimatedRideMinutes(Number.NaN)).toBeNull();
  });
});

describe("the route page's facts", () => {
  it("puts the facts in the order a rider asks them", () => {
    const facts = factsOf({ surfaceLabel: "Mostly paved", curvatureSummary: "14 mi of curves" });
    expect(facts.map((fact) => fact.key)).toEqual(["distance", "time", "surface", "curvature"]);
    expect(facts.map((fact) => fact.text)).toEqual(["17 mi", "~30 min", "Mostly paved", "14 mi of curves"]);
  });

  it("keeps the estimate's pace off the line", () => {
    // The bug: the footnote lived inside the time fact, so at 320 px the fact
    // split into "~2 h 15 min" and "at 28 mph", stranding the separator.
    const [time] = factsOf().filter((fact) => fact.key === "time");
    expect(time?.text).toBe("~30 min");
    expect(time?.text).not.toMatch(/mph/i);
    expect(time?.note).toBe(`Estimated at ${RIDE_TIME_PACE_MPH} mph`);
  });

  it("states a stored ride time without inventing a pace for it", () => {
    const [time] = factsOf({ estimatedTimeMinutes: 95 }).filter((fact) => fact.key === "time");
    expect(time?.text).toBe("1 h 35 min");
    expect(time?.note).toBeUndefined();
  });

  it("gives no fact the line's own separator", () => {
    // The surface evidence arrives as "Mostly paved · 2.1 mi gravel"; on this
    // line the middot separates facts, so inside a fact it becomes a comma.
    const facts = factsOf({ surfaceLabel: "Mostly paved · 2.1 mi gravel" });
    expect(facts.find((fact) => fact.key === "surface")?.text).toBe("Mostly paved, 2.1 mi gravel");
    for (const fact of facts) {
      expect(fact.text).not.toContain("·");
      expect(fact.text.trim()).not.toBe("");
    }
  });

  it("leaves a fact out rather than printing an absence", () => {
    // No distance, no time, no surface, no curvature: no line at all.
    expect(factsOf({ distanceKm: null, surfaceLabel: null, curvatureSummary: undefined })).toEqual([]);
    // A stated time with no distance still stands on its own.
    const timeOnly = factsOf({ distanceKm: null, estimatedTimeMinutes: 45 });
    expect(timeOnly.map((fact) => fact.key)).toEqual(["time"]);
    expect(timeOnly[0]?.note).toBeUndefined();
  });

  it("is drawn with the separator inside the fact before it", () => {
    const css = readFileSync("src/ui/explore/explore-rides.css", "utf8");
    // A fact never splits, so the trailing middot can never begin a line.
    expect(css).toMatch(/\.og-route-detail__fact \{[^}]*white-space: nowrap/);
    // The separator is the stylesheet's, and only between facts.
    expect(css).toMatch(/\.og-route-detail__fact:not\(:last-child\)::after \{[^}]*content: "·"/);
  });
});

describe("the list card's facts and the credit under them", () => {
  it("gives both lines a box taller than their glyphs, with no clip on a phone", () => {
    const css = readFileSync("src/ui/explore/explore-rides.css", "utf8");
    // A tight 1.35 facts box directly above the credit cut the credit's
    // ascenders short in some renderings; both lines now lead their text.
    expect(css).toMatch(/\.og-explore-card--ride \.og-explore-card__facts \{[^}]*line-height: 1\.5/);
    expect(css).toMatch(/\.og-explore-card--ride \.og-explore-card__credit \{[^}]*line-height: 1\.5/);
    // Wrapped fact rows do not sit on each other.
    expect(css).toMatch(/\.og-explore-card--ride \.og-explore-card__facts \{[^}]*row-gap: var\(--og-space-1\)/);
    // A phone card is frameless, so it has nothing to clip for.
    expect(css).toMatch(/\.og-explore-card--ride\.og-explore-card--ride \{[^}]*overflow: visible/);
  });
});
