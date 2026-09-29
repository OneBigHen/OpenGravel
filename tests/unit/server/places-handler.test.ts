import { afterEach, describe, expect, it } from "vitest";

import { asPlaceId, type PlacesResult, type PlacesSource } from "@/application/places";
import {
  clearPlacesCache,
  defaultPlacesSource,
  handlePlacesAlongRequest,
  handlePlacesExtentRequest,
} from "@/server/places/handler";

const available: PlacesResult = {
  availability: "available",
  places: [
    {
      id: asPlaceId("hh:a"), kind: "happy_hour", name: "A", coordinate: { lon: -75.3, lat: 40.1 },
      category: "Bar", label: "Til 7 PM", status: "now", city: "", address: "", specials: [], schedule: null,
      rating: null, popular: false, dogFriendly: null, patio: null, url: "https://x.test/a", mapsUrl: null,
      offRouteMiles: null, routeMile: null,
    },
  ],
  fetchedAt: "2026-09-24T20:00:00Z",
  attribution: "test",
};

function counting(result: PlacesResult = available): PlacesSource & { calls: number } {
  const source = {
    id: "stub",
    calls: 0,
    inExtent: async () => {
      source.calls += 1;
      return result;
    },
    alongRoute: async () => {
      source.calls += 1;
      return result;
    },
  };
  return source;
}

const url = (q: string) => new URL(`https://ogv.test/api/places?${q}`);

afterEach(() => clearPlacesCache());

describe("places handler", () => {
  it("validates the viewport before any provider work", async () => {
    const source = counting();
    for (const q of ["", "bbox=1,2,3", "bbox=-75,40,-76,41", "bbox=-78,38,-74,41", "bbox=-75.4,40,-75.2,40.2&kinds=casino", "bbox=-75.4,40,-75.2,40.2&when=later"]) {
      expect((await handlePlacesExtentRequest(url(q), { source })).status).toBe(400);
    }
    expect(source.calls).toBe(0);
  });

  it("answers and caches a viewport for a minute", async () => {
    const source = counting();
    let now = 0;
    const deps = { source, now: () => now };
    const first = await handlePlacesExtentRequest(url("bbox=-75.4,40,-75.2,40.2"), deps);
    await handlePlacesExtentRequest(url("bbox=-75.4,40,-75.2,40.2"), deps);
    expect(first.status).toBe(200);
    expect(source.calls).toBe(1);
    now = 61_000;
    await handlePlacesExtentRequest(url("bbox=-75.4,40,-75.2,40.2"), deps);
    expect(source.calls).toBe(2);
  });

  it("is honest when no provider is configured", async () => {
    const result = await handlePlacesExtentRequest(url("bbox=-75.4,40,-75.2,40.2"), { source: null });
    expect(result).toMatchObject({ status: 200, body: { availability: "unavailable", retryable: false } });
    expect(await defaultPlacesSource({})).toBeNull();
  });

  it("does not cache an unavailable answer", async () => {
    const source = counting({ availability: "unavailable", places: [], reason: "x", retryable: true });
    await handlePlacesExtentRequest(url("bbox=-75.4,40,-75.2,40.2"), { source });
    await handlePlacesExtentRequest(url("bbox=-75.4,40,-75.2,40.2"), { source });
    expect(source.calls).toBe(2);
  });

  it("validates along-route bodies", async () => {
    const source = counting();
    expect((await handlePlacesAlongRequest({ line: [{ lon: 0, lat: 0 }] }, { source })).status).toBe(400);
    expect((await handlePlacesAlongRequest({ line: [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }], bufferMiles: 50 }, { source })).status).toBe(400);
    const ok = await handlePlacesAlongRequest({ line: [{ lon: -75.35, lat: 40.1 }, { lon: -75.25, lat: 40.1 }] }, { source });
    expect(ok.status).toBe(200);
    expect(source.calls).toBe(1);
  });

  it("serves the fixture in fixture mode, filtered to the viewport", async () => {
    const source = await defaultPlacesSource({ OGV_PLACES_FIXTURE: "1" });
    expect(source?.id).toBe("fixture");
    const inside = await handlePlacesExtentRequest(url("bbox=-75.45,39.95,-75.15,40.25"), { source });
    const outside = await handlePlacesExtentRequest(url("bbox=-80,30,-79,31"), { source });
    expect(inside.status).toBe(200);
    if ("places" in inside.body) expect(inside.body.places.length).toBeGreaterThan(0);
    if ("places" in outside.body) expect(outside.body.places).toEqual([]);
  });
});
