import { describe, expect, it } from "vitest";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";
import { createPhotonGeocoder } from "@/infrastructure/geocoding/photon";
import { createTomTomPlaceSearch } from "@/infrastructure/geocoding/tomtom";
import { createPlaceSearchEngine, nameMatchesTypedText } from "@/server/geocoding/place-search";

/** Searching from Jim Thorpe, PA — the production measurement in the task. */
const JIM_THORPE: Coordinate = { lat: 40.87, lon: -75.73 };
const LEHIGHTON: Coordinate = { lat: 40.8337, lon: -75.7138 };

const PHOTON_BASE = "https://photon.test/api/";

type PhotonFeatures = (query: string) => readonly unknown[];
type TomTomPayload = (url: URL) => unknown;

interface Stub {
  readonly fetcher: typeof fetch;
  readonly photonQueries: string[];
  readonly tomtomUrls: URL[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function photonFeature(
  name: string,
  position: Coordinate,
  properties: Record<string, unknown> = {},
): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [position.lon, position.lat] },
    properties: {
      osm_type: "R",
      osm_id: 1,
      osm_key: "place",
      osm_value: "town",
      name,
      state: "Pennsylvania",
      country: "United States",
      countrycode: "US",
      ...properties,
    },
  };
}

const JIM_THORPE_TOWN = photonFeature("Jim Thorpe", { lat: 40.8757, lon: -75.7324 }, { county: "Carbon" });
const LEHIGHTON_TOWN = photonFeature("Lehighton", LEHIGHTON, { county: "Carbon" });
const INDIA_LEHIGHTON = photonFeature(
  "Lehighton",
  { lat: 17.38, lon: 78.48 },
  { city: "Hyderabad", state: "Telangana", country: "India", countrycode: "IN" },
);
const UTAH_BLUE_MOUNTAIN = photonFeature(
  "Blue Mountain",
  { lat: 39.15, lon: -113.4 },
  { city: "Delta", county: "Millard", state: "Utah" },
);
const PA_BLUE_MOUNTAIN = photonFeature(
  "Blue Mountain Ski Area",
  { lat: 40.82, lon: -75.6 },
  { city: "Palmerton", county: "Carbon" },
);

const WAWA_POI = {
  id: "wawa-jim-thorpe",
  poi: { name: "Wawa", brands: [{ name: "Wawa" }] },
  address: {
    streetNumber: "48",
    streetName: "Broadway",
    municipality: "Jim Thorpe",
    countrySubdivision: "Pennsylvania",
    countryCode: "US",
    country: "United States",
  },
  position: { lat: 40.8765, lon: -75.7336 },
};

const GAS_STATIONS = {
  results: [
    {
      id: "gas-lehighton",
      poi: { name: "Lehighton Fuel Stop" },
      address: { streetName: "Bankway", municipality: "Lehighton", countrySubdivision: "Pennsylvania", countryCode: "US" },
      position: { lat: 40.8337, lon: -75.7138 },
    },
    {
      id: "gas-mahoning",
      poi: { name: "Mahoning Valley Gas" },
      address: { municipality: "Lehighton", countrySubdivision: "Pennsylvania", countryCode: "US" },
      position: { lat: 40.82, lon: -75.75 },
    },
  ],
};

function stub(photon: PhotonFeatures, tomtom: TomTomPayload | "fail"): Stub {
  const photonQueries: string[] = [];
  const tomtomUrls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "photon.test") {
      const query = url.searchParams.get("q") ?? "";
      photonQueries.push(query);
      return jsonResponse({ type: "FeatureCollection", features: photon(query) });
    }
    tomtomUrls.push(url);
    if (tomtom === "fail") return jsonResponse({ error: "down" }, 500);
    return jsonResponse(tomtom(url));
  }) as unknown as typeof fetch;
  return { fetcher, photonQueries, tomtomUrls };
}

function engine(fetcher: typeof fetch, withTomTom = true) {
  const photon = createPhotonGeocoder({ baseUrl: PHOTON_BASE, fetcher });
  const tomtom = withTomTom
    ? createTomTomPlaceSearch({ apiKey: "test-key", fetcher })
    : undefined;
  return createPlaceSearchEngine({ photon, ...(tomtom === undefined ? {} : { tomtom }) });
}

const signal = (): AbortSignal => new AbortController().signal;

describe("place search engine", () => {
  it("finds the Wawa in Jim Thorpe, not only the town", async () => {
    // Photon sees the town and nothing else, as measured on production.
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => (query.toLowerCase().includes("jim thorpe") ? [JIM_THORPE_TOWN] : []),
      (url) => (url.pathname.includes("Wawa") ? { results: [WAWA_POI] } : { results: [] }),
    );
    const places = await engine(fetcher)("Wawa Jim Thorpe", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Wawa, Jim Thorpe, PA",
      "Jim Thorpe, PA",
    ]);
    expect(places[0]?.provider).toBe("tomtom");
    // The town the rider typed is resolved, and only its name is sent to TomTom.
    expect(photonQueries).toContain("Jim Thorpe");
    expect(tomtomUrls[0]?.pathname).toBe(`/search/2/fuzzySearch/${encodeURIComponent("Wawa")}.json`);
    expect(tomtomUrls[0]?.searchParams.get("lat")).toBe("40.87570");
    expect(tomtomUrls[0]?.searchParams.get("lon")).toBe("-75.73240");
    // The key travels upstream and never comes back in an answer.
    expect(tomtomUrls[0]?.searchParams.get("key")).toBe("test-key");
    expect(JSON.stringify(places)).not.toContain("test-key");
  });

  it("answers 'gas near Lehighton' with Lehighton stations, not Telangana", async () => {
    const { fetcher, tomtomUrls } = stub(
      (query) => (query.toLowerCase() === "lehighton" ? [LEHIGHTON_TOWN] : [LEHIGHTON_TOWN, INDIA_LEHIGHTON]),
      () => GAS_STATIONS,
    );
    const places = await engine(fetcher)("gas near Lehighton", JIM_THORPE, signal());

    expect(places.slice(0, 2).map((place) => place.name)).toEqual([
      "Lehighton Fuel Stop",
      "Mahoning Valley Gas",
    ]);
    expect(places.map((place) => place.label).join(" | ")).not.toContain("India");
    // A category is asked as a category, around the town the rider named.
    expect(tomtomUrls[0]?.pathname).toBe("/search/2/nearbySearch/.json");
    expect(tomtomUrls[0]?.searchParams.get("categorySet")).toBe("7311");
    expect(tomtomUrls[0]?.searchParams.get("lat")).toBe("40.83370");
    expect(tomtomUrls[0]?.searchParams.get("lon")).toBe("-75.71380");
  });

  it("keeps 'Blue Mountain Ski' in Pennsylvania instead of Utah", async () => {
    const { fetcher, tomtomUrls } = stub(
      (query) => (query === "Blue Mountain Ski" ? [PA_BLUE_MOUNTAIN, UTAH_BLUE_MOUNTAIN] : []),
      () => ({ results: [{ ...WAWA_POI, id: "blue-mountain", poi: { name: "Blue Mountain Resort" } }] }),
    );
    const places = await engine(fetcher)("Blue Mountain Ski", JIM_THORPE, signal());

    expect(places.map((place) => place.label).join(" | ")).not.toContain("UT");
    expect(places[0]?.name).toBe("Blue Mountain Resort");
    expect(places.map((place) => place.name)).toContain("Blue Mountain Ski Area");
    // No town resolved, so the rider's own point is the centre of the POI search.
    expect(tomtomUrls[0]?.pathname).toBe(
      `/search/2/fuzzySearch/${encodeURIComponent("Blue Mountain Ski")}.json`,
    );
    expect(tomtomUrls[0]?.searchParams.get("lat")).toBe("40.87000");
  });

  it("falls back to Photon answers when TomTom fails", async () => {
    const { fetcher } = stub(
      () => [LEHIGHTON_TOWN, INDIA_LEHIGHTON],
      "fail",
    );
    const places = await engine(fetcher)("gas near Lehighton", JIM_THORPE, signal());
    // Today's behaviour, minus the answer on the other side of the planet.
    expect(places.map((place) => place.label)).toEqual(["Lehighton, PA"]);
    expect(places.every((place) => place.provider === "photon")).toBe(true);
  });

  it("answers with POIs when Photon fails", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      if (url.hostname === "photon.test") return jsonResponse({ error: "down" }, 500);
      return jsonResponse(GAS_STATIONS);
    }) as unknown as typeof fetch;
    const places = await engine(fetcher)("gas near Lehighton", JIM_THORPE, signal());
    expect(places.map((place) => place.name)).toEqual(["Lehighton Fuel Stop", "Mahoning Valley Gas"]);
  });

  it("reports unavailable only when both sources fail", async () => {
    const fetcher = (async () => jsonResponse({ error: "down" }, 500)) as unknown as typeof fetch;
    await expect(engine(fetcher)("gas near Lehighton", JIM_THORPE, signal())).rejects.toThrow();
  });

  it("keeps today's Photon behaviour when no TomTom key is configured", async () => {
    const { fetcher } = stub((query) => (query === "Wawa Jim Thorpe" ? [JIM_THORPE_TOWN] : []), () => ({ results: [] }));
    const places = await engine(fetcher, false)("Wawa Jim Thorpe", JIM_THORPE, signal());
    expect(places.map((place) => place.label)).toEqual(["Jim Thorpe, PA"]);
  });

  it("searches a bare category around the rider's own point", async () => {
    const { fetcher, tomtomUrls } = stub(() => [], () => GAS_STATIONS);
    const places = await engine(fetcher)("coffee", JIM_THORPE, signal());
    expect(places).toHaveLength(2);
    expect(tomtomUrls[0]?.searchParams.get("categorySet")).toBe("9376");
    expect(tomtomUrls[0]?.searchParams.get("lat")).toBe("40.87000");
  });
});

describe("name matching for a geocoded town", () => {
  it("accepts the state the rider typed, or did not", () => {
    expect(nameMatchesTypedText("Jim Thorpe", "Jim Thorpe")).toBe(true);
    expect(nameMatchesTypedText("Jim Thorpe, PA", "Jim Thorpe")).toBe(true);
    expect(nameMatchesTypedText("jim thorpe", "Jim Thorpe")).toBe(true);
    expect(nameMatchesTypedText("Lehighton", "Jim Thorpe")).toBe(false);
  });

  it("does not treat a city whose name ends in two letters as a state", () => {
    expect(nameMatchesTypedText("Tampa", "Tampa")).toBe(true);
  });
});

describe("merged answer shape", () => {
  it("stays the documented PlaceMatch shape", async () => {
    const { fetcher } = stub(() => [JIM_THORPE_TOWN], () => ({ results: [WAWA_POI] }));
    const places: PlaceMatch[] = await engine(fetcher)("Wawa Jim Thorpe", JIM_THORPE, signal());
    for (const place of places) {
      expect(Object.keys(place).sort()).toEqual([
        "context",
        "coordinate",
        "id",
        "label",
        "name",
        "provider",
      ]);
    }
  });
});
