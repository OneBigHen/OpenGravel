import { describe, expect, it, vi } from "vitest";

import { GeocoderUnavailableError, type PhotonGeocoder } from "@/infrastructure/geocoding/photon";
import {
  createTomTomGeocoder,
  createTomTomPlaceSearch,
  parseTomTomPlaces,
  placeFromTomTom,
  placeFromTomTomResult,
  TOMTOM_PLACE_RADIUS_METERS,
  TOMTOM_PLACE_TIMEOUT_MS,
  withFallback,
} from "@/infrastructure/geocoding/tomtom";

const JIM_THORPE = { lat: 40.8757, lon: -75.7324 };

const WAWA = {
  type: "POI",
  id: "wawa-jim-thorpe",
  score: 1.42,
  poi: { name: "Wawa", brands: [{ name: "Wawa" }] },
  address: {
    streetNumber: "48",
    streetName: "Broadway",
    municipality: "Jim Thorpe",
    countrySubdivision: "Pennsylvania",
    countryCode: "US",
    country: "United States",
    freeformAddress: "48 Broadway, Jim Thorpe, PA 18229",
  },
  position: { lat: 40.8765, lon: -75.7336 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  const urls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    urls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { fetcher, urls };
}

describe("TomTom place results", () => {
  it("labels a business with its town and state, and its street and distance as context", () => {
    const place = placeFromTomTomResult(WAWA, JIM_THORPE, 0);
    expect(place).toMatchObject({
      id: "tomtom:wawa-jim-thorpe",
      label: "Wawa, Jim Thorpe, PA",
      name: "Wawa",
      coordinate: { lat: 40.8765, lon: -75.7336 },
      provider: "tomtom",
    });
    expect(place?.context).toBe("48 Broadway · 0.1 mi");
  });

  it("keeps the brand only when it differs from the name", () => {
    const place = placeFromTomTomResult(
      { ...WAWA, poi: { name: "Jim Thorpe Fuel", brands: [{ name: "Sunoco" }] } },
      JIM_THORPE,
      0,
    );
    expect(place?.context).toBe("Sunoco · 48 Broadway · 0.1 mi");
  });

  it("keeps the country for places outside the US", () => {
    const place = placeFromTomTomResult(
      {
        id: "br",
        poi: { name: "Padaria" },
        address: { municipality: "São Paulo", countrySubdivision: "São Paulo", country: "Brazil", countryCode: "BR" },
        position: { lat: -23.55, lon: -46.63 },
      },
      JIM_THORPE,
      0,
    );
    expect(place?.label).toBe("Padaria, São Paulo, São Paulo, Brazil");
  });

  it("skips a result without a usable position or name", () => {
    expect(placeFromTomTomResult({ poi: { name: "Nowhere" } }, JIM_THORPE, 0)).toBeNull();
    expect(placeFromTomTomResult({ position: { lat: 91, lon: 0 } }, JIM_THORPE, 0)).toBeNull();
    expect(parseTomTomPlaces({ results: [{ poi: {}, position: { lat: 1, lon: 2 } }] }, JIM_THORPE)).toEqual([]);
  });

  it("refuses a payload without results instead of pretending it is empty", () => {
    expect(() => parseTomTomPlaces({ error: "nope" }, JIM_THORPE)).toThrow();
  });
});

describe("TomTom place search requests", () => {
  it("asks the nearby endpoint with a category id around the centre", async () => {
    const { fetcher, urls } = stubFetch(() => jsonResponse({ results: [WAWA] }));
    const search = createTomTomPlaceSearch({ apiKey: "test-key", fetcher });
    const places = await search.search({ categoryId: "7311", center: JIM_THORPE });
    expect(places.map((place) => place.name)).toEqual(["Wawa"]);
    const url = urls[0]!;
    expect(url.pathname).toBe("/search/2/nearbySearch/.json");
    expect(url.searchParams.get("categorySet")).toBe("7311");
    expect(url.searchParams.get("lat")).toBe("40.87570");
    expect(url.searchParams.get("lon")).toBe("-75.73240");
    expect(url.searchParams.get("radius")).toBe(String(TOMTOM_PLACE_RADIUS_METERS));
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("query")).toBeNull();
  });

  it("asks the fuzzy endpoint for a brand, POIs only", async () => {
    const { fetcher, urls } = stubFetch(() => jsonResponse({ results: [WAWA] }));
    const search = createTomTomPlaceSearch({ apiKey: "test-key", fetcher });
    await search.search({ query: "Wawa Jim Thorpe", center: JIM_THORPE, limit: 40 });
    const url = urls[0]!;
    expect(url.pathname).toBe(`/search/2/fuzzySearch/${encodeURIComponent("Wawa Jim Thorpe")}.json`);
    expect(url.searchParams.get("idxSet")).toBe("POI");
    expect(url.searchParams.get("typeahead")).toBe("false");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("does not ask anything for an empty request", async () => {
    const { fetcher, urls } = stubFetch(() => jsonResponse({ results: [] }));
    const search = createTomTomPlaceSearch({ apiKey: "test-key", fetcher });
    expect(await search.search({ query: "  ", center: JIM_THORPE })).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it("throws on a provider error so the caller can fall back", async () => {
    const { fetcher } = stubFetch(() => jsonResponse({ error: "rate limited" }, 429));
    const search = createTomTomPlaceSearch({ apiKey: "test-key", fetcher });
    await expect(search.search({ query: "Wawa", center: JIM_THORPE })).rejects.toThrow(/429/);
  });

  it("gives up after a short timeout instead of holding up search", async () => {
    expect(TOMTOM_PLACE_TIMEOUT_MS).toBeLessThanOrEqual(2_500);
    const fetcher = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const search = createTomTomPlaceSearch({ apiKey: "test-key", fetcher, timeoutMs: 10 });
    await expect(search.search({ query: "Wawa", center: JIM_THORPE })).rejects.toThrow(/unreachable/);
  });

  it("follows the caller's abort signal", async () => {
    const controller = new AbortController();
    const fetcher = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const search = createTomTomPlaceSearch({ apiKey: "test-key", fetcher, timeoutMs: 10_000 });
    const pending = search.search({ query: "Wawa", center: JIM_THORPE, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/unreachable/);
  });

  it("never puts the API key in a place row", async () => {
    const { fetcher } = stubFetch(() => jsonResponse({ results: [WAWA] }));
    const search = createTomTomPlaceSearch({ apiKey: "super-secret", fetcher });
    const places = await search.search({ query: "Wawa", center: JIM_THORPE });
    expect(JSON.stringify(places)).not.toContain("super-secret");
  });
});

describe("TomTom fallback geocoder", () => {
  it("labels a POI with its town and state", () => {
    expect(placeFromTomTom({
      id: "abc", type: "POI", poi: { name: "Hawk Mountain Sanctuary" },
      address: { municipality: "Albany", countrySubdivisionCode: "PA", countryCode: "US", freeformAddress: "1700 Hawk Mountain Rd, Kempton, PA 19529" },
      position: { lat: 40.6288, lon: -75.9771 },
    }, 0)).toEqual({
      id: "tomtom:abc", label: "Hawk Mountain Sanctuary, Albany, PA", name: "Hawk Mountain Sanctuary", context: "Albany, PA",
      coordinate: { lat: 40.6288, lon: -75.9771 }, provider: "tomtom",
    });
  });

  it("labels a town as town, state and drops results without a position", () => {
    expect(placeFromTomTom({ type: "Geography", address: { municipality: "Jim Thorpe", countrySubdivision: "PA", countryCode: "US" }, position: { lat: 40.87, lon: -75.73 } }, 1)?.label).toBe("Jim Thorpe, PA");
    expect(placeFromTomTom({ type: "POI", poi: { name: "Nowhere" } }, 2)).toBeNull();
  });

  it("searches near the bias and never leaks the key into results", async () => {
    const urls: URL[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      urls.push(new URL(String(input)));
      return jsonResponse({ results: [{ id: "1", type: "POI", poi: { name: "Wawa" }, address: { municipality: "Jim Thorpe", countrySubdivisionCode: "PA", countryCode: "US" }, position: { lat: 40.86, lon: -75.74 } }] });
    });
    const places = await createTomTomGeocoder({ apiKey: "secret-key", fetcher: fetcher as unknown as typeof fetch }).search("Wawa Jim Thorpe", { bias: { lat: 40.87, lon: -75.73 } });
    const url = urls[0]!;
    expect(url.pathname).toBe("/search/2/search/Wawa%20Jim%20Thorpe.json");
    expect(url.searchParams.get("lat")).toBe("40.8700");
    expect(places.map((place) => place.label)).toEqual(["Wawa, Jim Thorpe, PA"]);
    expect(JSON.stringify(places)).not.toContain("secret-key");
  });

  it("reverse geocodes to a street address", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ addresses: [{ address: { streetNameAndNumber: "30 River Street", municipality: "Jim Thorpe", countrySubdivision: "PA", countryCode: "US" } }] }));
    const place = await createTomTomGeocoder({ apiKey: "k", fetcher: fetcher as unknown as typeof fetch }).reverse({ lat: 40.8693, lon: -75.7353 });
    expect(place?.label).toBe("30 River Street, Jim Thorpe, PA");
    expect(place?.coordinate).toEqual({ lat: 40.8693, lon: -75.7353 });
  });

  it("reports an outage as unavailable", async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 500));
    await expect(createTomTomGeocoder({ apiKey: "k", fetcher: fetcher as unknown as typeof fetch }).search("x")).rejects.toBeInstanceOf(GeocoderUnavailableError);
  });
});

describe("withFallback", () => {
  const place = (provider: string) => ({ id: provider, label: provider, name: provider, context: "", coordinate: { lat: 0, lon: 0 }, provider });
  const down: PhotonGeocoder = { search: async () => { throw new GeocoderUnavailableError(503); }, reverse: async () => { throw new GeocoderUnavailableError(503); } };
  const up = (name: string, results = [place(name)]): PhotonGeocoder => ({ search: async () => results, reverse: async () => results[0] ?? null });

  it("answers from the fallback when the primary is down", async () => {
    const geocoder = withFallback(down, up("tomtom"));
    expect((await geocoder.search("x")).map((match) => match.provider)).toEqual(["tomtom"]);
    expect((await geocoder.reverse({ lat: 1, lon: 1 }))?.provider).toBe("tomtom");
  });

  it("keeps the primary's answer, even an empty one", async () => {
    expect(await withFallback(up("photon", []), up("tomtom")).search("x")).toEqual([]);
    expect((await withFallback(up("photon"), up("tomtom")).search("x"))[0]?.provider).toBe("photon");
  });

  it("does not fall back after the caller cancels", async () => {
    const controller = new AbortController();
    controller.abort();
    const fallback = up("tomtom");
    const spy = vi.spyOn(fallback, "search");
    await expect(withFallback(down, fallback).search("x", { signal: controller.signal })).rejects.toBeInstanceOf(GeocoderUnavailableError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is the primary itself without a fallback", () => {
    expect(withFallback(down, null)).toBe(down);
  });
});
