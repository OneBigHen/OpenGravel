import { describe, expect, it } from "vitest";

import { isOldTrack, isTripName, kindFor, lengthMismatch, statedMiles, trackYear, typeFor, typeForLane } from "@/application/route-library/classify";
import type { LibraryRecord } from "@/application/route-library/types";

function record(over: Partial<Omit<LibraryRecord, "gpx">> & { gpx?: Partial<LibraryRecord["gpx"]> } = {}): LibraryRecord {
  const { gpx, ...rest } = over;
  return {
    id: "tn-test",
    name: "Test road",
    states: ["TN"],
    lane: "paved-twisty",
    source: { name: "Site", url: "https://example.com/a" },
    author_credit: { author: "Sam" },
    value_score: 4,
    scraped_at: "2026-11-13T00:00:00Z",
    last_verified: "2026-11-13T00:00:00Z",
    gpx: { availability: "hosted", local_file: "x.gpx", ...gpx },
    ...rest,
  } as LibraryRecord;
}

describe("lane to type", () => {
  it.each([
    ["paved-twisty", "twisty"],
    ["scenic", "scenic"],
    ["dual-sport", "dirt"],
    ["adv", "dirt"],
    ["gravel", "dirt"],
    ["mixed", "dirt"],
    ["bdr", "dirt"],
    ["bdr-x", "dirt"],
    ["single-track", "trail"],
  ])("%s is %s", (lane, type) => {
    expect(typeForLane(lane)).toBe(type);
  });

  it("puts a riding area under Trails whatever its lane", () => {
    expect(typeFor(record({ lane: "scenic" }), "area")).toBe("trail");
    expect(typeFor(record({ lane: "scenic" }), "road")).toBe("scenic");
  });
});

describe("kind", () => {
  it("is area for a bundle, or for an OHV area with no track", () => {
    expect(kindFor(record({ gpx: { is_bundle: true } }), 10)).toBe("area");
    expect(kindFor(record({ surface: { legal_status: "designated-ohv" }, gpx: { availability: "none" } }), null)).toBe("area");
    expect(kindFor(record({ surface: { legal_status: "designated-ohv" } }), 12)).toBe("road");
  });

  it("is trip for BDR lanes, 250 miles or more, or a named big trip", () => {
    expect(kindFor(record({ lane: "bdr", gpx: { availability: "link-only" } }), null)).toBe("trip");
    expect(kindFor(record({ lane: "bdr-x" }), 40)).toBe("trip");
    expect(kindFor(record(), 250)).toBe("trip");
    expect(kindFor(record(), 249.9)).toBe("road");
    expect(kindFor(record({ name: "TAT - Tennessee section" }), 90)).toBe("trip");
    expect(kindFor(record({ name: "Continental Divide Trail ride" }), 90)).toBe("trip");
    expect(kindFor(record({ name: "Staten Island loop" }), 20)).toBe("road");
  });

  it("recognises big-trip names without catching ordinary words", () => {
    expect(isTripName("Trans-America Trail, Ohio")).toBe(true);
    expect(isTripName("Tattered Flag Road")).toBe(false);
  });
});

describe("track age", () => {
  it("reads the newest year in a vintage, then the credit line", () => {
    expect(trackYear(record({ gpx: { track_vintage: "2010-2012" } }))).toBe(2012);
    expect(trackYear(record({ gpx: { track_vintage: "v15d (2024-06-22)" } }))).toBe(2024);
    expect(trackYear(record({ author_credit: { author: "x", credit_line: "Track by x (May 31, 2006)" } }))).toBe(2006);
    expect(trackYear(record())).toBeNull();
  });

  it("calls 2015 and earlier old, and an unknown year not old", () => {
    expect(isOldTrack(2015)).toBe(true);
    expect(isOldTrack(2016)).toBe(false);
    expect(isOldTrack(null)).toBe(false);
  });
});

describe("length mismatch", () => {
  it("flags a measured length more than 40 percent off the stated one", () => {
    expect(lengthMismatch(30, 100 * 0.621371)).toBe(true);
    expect(lengthMismatch(50, 100 * 0.621371)).toBe(false);
    expect(lengthMismatch(null, 10)).toBe(false);
    expect(lengthMismatch(10, null)).toBe(false);
  });

  it("reads the stated length from the record or the summary", () => {
    expect(statedMiles(record({ claimed_distance_km: 100 }))).toBeCloseTo(62.1, 1);
    expect(statedMiles(record({ summary: "19 km run - something" }))).toBeCloseTo(11.8, 1);
    expect(statedMiles(record({ summary: "A nice road" }))).toBeNull();
  });
});
