import { describe, expect, it, vi } from "vitest";

import { GeocoderUnavailableError, type PhotonGeocoder } from "@/infrastructure/geocoding/photon";
import { createTomTomGeocoder, placeFromTomTom, withFallback } from "@/infrastructure/geocoding/tomtom";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("TomTom place search", () => {
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
    const fetcher = vi.fn(async (_url: URL | RequestInfo) => json({ results: [{ id: "1", type: "POI", poi: { name: "Wawa" }, address: { municipality: "Jim Thorpe", countrySubdivisionCode: "PA", countryCode: "US" }, position: { lat: 40.86, lon: -75.74 } }] }));
    const places = await createTomTomGeocoder({ apiKey: "secret-key", fetcher: fetcher as unknown as typeof fetch }).search("Wawa Jim Thorpe", { bias: { lat: 40.87, lon: -75.73 } });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/search/2/search/Wawa%20Jim%20Thorpe.json");
    expect(url.searchParams.get("lat")).toBe("40.8700");
    expect(places.map((place) => place.label)).toEqual(["Wawa, Jim Thorpe, PA"]);
    expect(JSON.stringify(places)).not.toContain("secret-key");
  });

  it("reverse geocodes to a street address", async () => {
    const fetcher = vi.fn(async () => json({ addresses: [{ address: { streetNameAndNumber: "30 River Street", municipality: "Jim Thorpe", countrySubdivision: "PA", countryCode: "US" } }] }));
    const place = await createTomTomGeocoder({ apiKey: "k", fetcher: fetcher as unknown as typeof fetch }).reverse({ lat: 40.8693, lon: -75.7353 });
    expect(place?.label).toBe("30 River Street, Jim Thorpe, PA");
    expect(place?.coordinate).toEqual({ lat: 40.8693, lon: -75.7353 });
  });

  it("reports an outage as unavailable", async () => {
    const fetcher = vi.fn(async () => json({}, 500));
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
