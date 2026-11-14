import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_TABLE,
  LEGAL_TABLE,
  NON_ANSWER,
  difficultyFactOf,
  difficultyValue,
  factsFor,
  hasFactRow,
  legalFactOf,
  legalValue,
  legalWording,
  namesSource,
  parseSourceRating,
  permitWording,
  phraseFor,
  seasonFactOf,
  seasonWording,
  surfaceFactOf,
  surfaceValue,
  surfaceWording,
  type FactName,
  unsourcedClaims,
} from "@/application/route-library/facts";
import type { SourcePolicy } from "@/application/route-library/policy";
import { deriveRide, pinFor } from "@/application/route-library/ride-detail";
import {
  isLengthMismatch,
  isOldTrack,
  isRoughTrack,
  MISMATCH_FRACTION,
  OLD_TRACK_YEAR,
  ROUGH_JUMP_MILES,
  ROUGH_POINTS_PER_30_MILES,
} from "@/application/route-library/track-flags";
import type { LibraryRecord, RideFact } from "@/application/route-library/types";

import snapshot from "../../../scripts/route-library/phrases.snapshot.json";

const HOST: SourcePolicy = { mode: "host", basis: "test" };

function record(over: Partial<Omit<LibraryRecord, "gpx">> & { gpx?: Partial<LibraryRecord["gpx"]> } = {}): LibraryRecord {
  const { gpx, ...rest } = over;
  return {
    id: "tn-test-road",
    name: "Test road",
    states: ["TN"],
    lane: "paved-twisty",
    source: { name: "Site", url: "https://example.com/a" },
    author_credit: { author: "Sam" },
    value_score: 4,
    scraped_at: "2026-11-13T00:00:00Z",
    last_verified: "2026-11-13T00:00:00Z",
    gpx: { availability: "none", ...gpx },
    ...rest,
  };
}

describe("the phrases the builder saw", () => {
  const facts = snapshot.facts as Record<FactName, readonly { phrase: string; count: number; value: string | null; tableRow: boolean }[]>;

  it("maps every phrase to a table row or leaves it null", () => {
    const unmapped = (Object.keys(facts) as FactName[]).flatMap((fact) =>
      facts[fact].filter((row) => !hasFactRow(fact, row.phrase) && row.value !== null).map((row) => `${fact}: ${row.phrase}`),
    );
    expect(unmapped).toEqual([]);
    for (const fact of Object.keys(facts) as FactName[]) {
      for (const row of facts[fact]) expect(row.tableRow).toBe(hasFactRow(fact, row.phrase));
    }
  });

  it("never maps a non-answer to a value", () => {
    const offenders = (Object.keys(facts) as FactName[]).flatMap((fact) =>
      facts[fact].filter((row) => row.value !== null && NON_ANSWER.test(row.phrase.trim().replace(/\s+/g, " "))).map((row) => `${fact}: ${row.phrase} -> ${row.value}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reads every non-answer word as no value, for every fact", () => {
    for (const word of ["unknown", "Unknown", "not stated", "none stated", "varies", "?", ""]) {
      expect(surfaceFactOf(word, "site")).toEqual({ value: null, quote: null, source: null });
      expect(legalFactOf(word, "site")).toEqual({ value: null, quote: null, source: null });
      expect(difficultyFactOf(word, "site")).toEqual({ value: null, quote: null, source: null });
      expect(seasonFactOf(word, "site")).toEqual({ value: null, quote: null, source: null });
      expect(permitWording({ value: null, quote: null, source: null })).toBeNull();
    }
  });
});

describe("surface", () => {
  it("reads the three cases the brief names", () => {
    expect(surfaceValue("paved state highway")).toBe("paved");
    expect(surfaceValue("gravel-paved")).toBe("mixed");
    expect(surfaceValue("private park trails (dirt/single-track)")).toBe("unpaved");
  });

  it("leaves a phrase with no row unknown and keeps the words", () => {
    expect(surfaceFactOf("smooth as butter", "Ride report")).toEqual({ value: null, quote: "smooth as butter", source: "Ride report" });
    expect(surfaceValue("unknown")).toBeNull();
  });

  it("words a claim as the source's, and a silence as unknown", () => {
    expect(surfaceWording({ value: "paved", quote: "paved", source: "site" })).toBe("Paved, the source says");
    expect(surfaceWording({ value: "unpaved", quote: "dirt", source: "site" })).toBe("Unpaved, the source says");
    expect(surfaceWording({ value: "mixed", quote: "paved and gravel", source: "site" })).toBe("Mixed surface, the source says");
    expect(surfaceWording({ value: null, quote: null, source: null })).toBe("Surface unknown");
    expect(surfaceWording({ value: null, quote: "smooth as butter", source: "site" })).toBe("Surface unknown");
  });
});

describe("legal status", () => {
  it("reads the source's three claims and nothing else", () => {
    expect(legalValue("public-roads")).toBe("public-roads");
    expect(legalValue("designated-ohv")).toBe("designated-ohv");
    expect(legalValue("mixed")).toBe("mixed");
    expect(legalValue("unknown")).toBeNull();
    expect(legalValue("open")).toBeNull();
    expect(Object.keys(LEGAL_TABLE).sort()).toEqual(["designated-ohv", "mixed", "public-roads"]);
  });

  it("never says open or legal when the source did not", () => {
    const fact = factsFor(record({ surface: { legal_status: "unknown" } })).legal;
    expect(fact).toEqual({ value: null, quote: null, source: null });
    expect(legalWording(fact)).toBeNull();
    expect(legalWording(fact) ?? "").not.toMatch(/open|legal/i);
  });

  it("says an OHV area is open to motorcycles on the source's word", () => {
    expect(legalWording({ value: "designated-ohv", quote: "designated-ohv", source: "MI DNR" })).toBe("Open to motorcycles, the source says");
    expect(legalWording({ value: "public-roads", quote: "public-roads", source: "site" })).toBe("Public roads, the source says");
  });
});

describe("difficulty", () => {
  it("keeps the schema's words that say something and drops unknown", () => {
    expect(difficultyValue("easy")).toBe("easy");
    expect(difficultyValue("Moderate")).toBe("moderate");
    expect(difficultyValue("difficult")).toBe("difficult");
    expect(difficultyValue("expert")).toBe("expert");
    expect(difficultyValue("unknown")).toBeNull();
    expect(difficultyValue("hard")).toBeNull();
    expect(Object.keys(DIFFICULTY_TABLE)).toHaveLength(5);
  });
});

describe("season and permits", () => {
  it("carries the source's own words and drops a silence", () => {
    expect(seasonFactOf("May, June, September, October", "ridebdr.com")).toEqual({
      value: "May, June, September, October",
      quote: "May, June, September, October",
      source: "ridebdr.com",
    });
    const permit = factsFor(record({ surface: { permits: "AZ State Land Trust Recreation Permit $15" } })).permits;
    expect(permitWording(permit)).toBe("Permit: AZ State Land Trust Recreation Permit $15 (the source says)");
    expect(permitWording({ value: null, quote: null, source: null })).toBeNull();
  });

  it("leaves a season off the card and says 'Season not stated' on the page", () => {
    const none: RideFact<string> = { value: null, quote: null, source: null };
    expect(seasonWording(none, "card")).toBeNull();
    expect(seasonWording(none, "page")).toBe("Season not stated");
    const stated: RideFact<string> = { value: "Open June to October", quote: "Open June to October", source: "site" };
    expect(seasonWording(stated, "card")).toBe("Open June to October (the source says)");
    expect(seasonWording(stated, "page")).toBe("Season: Open June to October (the source says)");
  });
});

describe("the five facts of a record", () => {
  it("keeps null as null and carries a quote only when the source spoke", () => {
    const facts = factsFor(
      record({
        surface: {
          mix: "back roads with sand sections",
          legal_status: "public-roads",
          difficulty: "unknown",
          seasonality: "unknown",
          permits: "none stated",
          surface_claim_source: "Thread post",
        },
      }),
    );
    expect(facts.surface).toEqual({ value: null, quote: "back roads with sand sections", source: "Thread post" });
    expect(facts.legal.value).toBe("public-roads");
    expect(facts.difficulty).toEqual({ value: null, quote: null, source: null });
    expect(facts.permits).toEqual({ value: null, quote: null, source: null });
    expect(facts.season).toEqual({ value: null, quote: null, source: null });
  });

  it("names the difficulty's own source when it has one", () => {
    const facts = factsFor(record({ surface: { difficulty: "difficult", difficulty_source: "Thread post", surface_claim_source: "Route page" } }));
    expect(facts.difficulty).toEqual({ value: "difficult", quote: "difficult", source: "Thread post" });
  });

  it("reads the same raw field into the phrase snapshot", () => {
    const filled = record({ surface: { mix: "Paved", legal_status: "mixed", difficulty: "easy", permits: "None required", seasonality: "Year round" } });
    expect(phraseFor(filled, "surface")).toBe("Paved");
    expect(phraseFor(filled, "legal")).toBe("mixed");
    expect(phraseFor(filled, "difficulty")).toBe("easy");
    expect(phraseFor(filled, "permits")).toBe("None required");
    expect(phraseFor(filled, "season")).toBe("Year round");
    expect(phraseFor(record(), "surface")).toBeNull();
  });
});

describe("a claim whose provenance names no source", () => {
  it("never credits the surface source to the difficulty", () => {
    // The real library has 33 records like this: a difficulty value, no
    // difficulty_source, and a surface_claim_source that is a different fact's.
    const facts = factsFor(record({ surface: { difficulty: "moderate", surface_claim_source: "Route page" } }));
    expect(facts.difficulty).toEqual({ value: null, quote: "moderate", source: null });
  });

  it("treats a blank provenance field as no source", () => {
    expect(factsFor(record({ surface: { difficulty: "moderate", difficulty_source: "   ", surface_claim_source: "Route page" } })).difficulty).toEqual({
      value: null,
      quote: "moderate",
      source: null,
    });
  });

  it("drops a value whose own provenance says the source did not state it", () => {
    for (const source of ["not stated on source page", "not stated on source page; scenic byway on a paved state highway", "unknown", "N/A", "-", "?"]) {
      expect(difficultyFactOf("easy", source)).toEqual({ value: null, quote: "easy", source: null });
    }
  });

  it("names a source when the field is a real one, a URL's query string included", () => {
    expect(namesSource("BestBikingRoads route page")).toBe(true);
    expect(namesSource("parks.ca.gov/?page_id=1170")).toBe(true);
    expect(namesSource("  USFS page  ")).toBe(true);
    expect(namesSource("")).toBe(false);
    expect(namesSource("   ")).toBe(false);
    expect(namesSource(undefined)).toBe(false);
    expect(namesSource("none stated")).toBe(false);
  });

  it("applies the same rule to every fact, not only difficulty", () => {
    const facts = factsFor(
      record({
        surface: {
          mix: "paved",
          legal_status: "public-roads",
          difficulty: "moderate",
          permits: "$5/day",
          seasonality: "May to October",
          surface_claim_source: "",
        },
      }),
    );
    expect(facts.surface.value).toBeNull();
    expect(facts.legal.value).toBeNull();
    expect(facts.difficulty.value).toBeNull();
    expect(facts.permits.value).toBeNull();
    expect(facts.season.value).toBeNull();
  });

  it("keeps the record's words for review and lists every withheld claim", () => {
    const claims = unsourcedClaims(
      record({
        surface: {
          mix: "paved",
          legal_status: "public-roads",
          difficulty: "moderate",
          permits: "$5/day",
          seasonality: "May to October",
          surface_claim_source: "",
        },
      }),
    );
    expect(claims).toEqual([
      { fact: "surface", value: "paved", quote: "paved" },
      { fact: "legal", value: "public-roads", quote: "public-roads" },
      { fact: "difficulty", value: "moderate", quote: "moderate" },
      { fact: "permits", value: "$5/day", quote: "$5/day" },
      { fact: "season", value: "May to October", quote: "May to October" },
    ]);
    expect(
      unsourcedClaims(
        record({ surface: { difficulty: "moderate", difficulty_source: "Thread post", surface_claim_source: "Route page" } }),
      ),
    ).toEqual([]);
  });

  it("keeps every sourced claim, so the rule only withholds what cannot be shown", () => {
    const facts = factsFor(record({ surface: { mix: "paved", difficulty: "easy", difficulty_source: "Route page", permits: "$5/day", surface_claim_source: "Route page" } }));
    expect(facts.surface).toEqual({ value: "paved", quote: "paved", source: "Route page" });
    expect(facts.difficulty).toEqual({ value: "easy", quote: "easy", source: "Route page" });
    expect(facts.permits).toEqual({ value: "$5/day", quote: "$5/day", source: "Route page" });
    expect(unsourcedClaims(record({ surface: { mix: "paved", legal_status: "public-roads", permits: "$5/day", surface_claim_source: "Route page" } }))).toEqual([]);
  });

  it("never reaches the ride detail as a value", () => {
    const derived = deriveRide(record({ surface: { difficulty: "moderate", surface_claim_source: "Route page" } }), HOST, null);
    expect(derived.detail.facts.difficulty).toEqual({ value: null, quote: "moderate", source: null });
  });
});

describe("a rider rating a source published", () => {
  it("reads the exact wording from a text note", () => {
    const cases: readonly [string, { value: number; scale: number; count: number }][] = [
      ["rider rating 4/5 (3 reviews)", { value: 4, scale: 5, count: 3 }],
      ["Rider rating 4.6/5 (23 reviews)", { value: 4.6, scale: 5, count: 23 }],
      ["Page checked 2026-11-13. rider rating 5/5 (1 review)", { value: 5, scale: 5, count: 1 }],
      ["RIDER RATING 3.5/5 (12 REVIEWS)", { value: 3.5, scale: 5, count: 12 }],
      ["A long note about terms. Rider rating 2/5 (127 reviews) then more text.", { value: 2, scale: 5, count: 127 }],
    ];
    for (const [notes, expected] of cases) {
      expect(parseSourceRating(record({ scraper: { notes } }))).toEqual(expected);
    }
  });

  it("reads the same wording out of terms_provenance, as a string or an object", () => {
    expect(parseSourceRating(record({ terms_provenance: "rider rating 4.5/5 (8 reviews)" }))).toEqual({ value: 4.5, scale: 5, count: 8 });
    expect(parseSourceRating(record({ terms_provenance: { terms_quote: "rider rating 3/5 (9 reviews)" } }))).toEqual({ value: 3, scale: 5, count: 9 });
  });

  it("does not read a near miss", () => {
    expect(parseSourceRating(record({ scraper: { notes: "BBR 4.0/5; page length 174 km" } }))).toBeNull();
    expect(parseSourceRating(record({ scraper: { notes: "rider rating 4.6 out of 5 from 23 riders" } }))).toBeNull();
    expect(parseSourceRating(record({ scraper: { notes: "rider rating 4.6/5" } }))).toBeNull();
    expect(parseSourceRating(record({ scraper: { notes: "unrated (MCR: no rider rating) 4.60/5" } }))).toBeNull();
  });

  it("uses the structured field first and never repairs a malformed one", () => {
    expect(parseSourceRating(record({ source_rating: { value: 4.6, scale: 5, count: 23 }, scraper: { notes: "rider rating 1/5 (1 review)" } }))).toEqual({ value: 4.6, scale: 5, count: 23 });
    const noCount = { source_rating: { value: 4.6, scale: 5 } } as unknown as Partial<LibraryRecord>;
    expect(parseSourceRating(record(noCount))).toEqual({ value: 4.6, scale: 5, count: null });
    expect(parseSourceRating(record({ source_rating: { value: 9, scale: 5, count: 2 }, scraper: { notes: "rider rating 4/5 (3 reviews)" } }))).toBeNull();
    const notANumber = { source_rating: { value: "4.6", scale: 5 } } as unknown as Partial<LibraryRecord>;
    expect(parseSourceRating(record(notANumber))).toBeNull();
  });

  it("reaches the ride detail", () => {
    const derived = deriveRide(record({ source_rating: { value: 4.6, scale: 5, count: 23 } }), HOST, null);
    expect(derived.detail.sourceRating).toEqual({ value: 4.6, scale: 5, count: 23 });
    expect(deriveRide(record(), HOST, null).detail.sourceRating).toBeNull();
  });
});

describe("track flags", () => {
  it("names its thresholds", () => {
    expect(ROUGH_POINTS_PER_30_MILES).toBe(20);
    expect(ROUGH_JUMP_MILES).toBe(3);
    expect(OLD_TRACK_YEAR).toBe(2015);
    expect(MISMATCH_FRACTION).toBe(0.4);
  });

  it("calls a sparse track rough and a dense one not", () => {
    expect(isRoughTrack({ miles: 60, rawPoints: 8, longestJumpMiles: 0, bundle: false })).toBe(true);
    expect(isRoughTrack({ miles: 60, rawPoints: 400, longestJumpMiles: 1, bundle: false })).toBe(false);
    expect(isRoughTrack({ miles: null, rawPoints: 0, longestJumpMiles: 0, bundle: false })).toBe(false);
  });

  it("calls a jump over 3 miles rough on a ride, but not on a bundle", () => {
    expect(isRoughTrack({ miles: 20, rawPoints: 400, longestJumpMiles: 3.2, bundle: false })).toBe(true);
    expect(isRoughTrack({ miles: 20, rawPoints: 400, longestJumpMiles: 3.2, bundle: true })).toBe(false);
  });

  it("calls 2015 and earlier old, and an unknown year not old", () => {
    expect(isOldTrack(2015)).toBe(true);
    expect(isOldTrack(2016)).toBe(false);
    expect(isOldTrack(null)).toBe(false);
  });

  it("flags a length more than 40 percent off the source's", () => {
    expect(isLengthMismatch(30, 100 * 0.621371)).toBe(true);
    expect(isLengthMismatch(50, 100 * 0.621371)).toBe(false);
    expect(isLengthMismatch(null, 10)).toBe(false);
  });
});

describe("where the pin goes", () => {
  const bounds = { west: -80, south: 40, east: -79, north: 41 };

  it("copies the library's location as it stands, with its precision", () => {
    expect(pinFor(record({ location: { lat: 40.123, lon: -79.456, precision: "town" } }), null, false)).toEqual({ lat: 40.123, lon: -79.456, precision: "town" });
    expect(pinFor(record({ location: { lat: 40.123, lon: -79.456, precision: "trailhead" } }), null, false)).toEqual({ lat: 40.123, lon: -79.456, precision: "start" });
    expect(pinFor(record({ location: { lat: 40.123, lon: -79.456, precision: "area" } }), null, false)).toEqual({ lat: 40.123, lon: -79.456, precision: "area" });
  });

  it("keeps a record with no coordinates off the map, and never geocodes", () => {
    expect(pinFor(record(), null, false)).toBeNull();
    const broken = { location: { lat: Number.NaN, lon: -79 } } as unknown as Partial<LibraryRecord>;
    expect(pinFor(record(broken), null, false)).toBeNull();
    const pin = pinFor(record({ location: { lat: 35.5, lon: -83.9, precision: "town" } }), null, false);
    expect(pin).toEqual({ lat: 35.5, lon: -83.9, precision: "town" });
  });

  it("prefers the start of a line we serve, and uses the source's box only as an area", () => {
    expect(pinFor(record({ location: { lat: 1, lon: 2, precision: "town" } }), { start: { lat: 35, lon: -84 }, bounds }, false)).toEqual({
      lat: 35,
      lon: -84,
      precision: "start",
    });
    expect(pinFor(record({ gpx: { availability: "link-only", bounds } }), null, true)).toEqual({ lat: 40.5, lon: -79.5, precision: "area" });
  });
});
