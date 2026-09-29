import { describe, expect, it, vi } from "vitest";

import {
  createPhotonGeocoder,
  GeocoderUnavailableError,
  namedUsState,
  placeFromReverseFeature,
  placeFromSearchFeature,
} from "@/infrastructure/geocoding/photon";

function feature(properties: Record<string, unknown>, lon: number, lat: number) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties };
}

const JIM_THORPE = feature(
  { osm_type: "R", osm_id: 1, osm_key: "place", osm_value: "town", name: "Jim Thorpe", county: "Carbon", state: "Pennsylvania", country: "United States", countrycode: "US" },
  -75.7324,
  40.8757,
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Photon search features", () => {
  it("labels a US town with its state abbreviation", () => {
    const place = placeFromSearchFeature(JIM_THORPE, 0);
    expect(place).toMatchObject({
      id: "photon:R1",
      label: "Jim Thorpe, PA",
      name: "Jim Thorpe",
      context: "Carbon County, PA",
      coordinate: { lat: 40.8757, lon: -75.7324 },
      provider: "photon",
    });
  });

  it("labels an address with its street and town", () => {
    const place = placeFromSearchFeature(
      feature({ osm_key: "building", housenumber: "5815", street: "Park Valley Road", city: "Schnecksville", state: "Pennsylvania", countrycode: "US" }, -75.6, 40.7),
      0,
    );
    expect(place?.label).toBe("5815 Park Valley Road, Schnecksville, PA");
  });

  it("keeps a named place's label short and moves its street to the context", () => {
    const place = placeFromSearchFeature(
      feature({ osm_key: "craft", name: "Hawk Mountain Brewery", housenumber: "3530", street: "Lehigh Street", city: "Whitehall", county: "Lehigh", state: "Pennsylvania", countrycode: "US" }, -75.49, 40.66),
      0,
    );
    expect(place?.label).toBe("Hawk Mountain Brewery, Whitehall, PA");
    expect(place?.context).toBe("3530 Lehigh Street, Whitehall, Lehigh County, PA");
  });

  it("keeps the country for places outside the US", () => {
    const place = placeFromSearchFeature(
      feature({ name: "Lebanon", state: "Beirut", country: "Lebanon", countrycode: "LB" }, 35.5, 33.9),
      0,
    );
    expect(place?.label).toBe("Lebanon, Beirut, Lebanon");
  });

  it("drops features without a usable point", () => {
    expect(placeFromSearchFeature({ geometry: null, properties: { name: "x" } }, 0)).toBeNull();
    expect(placeFromSearchFeature(feature({ name: "x" }, 999, 40), 0)).toBeNull();
  });
});

describe("Photon reverse features", () => {
  it("names a pin on a street by its town, not the street", () => {
    const place = placeFromReverseFeature(
      feature({ osm_key: "highway", name: "West 6th Street", city: "Jim Thorpe", state: "Pennsylvania", countrycode: "US" }, -75.7327, 40.8759),
      { lat: 40.8757, lon: -75.7324 },
    );
    expect(place?.label).toBe("Jim Thorpe, PA");
    // The name describes the rider's coordinate, not the feature's.
    expect(place?.coordinate).toEqual({ lat: 40.8757, lon: -75.7324 });
  });

  it("names a pin that sits on a named place by that place", () => {
    const place = placeFromReverseFeature(
      feature({ osm_key: "leisure", name: "Hawk Mountain Sanctuary", city: "Kempton", state: "Pennsylvania", countrycode: "US" }, -75.9913, 40.6348),
      { lat: 40.6349, lon: -75.9913 },
    );
    expect(place?.label).toBe("Hawk Mountain Sanctuary, Kempton, PA");
  });

  it("says Near when the nearest named thing is far away", () => {
    const place = placeFromReverseFeature(
      feature({ osm_key: "highway", name: "Route 895", county: "Schuylkill", state: "Pennsylvania", countrycode: "US" }, -76.0, 40.7),
      { lat: 40.73, lon: -76.0 },
    );
    expect(place?.label).toBe("Near Schuylkill County, PA");
  });

  it("returns null when there is no town to name", () => {
    expect(
      placeFromReverseFeature(feature({ osm_key: "natural", state: "Pennsylvania", countrycode: "US" }, -76, 40.7), { lat: 40.7, lon: -76 }),
    ).toBeNull();
  });
});

describe("createPhotonGeocoder", () => {
  it("asks Photon in English with the bias and ranks US places first", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        features: [
          feature({ osm_id: 9, name: "Lebanon", state: "Beirut", country: "Lebanon", countrycode: "LB" }, 35.5, 33.9),
          feature({ osm_id: 10, name: "Lebanon", county: "Lebanon", state: "Pennsylvania", countrycode: "US" }, -76.41, 40.34),
        ],
      }),
    );
    const geocoder = createPhotonGeocoder({ baseUrl: "https://photon.test/api/", fetcher });
    const places = await geocoder.search("Lebanon", { bias: { lat: 40.6, lon: -75.5 } });
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("q")).toBe("Lebanon");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("lat")).toBe("40.6000");
    expect(places.map((place) => place.label)).toEqual(["Lebanon, PA", "Lebanon, Beirut, Lebanon"]);
  });

  it("reverse-geocodes on the sibling /reverse endpoint", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ features: [JIM_THORPE] }));
    const geocoder = createPhotonGeocoder({ baseUrl: "https://photon.test/api/", fetcher });
    const place = await geocoder.reverse({ lat: 40.8757, lon: -75.7324 });
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/photon\.test\/reverse\?/);
    expect(place?.label).toBe("Jim Thorpe, PA");
  });

  it("turns network, HTTP and parse failures into one unavailable error", async () => {
    const failing = [
      vi.fn(async () => {
        throw new TypeError("network");
      }),
      vi.fn(async () => jsonResponse({}, 500)),
      vi.fn(async () => new Response("not json")),
    ];
    for (const fetcher of failing) {
      const geocoder = createPhotonGeocoder({ baseUrl: "https://photon.test/api/", fetcher });
      await expect(geocoder.search("Jim Thorpe")).rejects.toBeInstanceOf(GeocoderUnavailableError);
    }
  });
});

describe("a state the rider names (device audit DV-02)", () => {
  it("reads a trailing state name or code", () => {
    expect(namedUsState("Denver, CO")).toBe("CO");
    expect(namedUsState("Denver, Colorado")).toBe("CO");
    expect(namedUsState("Moab Utah")).toBe("UT");
    expect(namedUsState("Deals Gap NC")).toBe("NC");
    expect(namedUsState("Charleston, West Virginia")).toBe("WV");
    expect(namedUsState("Jim Thorpe, pa")).toBe("PA");
    expect(namedUsState("coffee in")).toBeNull();
    expect(namedUsState("Jim Thorpe")).toBeNull();
    expect(namedUsState("Colorado")).toBeNull();
  });

  it("drops the location bias and ranks the named state first", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        features: [
          feature({ osm_id: 1, osm_value: "road", name: "Denver Road", state: "Pennsylvania", countrycode: "US" }, -76.1, 40.22),
          feature({ osm_id: 2, osm_value: "city", name: "Denver", state: "Colorado", countrycode: "US" }, -104.99, 39.74),
        ],
      }),
    );
    const geocoder = createPhotonGeocoder({ baseUrl: "https://photon.test/api/", fetcher });
    const places = await geocoder.search("Denver, CO", { bias: { lat: 40.6, lon: -75.5 } });
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("lat")).toBeNull();
    expect(places[0]?.label).toBe("Denver, CO");
  });
});

describe("a town named exactly what was typed (PT-02)", () => {
  it("ranks the city of Lyon above Paris's Gare de Lyon for a ride that starts in Paris", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        features: [
          feature({ osm_id: 1, osm_key: "railway", osm_value: "station", name: "Gare de Lyon", city: "Paris", state: "Île-de-France", country: "France", countrycode: "FR" }, 2.3738, 48.8447),
          feature({ osm_id: 2, osm_key: "place", osm_value: "city", name: "Lyon", state: "Auvergne-Rhône-Alpes", country: "France", countrycode: "FR" }, 4.832, 45.7578),
        ],
      }),
    );
    const geocoder = createPhotonGeocoder({ baseUrl: "https://photon.test/api/", fetcher });
    const places = await geocoder.search("Lyon, France", { bias: { lat: 48.8566, lon: 2.3522 } });
    expect(places[0]?.name).toBe("Lyon");
  });

  it("still lets the bias choose between two towns of the same name", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        features: [
          feature({ osm_id: 1, osm_key: "place", osm_value: "town", name: "Newville", state: "Alabama", country: "United States", countrycode: "US" }, -85.33, 31.42),
          feature({ osm_id: 2, osm_key: "place", osm_value: "town", name: "Newville", state: "Pennsylvania", country: "United States", countrycode: "US" }, -77.4, 40.17),
        ],
      }),
    );
    const geocoder = createPhotonGeocoder({ baseUrl: "https://photon.test/api/", fetcher });
    const places = await geocoder.search("Newville", { bias: { lat: 40.2, lon: -77.19 } });
    expect(places[0]?.context).toContain("PA");
  });
});
