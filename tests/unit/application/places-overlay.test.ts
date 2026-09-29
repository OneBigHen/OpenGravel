import { describe, expect, it } from "vitest";

import {
  asPlaceId,
  createPlacesOverlay,
  DEFAULT_PLACE_QUERY,
  snapExtent,
  type PlaceExtent,
  type PlacesResult,
  type PlacesSource,
} from "@/application/places";

function harness(answer: (extent: PlaceExtent) => PlacesResult | Promise<PlacesResult>) {
  const timers: (() => void)[] = [];
  const calls: PlaceExtent[] = [];
  let clock = 0;
  const source: PlacesSource = {
    id: "stub",
    inExtent: async (extent) => {
      calls.push(extent);
      return answer(extent);
    },
    alongRoute: async () => ({ availability: "available", places: [], fetchedAt: "", attribution: "" }),
  };
  const overlay = createPlacesOverlay(DEFAULT_PLACE_QUERY, {
    source,
    now: () => clock,
    setTimer: (cb) => timers.push(cb),
    clearTimer: () => timers.splice(0, timers.length),
  });
  const flush = async () => {
    const pending = timers.splice(0, timers.length);
    pending.forEach((cb) => cb());
    await new Promise((r) => setTimeout(r, 0));
  };
  return { overlay, calls, flush, tick: (ms: number) => (clock += ms) };
}

const ok: PlacesResult = {
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

const VIEW = { west: -75.41, south: 40.02, east: -75.22, north: 40.18 };

describe("places overlay", () => {
  it("snaps viewports outward to a 0.05° grid", () => {
    expect(snapExtent(VIEW)).toEqual({ west: -75.45, south: 40, east: -75.2, north: 40.2 });
  });

  it("debounces a pan into one request and reuses the cache for a small pan", async () => {
    const h = harness(() => ok);
    h.overlay.viewportChanged(VIEW);
    h.overlay.viewportChanged({ ...VIEW, west: -75.405 });
    await h.flush();
    expect(h.calls).toHaveLength(1);
    expect(h.overlay.getState()).toMatchObject({ status: "ready", attribution: "test" });
    h.overlay.viewportChanged({ ...VIEW, east: -75.21 }); // same cells
    await h.flush();
    expect(h.calls).toHaveLength(1);
    h.tick(61_000); // cache expired
    h.overlay.viewportChanged(VIEW);
    await h.flush();
    expect(h.calls).toHaveLength(2);
  });

  it("asks the rider to zoom in instead of requesting a huge area", async () => {
    const h = harness(() => ok);
    h.overlay.viewportChanged({ west: -77, south: 39, east: -74, north: 41 });
    await h.flush();
    expect(h.calls).toHaveLength(0);
    expect(h.overlay.getState().status).toBe("zoom-in");
  });

  it("reports unavailable honestly and does not cache it", async () => {
    const h = harness(() => ({ availability: "unavailable", places: [], reason: "down", retryable: true }));
    h.overlay.viewportChanged(VIEW);
    await h.flush();
    expect(h.overlay.getState()).toMatchObject({ status: "unavailable", reason: "down", places: [] });
    h.overlay.viewportChanged(VIEW);
    await h.flush();
    expect(h.calls).toHaveLength(2);
  });

  it("drops a late answer for a viewport the rider already left", async () => {
    let release: (r: PlacesResult) => void = () => {};
    let first = true;
    const h = harness(() => {
      if (!first) return ok;
      first = false;
      return new Promise<PlacesResult>((resolve) => (release = resolve));
    });
    h.overlay.viewportChanged(VIEW);
    await h.flush();
    h.overlay.viewportChanged({ west: -75.0, south: 39.9, east: -74.9, north: 40.0 });
    await h.flush();
    release({ ...ok, attribution: "stale" });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.overlay.getState().attribution).toBe("test");
  });
});
