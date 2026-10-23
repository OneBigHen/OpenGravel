import { describe, expect, it, vi } from "vitest";

import { locateOnce } from "@/application/geocoding/locate-once";
import { createPlaceNameCache, placeNameKey } from "@/application/geocoding/place-names";
import {
  createHttpPlaceSearch,
  dedupePlaces,
  normalizedPlaceName,
  PLACE_NAME_DUPLICATE_RADIUS_METERS,
  PLACE_SEARCH_UNAVAILABLE,
  type PlaceMatch,
  type PlaceSearchPort,
} from "@/application/geocoding/place-search";
import type { PositionSource } from "@/application/ride-session/position-pipeline";

const JIM_THORPE: PlaceMatch = {
  id: "fixture:jim-thorpe",
  label: "Jim Thorpe, PA",
  name: "Jim Thorpe",
  context: "Carbon County, PA",
  coordinate: { lat: 40.8757, lon: -75.7324 },
  provider: "fixture",
};

const HAWK_MOUNTAIN: PlaceMatch = {
  id: "photon:hawk-mountain",
  label: "Hawk Mountain Sanctuary, Albany, PA",
  name: "Hawk Mountain Sanctuary",
  context: "Albany Township, Berks County, PA",
  coordinate: { lat: 40.6288, lon: -75.9772 },
  provider: "photon",
};

function port(reverse: PlaceSearchPort["reverse"]): PlaceSearchPort {
  return { search: async () => ({ status: "ok", places: [] }), reverse };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("place-name cache", () => {
  it("resolves once per coordinate and notifies subscribers", async () => {
    const reverse = vi.fn(async () => JIM_THORPE);
    const cache = createPlaceNameCache({ port: port(reverse) });
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.request({ lat: 40.87571, lon: -75.73241 });
    cache.request({ lat: 40.87572, lon: -75.73242 }); // same four-decimal key, pending
    await flush();
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(cache.nameFor({ lat: 40.8757, lon: -75.7324 })).toBe("Jim Thorpe, PA");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.version()).toBe(1);
  });

  it("leaves a failed coordinate alone until the retry window passes", async () => {
    let time = 0;
    const reverse = vi.fn(async () => null);
    const cache = createPlaceNameCache({ port: port(reverse), now: () => time, retryAfterMs: 1_000 });
    cache.request({ lat: 40, lon: -75 });
    await flush();
    cache.request({ lat: 40, lon: -75 });
    expect(reverse).toHaveBeenCalledTimes(1);
    time = 1_001;
    cache.request({ lat: 40, lon: -75 });
    expect(reverse).toHaveBeenCalledTimes(2);
    expect(cache.nameFor({ lat: 40, lon: -75 })).toBeUndefined();
  });

  it("persists names and survives a corrupt store", async () => {
    const saved: Record<string, string>[] = [];
    const cache = createPlaceNameCache({
      port: port(async () => JIM_THORPE),
      storage: { load: () => ({ [placeNameKey({ lat: 1, lon: 2 })]: "Somewhere, PA" }), save: (entries) => saved.push({ ...entries }) },
    });
    expect(cache.nameFor({ lat: 1, lon: 2 })).toBe("Somewhere, PA");
    cache.request({ lat: 40.8757, lon: -75.7324 });
    await flush();
    expect(saved.at(-1)).toEqual({ "1.0000,2.0000": "Somewhere, PA", "40.8757,-75.7324": "Jim Thorpe, PA" });

    const broken = createPlaceNameCache({
      port: port(async () => null),
      storage: {
        load: () => {
          throw new Error("corrupt");
        },
        save: () => undefined,
      },
    });
    expect(broken.nameFor({ lat: 1, lon: 2 })).toBeUndefined();
  });

  it("stays bounded, dropping the oldest name", async () => {
    let n = 0;
    const cache = createPlaceNameCache({
      port: port(async () => ({ ...JIM_THORPE, label: `Place ${n++}` })),
      maxEntries: 2,
    });
    for (const lat of [1, 2, 3]) {
      cache.request({ lat, lon: 0 });
      await flush();
    }
    expect(cache.nameFor({ lat: 1, lon: 0 })).toBeUndefined();
    expect(cache.nameFor({ lat: 3, lon: 0 })).toBe("Place 2");
  });
});

describe("HTTP place search client", () => {
  it("sends the query and bias and keeps only well-formed places", async () => {
    const fetcher = vi.fn(async () => Response.json({ places: [JIM_THORPE, { label: "bogus" }] }));
    const client = createHttpPlaceSearch({ fetcher });
    const outcome = await client.search(" Jim Thorpe ", { bias: { lat: 40.6, lon: -75.5 } });
    expect(outcome).toEqual({ status: "ok", places: [JIM_THORPE] });
    expect((fetcher.mock.calls[0] as unknown[])[0]).toBe("/api/geocode?q=Jim+Thorpe&lat=40.6000&lon=-75.5000");
  });

  it("says unavailable on an error status or a network failure", async () => {
    for (const fetcher of [
      vi.fn(async () => new Response("", { status: 503 })),
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    ]) {
      const outcome = await createHttpPlaceSearch({ fetcher }).search("Easton");
      expect(outcome).toEqual({ status: "unavailable", reason: PLACE_SEARCH_UNAVAILABLE });
    }
  });

  it("keeps one answer for a place the geocoder repeated", async () => {
    const repeated = [
      HAWK_MOUNTAIN,
      { ...HAWK_MOUNTAIN, id: "photon:hawk-2", context: "Albany, PA" },
      // The same name with punctuation/case noise and a few metres of drift.
      { ...HAWK_MOUNTAIN, id: "photon:hawk-3", name: "hawk mountain sanctuary!", coordinate: { lat: 40.62885, lon: -75.97725 } },
      // A namesake well outside the radius is a different place.
      { ...HAWK_MOUNTAIN, id: "photon:hawk-brewery", coordinate: { lat: 40.6557, lon: -75.4942 } },
    ];
    const outcome = await createHttpPlaceSearch({ fetcher: vi.fn(async () => Response.json({ places: repeated })) }).search("hawk mountain");
    expect(outcome).toEqual({
      status: "ok",
      places: [HAWK_MOUNTAIN, repeated[3]],
    });
  });

  it("normalizes names before treating them as the same place", () => {
    expect(normalizedPlaceName("  Hawk Mountain Sanctuary, PA ")).toBe("hawk mountain sanctuary pa");
    expect(normalizedPlaceName("Hawk  Mountain Sanctuary, PA")).toBe("hawk mountain sanctuary pa");
    expect(PLACE_NAME_DUPLICATE_RADIUS_METERS).toBe(400);

    // Same name, different part of the state: both stay.
    const far: PlaceMatch = { ...HAWK_MOUNTAIN, id: "photon:far", coordinate: { lat: 41.2, lon: -75.9772 } };
    expect(dedupePlaces([HAWK_MOUNTAIN, far]).map((place) => place.id)).toEqual([
      HAWK_MOUNTAIN.id,
      far.id,
    ]);
    // An unnamed answer is never folded into another.
    const unnamed: PlaceMatch = { ...HAWK_MOUNTAIN, id: "photon:unnamed", name: "" };
    expect(dedupePlaces([unnamed, { ...unnamed, id: "photon:unnamed-2" }])).toHaveLength(2);
  });

  it("does not ask for queries shorter than two characters", async () => {
    const fetcher = vi.fn();
    expect(await createHttpPlaceSearch({ fetcher }).search("E")).toEqual({ status: "ok", places: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reverse returns null on any failure", async () => {
    const client = createHttpPlaceSearch({ fetcher: vi.fn(async () => new Response("", { status: 503 })) });
    expect(await client.reverse({ lat: 40, lon: -75 })).toBeNull();
    const ok = createHttpPlaceSearch({ fetcher: vi.fn(async () => Response.json({ place: JIM_THORPE })) });
    expect(await ok.reverse({ lat: 40, lon: -75 })).toEqual(JIM_THORPE);
  });
});

describe("locateOnce", () => {
  function source(behave: (observer: Parameters<PositionSource["watch"]>[0]) => void): PositionSource & { stopped: number } {
    const result = {
      stopped: 0,
      permission: async () => "granted" as const,
      watch(observer: Parameters<PositionSource["watch"]>[0]) {
        setTimeout(() => behave(observer), 0);
        return { stop: () => (result.stopped += 1) };
      },
    };
    return result;
  }

  it("takes the first fix and stops watching", async () => {
    const position = source((observer) =>
      observer.position({ coordinate: { lat: 40.6, lon: -75.4 }, observedAt: "2026-09-23T00:00:00Z", accuracyMeters: 12, headingDegrees: null, speedMps: null }),
    );
    await expect(locateOnce(position)).resolves.toEqual({
      status: "located",
      coordinate: { lat: 40.6, lon: -75.4 },
      accuracyMeters: 12,
      observedAt: "2026-09-23T00:00:00Z",
    });
    expect(position.stopped).toBe(1);
  });

  it("reports denial, and a timeout when nothing arrives", async () => {
    await expect(locateOnce(source((observer) => observer.error({ code: "permission-denied" })))).resolves.toEqual({
      status: "failed",
      code: "permission-denied",
    });
    await expect(locateOnce(source(() => undefined), { timeoutMs: 5 })).resolves.toEqual({ status: "failed", code: "timeout" });
  });

  it("reports an unsupported browser", async () => {
    const broken: PositionSource = {
      permission: async () => "prompt",
      watch: () => {
        throw new Error("Geolocation is unavailable.");
      },
    };
    await expect(locateOnce(broken)).resolves.toEqual({ status: "failed", code: "unsupported" });
  });
});
