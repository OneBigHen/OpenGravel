import { describe, expect, it, vi } from "vitest";

import {
  addDiscoveryStopCommand,
  createDiscoverCoordinator,
  dedupePlaces,
  rankPlaces,
  searchAreaFor,
  type InterestingPlace,
  type InterestingPlaceSource,
} from "@/application/discover";
import { createOsmPlacesSource } from "@/infrastructure/discover/osm-places-source";
import { classify, createWikimediaSource, shortExtract } from "@/infrastructure/discover/wikimedia-source";
import { handleDiscoverCorridor, handleDiscoverNear, clearDiscoverCache } from "@/server/discover/handler";
import type { RideId } from "@/domain/ride/ids";

const AT = "2026-09-27T14:00:00.000Z";
const RINGING_ROCKS = { lon: -75.1293, lat: 40.5634 };

function place(overrides: Partial<InterestingPlace> = {}): InterestingPlace {
  return {
    id: "osm:w1",
    name: "Ringing Rocks County Park",
    category: "quirky",
    categories: ["quirky"],
    coordinate: RINGING_ROCKS,
    description: null,
    image: null,
    wikidataId: null,
    facts: {},
    tags: [],
    confidence: 0.6,
    provenance: [{ sourceId: "osm", sourceLabel: "OpenStreetMap", recordId: "osm:w1", url: null, retrievedAt: AT }],
    ...overrides,
  };
}

const IMAGE = {
  url: "https://upload.wikimedia.org/x.jpg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
  author: "Jane Rider",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  attributionRequired: true,
};

function fixedSource(id: string, places: readonly InterestingPlace[] | "down"): InterestingPlaceSource {
  return {
    id,
    label: id,
    search: async () => (places === "down"
      ? { status: "unavailable", reason: `${id} is down.`, places: [] }
      : { status: "ok", reason: null, places }),
  };
}

describe("dedupe across OSM, Wikipedia and Wikidata", () => {
  it("collapses the same place into one, keeping OSM's position and the encyclopedia's text and licensed image", () => {
    const osm = place({ wikidataId: "Q49550396" });
    const wiki = place({
      id: "wikipedia:en:Ringing_Rocks_Park",
      name: "Ringing Rocks Park",
      coordinate: { lon: -75.1301, lat: 40.5611 },
      description: "Ringing Rocks Park is a county park with a boulder field whose rocks ring like bells when struck.",
      image: IMAGE,
      wikidataId: "Q49550396",
      confidence: 0.85,
      facts: { heritage: ["Pennsylvania Historical Marker"] },
      provenance: [{ sourceId: "wikimedia", sourceLabel: "Wikipedia", recordId: "wikipedia:en:Ringing_Rocks_Park", url: "https://en.wikipedia.org/wiki/Ringing_Rocks_Park", retrievedAt: AT }],
    });
    const [merged, ...rest] = dedupePlaces([wiki, osm], (id) => (id === "osm" ? 0 : 1));
    expect(rest).toEqual([]);
    expect(merged).toMatchObject({
      id: "wikidata:Q49550396",
      coordinate: RINGING_ROCKS,
      description: wiki.description,
      facts: { heritage: ["Pennsylvania Historical Marker"] },
    });
    // Commons attribution survives normalization and merging, intact.
    expect(merged?.image).toEqual(IMAGE);
    expect(merged?.provenance.map((entry) => entry.sourceId)).toEqual(["osm", "wikimedia"]);
  });

  it("merges a same-named place without Wikidata when close, and keeps two different places apart", () => {
    const a = place({ id: "osm:n1", name: "Knox Covered Bridge", category: "bridge", categories: ["bridge"] });
    const b = place({ id: "wikipedia:en:Knox_Covered_Bridge", name: "Knox Covered Bridge", coordinate: { lon: -75.1296, lat: 40.5636 }, provenance: [{ sourceId: "wikimedia", sourceLabel: "Wikipedia", recordId: "x", url: null, retrievedAt: AT }] });
    const c = place({ id: "osm:n2", name: "Knox Covered Bridge", coordinate: { lon: -75.3, lat: 40.7 } });
    expect(dedupePlaces([a, b, c], () => 0)).toHaveLength(2);
  });
});

describe("ranking", () => {
  it("is deterministic and prefers a complete, rare, close place", () => {
    const plain = place({ id: "osm:a", name: "Picnic Grove", category: "recreation", categories: ["recreation"], distanceMeters: 500 });
    const falls = place({ id: "osm:b", name: "Hawk Falls", category: "waterfall", categories: ["waterfall"], image: IMAGE, distanceMeters: 3_000 });
    const first = rankPlaces([plain, falls], { radiusMeters: 8_000 });
    expect(first.map((entry) => entry.id)).toEqual(["osm:b", "osm:a"]);
    expect(rankPlaces([falls, plain], { radiusMeters: 8_000 })).toEqual(first);
  });
});

describe("search areas", () => {
  it("covers a corridor with a few bounded circles, never one per point", () => {
    const line = Array.from({ length: 2_000 }, (_, index) => ({ lon: -75.5 + index * 0.0005, lat: 40.6 }));
    const area = searchAreaFor({ kind: "corridor", line, bufferMeters: 3_000 });
    expect(area.samples.length).toBeGreaterThan(1);
    expect(area.samples.length).toBeLessThanOrEqual(12);
    expect(area.samples.every((sample) => sample.radiusMeters <= 10_000)).toBe(true);
  });
});

describe("the discover coordinator", () => {
  it("an unavailable source is reported and never blocks the rest", async () => {
    const coordinator = createDiscoverCoordinator({
      sources: [fixedSource("wikimedia", "down"), fixedSource("osm", [place({ distanceMeters: undefined })])],
      now: () => AT,
    });
    const result = await coordinator.discover({ query: { kind: "near", center: RINGING_ROCKS, radiusMeters: 5_000 } }, new AbortController().signal);
    expect(result.places.map((entry) => entry.id)).toEqual(["osm:w1"]);
    expect(result.sources.find((source) => source.id === "wikimedia")).toMatchObject({ status: "unavailable" });
  });

  it("a hung source is cut off at the deadline", async () => {
    const hung: InterestingPlaceSource = { id: "slow", label: "Slow", search: () => new Promise(() => undefined) };
    const coordinator = createDiscoverCoordinator({ sources: [hung], deadlineMs: 20, now: () => AT });
    const result = await coordinator.discover({ query: { kind: "near", center: RINGING_ROCKS, radiusMeters: 5_000 } }, new AbortController().signal);
    expect(result.sources[0]).toMatchObject({ status: "unavailable" });
  });

  it("enrichment fills a bare place's image and summary, and a failing enricher changes nothing", async () => {
    const bare = place({ wikidataId: "Q49550396" });
    const enricher = { id: "wd", enrich: vi.fn(async (places: readonly InterestingPlace[]) => places.map((entry) => ({ ...entry, image: IMAGE, description: "A boulder field whose rocks ring when struck." }))) };
    const coordinator = createDiscoverCoordinator({ sources: [fixedSource("osm", [bare])], enrichers: [enricher], now: () => AT });
    const result = await coordinator.discover({ query: { kind: "near", center: RINGING_ROCKS, radiusMeters: 5_000 } }, new AbortController().signal);
    expect(result.places[0]).toMatchObject({ image: IMAGE, description: "A boulder field whose rocks ring when struck." });
    const broken = { id: "wd", enrich: async () => { throw new Error("down"); } };
    const safe = createDiscoverCoordinator({ sources: [fixedSource("osm", [bare])], enrichers: [broken], now: () => AT });
    const unchanged = await safe.discover({ query: { kind: "near", center: RINGING_ROCKS, radiusMeters: 5_000 } }, new AbortController().signal);
    expect(unchanged.places[0]).toMatchObject({ id: "osm:w1", image: null });
  });

  it("stale events expire", async () => {
    const past = place({ id: "event:1", category: "event", categories: ["event"], validUntil: "2026-09-26T00:00:00.000Z" });
    const coming = place({ id: "event:2", name: "Fall Festival", category: "event", categories: ["event"], validUntil: "2026-09-28T00:00:00.000Z" });
    const coordinator = createDiscoverCoordinator({ sources: [fixedSource("events", [past, coming])], now: () => AT });
    const result = await coordinator.discover({ query: { kind: "near", center: RINGING_ROCKS, radiusMeters: 5_000 } }, new AbortController().signal);
    expect(result.places.map((entry) => entry.id)).toEqual(["event:2"]);
  });

  it("measures distance from the route and a detour estimate on a corridor", async () => {
    const coordinator = createDiscoverCoordinator({ sources: [fixedSource("osm", [place()])], now: () => AT });
    const line = [{ lon: -75.14, lat: 40.55 }, { lon: -75.14, lat: 40.58 }];
    const result = await coordinator.discover({ query: { kind: "corridor", line, bufferMeters: 3_000 } }, new AbortController().signal);
    expect(result.places[0]?.distanceFromRouteMeters).toBeGreaterThan(500);
    expect(result.places[0]?.detourMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe("adding a discovery to a ride", () => {
  it("is an ordinary rider-authored stop.insert command and nothing else", () => {
    const command = addDiscoveryStopCommand({ rideId: "ride_1" as RideId, revision: 4 }, place({ category: "waterfall" }));
    expect(command).toMatchObject({
      type: "stop.insert",
      rideId: "ride_1",
      baseRevision: 4,
      source: "rider",
      stop: { kind: "stop", coordinate: RINGING_ROCKS, label: "Ringing Rocks County Park", arrivalIntent: "scenic", provenance: { type: "search", placeId: "osm:w1" } },
    });
    // Nothing in a discovery result can select or replace a route.
    expect(Object.keys(command)).not.toContain("route");
  });
});

describe("OSM places source", () => {
  it("answers from the built index and says so when it is not built", async () => {
    const index = { builtAt: AT, places: [{ id: "osm:n9", name: "Hawk Falls", c: ["waterfall", "nature"], at: [-75.62, 40.99] as const, wd: "Q5684981" }] };
    const source = createOsmPlacesSource({ load: async () => index });
    const answer = await source.search({ samples: [{ center: { lon: -75.62, lat: 40.99 }, radiusMeters: 1_000 }] }, new AbortController().signal);
    expect(answer.places[0]).toMatchObject({ id: "osm:n9", category: "waterfall", wikidataId: "Q5684981", provenance: [{ url: "https://www.openstreetmap.org/node/9" }] });
    const missing = createOsmPlacesSource({ load: async () => null });
    expect((await missing.search({ samples: [] }, new AbortController().signal)).status).toBe("unavailable");
  });
});

describe("Wikimedia source", () => {
  it("keeps places a rider would stop for and drops towns, schools and companies", () => {
    expect(classify(["covered bridge"], true)).toEqual(["bridge", "history"]);
    expect(classify(["waterfall"], false)).toEqual(["waterfall", "nature", "scenic"]);
    expect(classify(["borough of Pennsylvania"], false)).toBeNull();
    expect(classify(["public school"], true)).toBeNull();
    expect(classify(["house"], true)).toEqual(["architecture", "history"]);
    expect(classify(["organization"], false)).toBeNull();
  });

  it("keeps extracts to a sentence or two", () => {
    expect(shortExtract("Hawk Falls is a waterfall (22 m) on Hawk Run. It is in Hickory Run State Park. It is popular with hikers and photographers alike in every season.")).toBe(
      "Hawk Falls is a waterfall on Hawk Run. It is in Hickory Run State Park.",
    );
  });

  it("needs no secret, sends an identifying User-Agent, and turns an outage into unavailable", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["user-agent"]).toContain("OpenGravel");
      expect(headers["api-user-agent"]).toContain("OpenGravel");
      throw new Error("down");
    });
    const source = createWikimediaSource({ userAgent: "OpenGravel/0.1 (test)", fetch: fetcher as unknown as typeof fetch });
    const answer = await source.search({ samples: [{ center: RINGING_ROCKS, radiusMeters: 1_000 }] }, new AbortController().signal);
    expect(answer.status).toBe("unavailable");
    expect(String(fetcher.mock.calls[0]?.[0])).not.toMatch(/key|token|secret/i);
  });

  it("never sends a precise position to Wikipedia", async () => {
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => { throw new Error("down"); });
    const source = createWikimediaSource({ userAgent: "OpenGravel/0.1 (test)", fetch: fetcher as unknown as typeof fetch });
    await source.search({ samples: [{ center: { lon: -75.129345, lat: 40.563412 }, radiusMeters: 3_000 }] }, new AbortController().signal);
    const params = new URL(String(fetcher.mock.calls[0]?.[0])).searchParams;
    expect(params.get("ggscoord")).toBe("40.56|-75.13");
    expect(Number(params.get("ggsradius"))).toBeGreaterThanOrEqual(3_000);
  });

  it("builds a place from geosearch, Wikidata and a Commons image with its licence", async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("generator") === "geosearch") {
        return json({ query: { pages: [
          { title: "Knox Covered Bridge", fullurl: "https://en.wikipedia.org/wiki/Knox_Covered_Bridge", coordinates: [{ lat: 40.1, lon: -75.4 }], pageprops: { wikibase_item: "Q100" }, pageimage: "Knox_Bridge.jpg" },
          { title: "Phoenixville, Pennsylvania", coordinates: [{ lat: 40.13, lon: -75.51 }], pageprops: { wikibase_item: "Q200" } },
        ] } });
      }
      if (params.get("action") === "wbgetentities" && params.get("props")?.startsWith("claims") === true) {
        const claim = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
        return json({ entities: {
          Q100: { claims: { P31: [claim("Q1825472")], P1435: [claim("Q19558910")], P571: [{ mainsnak: { datavalue: { value: { time: "+1865-00-00T00:00:00Z" } } } }] } },
          Q200: { claims: { P31: [claim("Q3558970")] } },
        } });
      }
      if (params.get("action") === "wbgetentities") {
        return json({ entities: {
          Q1825472: { labels: { en: { value: "covered bridge" } } },
          Q19558910: { labels: { en: { value: "place listed on the National Register of Historic Places" } } },
          Q3558970: { labels: { en: { value: "borough of Pennsylvania" } } },
        } });
      }
      if (params.get("prop") === "extracts") return json({ query: { pages: [{ title: "Knox Covered Bridge", extract: "Knox Covered Bridge is a historic covered bridge in Valley Forge National Historical Park. It was built in 1865." }] } });
      if (params.get("prop") === "imageinfo") {
        return json({ query: { pages: [{ title: "File:Knox Bridge.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/k.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Knox_Bridge.jpg",
          extmetadata: { Artist: { value: "<a href=\"x\">Jane Rider</a>" }, LicenseShortName: { value: "CC BY-SA 3.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" }, AttributionRequired: { value: "true" } } }] }] } });
      }
      throw new Error(`unexpected ${url}`);
    });
    const source = createWikimediaSource({ userAgent: "OpenGravel/0.1 (test)", fetch: fetcher as unknown as typeof fetch });
    const answer = await source.search({ samples: [{ center: { lon: -75.45, lat: 40.1 }, radiusMeters: 10_000 }] }, new AbortController().signal);
    expect(answer.places).toHaveLength(1);
    expect(answer.places[0]).toMatchObject({
      name: "Knox Covered Bridge",
      category: "bridge",
      wikidataId: "Q100",
      facts: { builtYear: 1865 },
      image: { author: "Jane Rider", license: "CC BY-SA 3.0", attributionRequired: true, pageUrl: "https://commons.wikimedia.org/wiki/File:Knox_Bridge.jpg" },
    });
  });
});

describe("/api/discover", () => {
  it("validates input and answers 200 with per-source status", async () => {
    clearDiscoverCache();
    const coordinator = createDiscoverCoordinator({ sources: [fixedSource("osm", [place()])], now: () => AT });
    expect((await handleDiscoverNear(new URL("https://x/api/discover?lat=95&lon=0"), { coordinator }, new AbortController().signal)).status).toBe(400);
    expect((await handleDiscoverNear(new URL("https://x/api/discover?lat=40.56&lon=-75.13&categories=bogus"), { coordinator }, new AbortController().signal)).status).toBe(400);
    const ok = await handleDiscoverNear(new URL("https://x/api/discover?lat=40.56&lon=-75.13&radius=5000"), { coordinator }, new AbortController().signal);
    expect(ok.status).toBe(200);
    expect(await handleDiscoverCorridor({ line: [[0, 0]] }, { coordinator }, new AbortController().signal)).toMatchObject({ status: 400 });
  });
});
