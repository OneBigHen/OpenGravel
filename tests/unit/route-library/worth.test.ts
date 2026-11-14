import { describe, expect, it } from "vitest";

import type { RideDetail } from "@/application/route-library/types";
import { worthOf } from "@/application/route-library/worth";

const none = { value: null, quote: null, source: null } as const;

function detail(patch: Partial<RideDetail> = {}): RideDetail {
  return {
    id: "x", name: "X", kind: "road", type: "twisty", score: 5, scoreReason: "THE Alabama Dragon, about 100 curves.", states: ["AL"], summary: "", miles: 12, trailMiles: null, loop: false,
    start: { lat: 1, lon: 1 }, bounds: null, points: 100, segmentCount: 1,
    track: { availability: "hosted", year: 2008, vintage: "2008", old: true, rough: false, mismatch: false, gpxAllowed: true, sourceDownloadUrl: null },
    facts: { surface: { value: "paved", quote: "paved", source: "BMW MOAL route page" }, legal: { value: "public-roads", quote: "public-roads", source: "BMW MOAL route page" }, difficulty: none, permits: none, season: none },
    credit: { author: "Bob", sourceName: "BMW MOAL", sourceUrl: "https://example.test", creditLine: "Track by Bob via BMW MOAL" },
    alsoOn: [], partOf: [], includes: [], sourceRating: null, notes: [],
    stops: { fuel: [], camping: [], lodging: [], pois: [] }, alternates: [], sections: null,
    provenance: { basis: "b", scrapedAt: "", lastVerified: "" },
    ...patch,
  };
}

describe("worthOf", () => {
  it("names Standout and Great ride, and nothing for a lower score", () => {
    expect(worthOf(detail({ score: 5 })).quality).toBe("Standout");
    expect(worthOf(detail({ score: 4 })).quality).toBe("Great ride");
    expect(worthOf(detail({ score: 3 })).quality).toBeNull();
    expect(worthOf(detail({ score: 2 })).quality).toBeNull();
  });

  it("keeps the library's reason word for word and drops a blank one", () => {
    expect(worthOf(detail()).reason).toBe("THE Alabama Dragon, about 100 curves.");
    expect(worthOf(detail({ scoreReason: "  " })).reason).toBeNull();
    expect(worthOf(detail({ scoreReason: null })).reason).toBeNull();
  });

  it("a source's claim reads 'the source says' with its source, and unknown reads unknown", () => {
    const line = (d: RideDetail, key: string) => worthOf(d).truth.find((l) => l.key === key);
    expect(line(detail(), "surface")).toMatchObject({ text: "Paved, the source says", note: "BMW MOAL route page" });
    const unknown = detail({ facts: { ...detail().facts, surface: none } });
    expect(line(unknown, "surface")).toEqual({ key: "surface", label: "Surface", text: "Surface unknown" });
  });

  it("says how old the track is and when to check the roads", () => {
    const track = (patch: Partial<RideDetail["track"]>) => worthOf(detail({ track: { ...detail().track, ...patch } })).truth.find((l) => l.key === "track")!.text;
    expect(track({})).toBe("Track from 2008. Check roads first.");
    expect(track({ year: 2022, old: false })).toBe("Track from 2022.");
    expect(track({ year: null, old: false })).toBe("Track age unknown.");
    expect(track({ rough: true })).toMatch(/rough track/i);
    expect(track({ mismatch: true })).toMatch(/does not match/);
    expect(track({ availability: "none" })).toBe("The source has no track to follow.");
    expect(track({ availability: "link" })).toMatch(/links to it/);
  });

  it("good to know holds only the facts the source gave, in its words", () => {
    const given = detail({ facts: { ...detail().facts, season: { value: "May-Oct", quote: "May through October", source: "RiderPlanet" }, permits: none, difficulty: { value: "moderate", quote: "moderate", source: "RiderPlanet" } } });
    expect(worthOf(given).goodToKnow.map((l) => [l.key, l.text])).toEqual([["season", "May through October"], ["difficulty", "moderate"]]);
    expect(worthOf(detail()).goodToKnow).toEqual([]);
  });

  it("leaves legal off when unknown and words an off-highway area as the source's claim", () => {
    expect(worthOf(detail({ facts: { ...detail().facts, legal: none } })).truth.map((l) => l.key)).toEqual(["surface", "track"]);
    const ohv = detail({ facts: { ...detail().facts, legal: { value: "designated-ohv", quote: "designated-ohv", source: "S" } } });
    expect(worthOf(ohv).truth.find((l) => l.key === "legal")!.text).toMatch(/the source says$/);
  });

  it("lists stops only for kinds that have some", () => {
    const stops = worthOf(detail({ stops: { fuel: [{ name: "Shell", source: "s" }], camping: [], lodging: [], pois: [] } })).stops;
    expect(stops).toEqual([{ key: "fuel", label: "Fuel", names: ["Shell"] }]);
  });
});
