import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import {
  clearReverseGeocodeCache,
  clearSearchGeocodeCache,
  handleGeocodeReverse,
  handleGeocodeSearch,
  type GeocodeDependencies,
} from "@/server/geocoding/handler";
import { createRateLimiter } from "@/server/rate-limit";

const PLACE: PlaceMatch = {
  id: "photon:R1",
  label: "Jim Thorpe, PA",
  name: "Jim Thorpe",
  context: "Carbon County, PA",
  coordinate: { lat: 40.8757, lon: -75.7324 },
  provider: "photon",
};

function deps(overrides: Partial<GeocodeDependencies> = {}): GeocodeDependencies {
  return {
    search: vi.fn(async () => [PLACE]),
    reverse: vi.fn(async () => PLACE),
    limiter: createRateLimiter({ windowMs: 60_000, max: 100 }),
    env: {},
    ...overrides,
  };
}

beforeEach(() => clearReverseGeocodeCache());

describe("GET /api/geocode", () => {
  it("answers places for a query and passes the bias through", async () => {
    const dependencies = deps();
    const response = await handleGeocodeSearch(
      new Request("http://x/api/geocode?q=Jim%20Thorpe&lat=40.6&lon=-75.5"),
      dependencies,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ places: [PLACE] });
    expect(dependencies.search).toHaveBeenCalledWith("Jim Thorpe", { lat: 40.6, lon: -75.5 }, expect.anything());
  });

  it("uses the deployment's default bias when the client sends none", async () => {
    const dependencies = deps({ defaultBias: { lat: 40.62, lon: -75.47 } });
    await handleGeocodeSearch(new Request("http://x/api/geocode?q=Easton"), dependencies);
    expect(dependencies.search).toHaveBeenCalledWith("Easton", { lat: 40.62, lon: -75.47 }, expect.anything());
  });

  it("answers an empty list for a too-short query without asking upstream", async () => {
    const dependencies = deps();
    const response = await handleGeocodeSearch(new Request("http://x/api/geocode?q=J"), dependencies);
    expect(await response.json()).toEqual({ places: [] });
    expect(dependencies.search).not.toHaveBeenCalled();
  });

  it("rejects an overlong query and an invalid bias", async () => {
    const long = await handleGeocodeSearch(new Request(`http://x/api/geocode?q=${"a".repeat(121)}`), deps());
    expect(long.status).toBe(400);
    const bias = await handleGeocodeSearch(new Request("http://x/api/geocode?q=Easton&lat=91&lon=0"), deps());
    expect(bias.status).toBe(400);
  });

  it("hides upstream failures behind one fixed 503", async () => {
    const response = await handleGeocodeSearch(
      new Request("http://x/api/geocode?q=Easton"),
      deps({
        search: async () => {
          throw new Error("photon said something secret");
        },
      }),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("rate-limits per client with a Retry-After", async () => {
    const dependencies = deps({ limiter: createRateLimiter({ windowMs: 60_000, max: 1 }) });
    // Distinct queries: a repeated one is served from the cache and never reaches the limiter.
    const request = (q: string) =>
      new Request(`http://x/api/geocode?q=${q}`, { headers: { "x-real-ip": "10.0.0.1" } });
    expect((await handleGeocodeSearch(request("Easton"), dependencies)).status).toBe(200);
    const limited = await handleGeocodeSearch(request("Bethlehem"), dependencies);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("answers from the fixture geocoder when the gate enables it", async () => {
    const dependencies = deps({ env: { OGV_GEOCODE_FIXTURE: "1" } });
    const response = await handleGeocodeSearch(new Request("http://x/api/geocode?q=hawk%20mou"), dependencies);
    const body = (await response.json()) as { places: PlaceMatch[] };
    expect(body.places.map((place) => place.label)).toEqual([
      "Hawk Mountain Sanctuary, PA",
      "Hawk Mountain Brewery, PA",
    ]);
    expect(dependencies.search).not.toHaveBeenCalled();
    const outage = await handleGeocodeSearch(new Request("http://x/api/geocode?q=outage"), dependencies);
    expect(outage.status).toBe(503);
  });
});

describe("GET /api/geocode/reverse", () => {
  it("names a coordinate and caches it at four decimals", async () => {
    const dependencies = deps();
    const first = await handleGeocodeReverse(new Request("http://x/r?lat=40.87571&lon=-75.73241"), dependencies);
    expect(await first.json()).toEqual({ place: PLACE });
    await handleGeocodeReverse(new Request("http://x/r?lat=40.87572&lon=-75.73242"), dependencies);
    expect(dependencies.reverse).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing or invalid coordinate", async () => {
    expect((await handleGeocodeReverse(new Request("http://x/r"), deps())).status).toBe(400);
    expect((await handleGeocodeReverse(new Request("http://x/r?lat=a&lon=1"), deps())).status).toBe(400);
  });

  it("returns 503 when upstream fails and does not cache the failure", async () => {
    const reverse = vi.fn(async () => {
      throw new Error("down");
    });
    const dependencies = deps({ reverse });
    expect((await handleGeocodeReverse(new Request("http://x/r?lat=40&lon=-75"), dependencies)).status).toBe(503);
    expect((await handleGeocodeReverse(new Request("http://x/r?lat=40&lon=-75"), dependencies)).status).toBe(503);
    expect(reverse).toHaveBeenCalledTimes(2);
  });

  it("names only points near a fixture place in fixture mode", async () => {
    const dependencies = deps({ env: { OGV_GEOCODE_FIXTURE: "1" } });
    const near = await handleGeocodeReverse(new Request("http://x/r?lat=40.876&lon=-75.733"), dependencies);
    expect(((await near.json()) as { place: PlaceMatch }).place.label).toBe("Jim Thorpe, PA");
    const far = await handleGeocodeReverse(new Request("http://x/r?lat=40.2&lon=-75.0"), dependencies);
    expect(await far.json()).toEqual({ place: null });
  });
});

describe("search cache", () => {
  it("serves a repeated search without another upstream call or a rate-limit hit", async () => {
    clearSearchGeocodeCache();
    const search = vi.fn(async () => []);
    const limiter = { check: vi.fn(() => null) };
    const dependencies = { search, reverse: vi.fn(), limiter };
    const get = () => new Request("https://ogv.test/api/geocode?q=Hawk%20Mountain&lat=40.62&lon=-75.47");
    await handleGeocodeSearch(get(), dependencies);
    await handleGeocodeSearch(get(), dependencies);
    expect(search).toHaveBeenCalledTimes(1);
    expect(limiter.check).toHaveBeenCalledTimes(1);
  });
});
