import { describe, expect, it } from "vitest";

import {
  createTomTomPlaceSearch,
  parseTomTomPlaces,
  placeFromTomTomResult,
  TOMTOM_PLACE_RADIUS_METERS,
  TOMTOM_PLACE_TIMEOUT_MS,
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
