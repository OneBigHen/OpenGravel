import { describe, expect, it } from "vitest";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";
import { createPhotonGeocoder } from "@/infrastructure/geocoding/photon";
import { createTomTomPlaceSearch, TOMTOM_PLACE_RADIUS_METERS } from "@/infrastructure/geocoding/tomtom";
import {
  createPlaceSearchEngine,
  nameMatchesTypedText,
  PLACE_NEAREST_REACH_METERS,
} from "@/server/geocoding/place-search";

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
/** The sanctuary itself: one place whose own name is the whole query. */
const HAWK_MOUNTAIN_SANCTUARY = photonFeature(
  "Hawk Mountain Sanctuary",
  { lat: 40.6348, lon: -75.9913 },
  { osm_key: "tourism", osm_value: "attraction", city: "Albany Township", county: "Berks" },
);
/** The ridge, when only that and the town of the same last word answer. */
const HAWK_MOUNTAIN_RIDGE = photonFeature(
  "Hawk Mountain",
  { lat: 40.6209, lon: -75.9834 },
  { osm_key: "natural", osm_value: "peak", city: "Kempton", county: "Berks" },
);
/** A real town whose name is also the last word of the sanctuary's. */
const SANCTUARY_TX = photonFeature(
  "Sanctuary",
  { lat: 32.6243, lon: -97.6886 },
  { city: "Sanctuary", county: "Parker", state: "Texas" },
);
const BLUE_MOUNTAIN_RESORT = photonFeature(
  "Blue Mountain Resort",
  { lat: 40.8216, lon: -75.6064 },
  { osm_key: "tourism", osm_value: "resort", city: "Palmerton", county: "Carbon" },
);
/** What the parser can turn the query's last two words into when it splits. */
const MOUNTAIN_RESORT_ID = photonFeature(
  "Mountain Resort",
  { lat: 48.5, lon: -116.85 },
  { osm_key: "tourism", osm_value: "resort", city: "Coolin", county: "Bonner", state: "Idaho" },
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

/** A Sheetz in Lehighton itself, and the nearest one when the town has none (~35 km). */
const SHEETZ_LEHIGHTON = {
  id: "sheetz-lehighton",
  poi: { name: "Sheetz", brands: [{ name: "Sheetz" }] },
  address: {
    streetName: "Blakeslee Blvd",
    municipality: "Lehighton",
    countrySubdivisionCode: "PA",
    countryCode: "US",
  },
  position: { lat: 40.8332, lon: -75.714 },
};
const SHEETZ_KUTZTOWN = {
  id: "sheetz-kutztown",
  poi: { name: "Sheetz", brands: [{ name: "Sheetz" }] },
  address: {
    streetName: "Kutztown Rd",
    municipality: "Kutztown",
    countrySubdivisionCode: "PA",
    countryCode: "US",
  },
  position: { lat: 40.52, lon: -75.78 },
};

/** A Wawa in Allentown, ~37 km from Jim Thorpe: outside the town's own radius. */
const WAWA_ALLENTOWN = {
  id: "wawa-allentown",
  poi: { name: "Wawa", brands: [{ name: "Wawa" }] },
  address: {
    streetName: "Hamilton Blvd",
    municipality: "Allentown",
    countrySubdivisionCode: "PA",
    countryCode: "US",
  },
  position: { lat: 40.6, lon: -75.49 },
};

/** A Sheetz ~85 km from Jim Thorpe and ~75 km from Lehighton: a farther band. */
const SHEETZ_HONESDALE = {
  id: "sheetz-honesdale",
  poi: { name: "Sheetz", brands: [{ name: "Sheetz" }] },
  address: {
    streetName: "Main St",
    municipality: "Honesdale",
    countrySubdivisionCode: "PA",
    countryCode: "US",
  },
  position: { lat: 41.5737, lon: -75.2571 },
};

/** The text a TomTom fuzzy search is looking for, decoded from its path. */
function tomtomQuery(url: URL): string {
  return /\/search\/2\/search\/(.+)\.json$/.exec(decodeURIComponent(url.pathname))?.[1] ?? "";
}

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
    expect(tomtomUrls[0]?.pathname).toBe(`/search/2/search/${encodeURIComponent("Wawa")}.json`);
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
      `/search/2/search/${encodeURIComponent("Blue Mountain Ski")}.json`,
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

  it("answers 'Sheetz Lehighton' with the nearest Sheetz and the town, never empty", async () => {
    // The town has no Sheetz of its own, and the text as typed names no place.
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => (query === "Lehighton" ? [LEHIGHTON_TOWN] : []),
      (url) => {
        if (tomtomQuery(url) !== "Sheetz") return { results: [] };
        return url.searchParams.get("radius") === String(TOMTOM_PLACE_RADIUS_METERS)
          ? { results: [] }
          : { results: [SHEETZ_KUTZTOWN] };
      },
    );
    const places = await engine(fetcher)("Sheetz Lehighton", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Sheetz, Kutztown, PA",
      "Lehighton, PA",
    ]);
    expect(places.map((place) => place.provider)).toEqual(["tomtom", "photon"]);
    // The words as typed are asked first; the split happens only once that is empty.
    expect(photonQueries).toEqual(["Sheetz Lehighton", "Lehighton"]);
    expect(tomtomUrls.map(tomtomQuery)).toEqual(["Sheetz Lehighton", "Sheetz", "Sheetz"]);
    // The brand is looked for around Lehighton, then once for the nearest anywhere.
    const widened = tomtomUrls[2]!;
    expect(widened.searchParams.get("radius")).toBe(String(PLACE_NEAREST_REACH_METERS));
    expect(widened.searchParams.get("lat")).toBe("40.83370");
    expect(widened.searchParams.get("lon")).toBe("-75.71380");
  });

  it("leads with the Sheetz in Lehighton, one town-scoped search, when the town has one", async () => {
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => (query === "Lehighton" ? [LEHIGHTON_TOWN] : []),
      (url) => (tomtomQuery(url) === "Sheetz" ? { results: [SHEETZ_LEHIGHTON] } : { results: [] }),
    );
    const places = await engine(fetcher)("Sheetz Lehighton", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Sheetz, Lehighton, PA",
      "Lehighton, PA",
    ]);
    expect(photonQueries).toEqual(["Sheetz Lehighton", "Lehighton"]);
    // The town's own Sheetz answered, so nothing was widened.
    expect(tomtomUrls.map(tomtomQuery)).toEqual(["Sheetz Lehighton", "Sheetz"]);
    expect(tomtomUrls[1]?.searchParams.get("radius")).toBe(String(TOMTOM_PLACE_RADIUS_METERS));
  });

  it("offers the town on its own when the brand answers nowhere near it", async () => {
    const { fetcher } = stub(
      (query) => (query === "Lehighton" ? [LEHIGHTON_TOWN] : []),
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Sheetz Lehighton", JIM_THORPE, signal());
    // Neither source found a Sheetz, but the town the rider named is still an answer.
    expect(places.map((place) => place.label)).toEqual(["Lehighton, PA"]);
  });

  it("finds the nearest Wawa when the named town has none of its own", async () => {
    // Production returned only the town: the Wawa nearest Jim Thorpe is ~25 mi out.
    const { fetcher, tomtomUrls } = stub(
      (query) => (query.toLowerCase().includes("jim thorpe") ? [JIM_THORPE_TOWN] : []),
      (url) => {
        if (tomtomQuery(url) !== "Wawa") return { results: [] };
        return url.searchParams.get("radius") === String(TOMTOM_PLACE_RADIUS_METERS)
          ? { results: [] }
          : { results: [WAWA_ALLENTOWN] };
      },
    );
    const places = await engine(fetcher)("Wawa Jim Thorpe", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Wawa, Allentown, PA",
      "Jim Thorpe, PA",
    ]);
    const widened = tomtomUrls.find(
      (url) => url.searchParams.get("radius") === String(PLACE_NEAREST_REACH_METERS),
    );
    expect(widened?.searchParams.get("lat")).toBe("40.87570");
  });

  it("leaves a plain town name exactly as it was", async () => {
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => (query === "Lehighton" ? [LEHIGHTON_TOWN] : []),
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Lehighton", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual(["Lehighton, PA"]);
    expect(photonQueries).toEqual(["Lehighton"]);
    expect(tomtomUrls.map(tomtomQuery)).toEqual(["Lehighton"]);
  });

  it("does not split a two-word town's own name into a brand and a fragment", async () => {
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => (query === "Jim Thorpe" ? [JIM_THORPE_TOWN] : []),
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Jim Thorpe", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual(["Jim Thorpe, PA"]);
    expect(photonQueries).toEqual(["Jim Thorpe"]);
    expect(tomtomUrls.map(tomtomQuery)).toEqual(["Jim Thorpe"]);
  });

  it("keeps a plain two-word town whole when the rider has no location", async () => {
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => (query === "Jim Thorpe" ? [JIM_THORPE_TOWN] : []),
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Jim Thorpe", undefined, signal());

    expect(places.map((place) => place.label)).toEqual(["Jim Thorpe, PA"]);
    // Nothing was geocoded as "Thorpe", and no POI search asked for "Jim" there.
    expect(photonQueries).toEqual(["Jim Thorpe"]);
    expect(tomtomUrls).toEqual([]);
  });

  it("answers 'Hawk Mountain Sanctuary' with the sanctuary, not a town called Sanctuary", async () => {
    // Production: no rider location, no server bias, and the last word of the
    // place's own name is also a town in Texas.
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => {
        if (query === "Hawk Mountain Sanctuary") return [HAWK_MOUNTAIN_SANCTUARY, SANCTUARY_TX];
        if (query === "Sanctuary") return [SANCTUARY_TX];
        return [];
      },
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Hawk Mountain Sanctuary", undefined, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Hawk Mountain Sanctuary, Albany Township, PA",
      "Sanctuary, TX",
    ]);
    // The query is a place's own name: its trailing words were never geocoded
    // as a town, so no search was ever aimed at Texas.
    expect(photonQueries).toEqual(["Hawk Mountain Sanctuary"]);
    expect(tomtomUrls).toEqual([]);
  });

  it("keeps a term match above the town a split guessed", async () => {
    // The sanctuary is not in the answers, so the split runs — but the ridge
    // that matches the remaining term still outranks the guessed town.
    const { fetcher, photonQueries } = stub(
      (query) => {
        if (query === "Hawk Mountain Sanctuary") return [HAWK_MOUNTAIN_RIDGE, SANCTUARY_TX];
        if (query === "Sanctuary") return [SANCTUARY_TX];
        return [];
      },
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Hawk Mountain Sanctuary", undefined, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Hawk Mountain, Kempton, PA",
      "Sanctuary, TX",
    ]);
    expect(photonQueries).toEqual(["Hawk Mountain Sanctuary", "Mountain Sanctuary", "Sanctuary"]);
  });

  it("never ranks the guessed town above the brand, even when the brand is farther", async () => {
    // The town has no Sheetz; the nearest one is ~85 km from the rider, in a
    // farther distance band than the town itself.
    const { fetcher } = stub(
      (query) => (query === "Lehighton" ? [LEHIGHTON_TOWN] : []),
      (url) => {
        if (tomtomQuery(url) !== "Sheetz") return { results: [] };
        return url.searchParams.get("radius") === String(TOMTOM_PLACE_RADIUS_METERS)
          ? { results: [] }
          : { results: [SHEETZ_HONESDALE] };
      },
    );
    const places = await engine(fetcher)("Sheetz Lehighton", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual([
      "Sheetz, Honesdale, PA",
      "Lehighton, PA",
    ]);
  });

  it("answers 'Blue Mountain Resort' as one place name, not 'Blue' around a resort", async () => {
    const { fetcher, photonQueries, tomtomUrls } = stub(
      (query) => {
        if (query === "Blue Mountain Resort") return [BLUE_MOUNTAIN_RESORT, UTAH_BLUE_MOUNTAIN];
        if (query === "Mountain Resort") return [MOUNTAIN_RESORT_ID];
        return [];
      },
      () => ({ results: [] }),
    );
    const places = await engine(fetcher)("Blue Mountain Resort", JIM_THORPE, signal());

    expect(places.map((place) => place.label)).toEqual(["Blue Mountain Resort, Palmerton, PA"]);
    // The whole name answered, so neither its last two words nor its last word
    // were geocoded as a town.
    expect(photonQueries).toEqual(["Blue Mountain Resort"]);
    expect(tomtomUrls.map(tomtomQuery)).toEqual(["Blue Mountain Resort"]);
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
