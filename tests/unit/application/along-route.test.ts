import { describe, expect, it } from "vitest";

import { alongRouteRows, stopInsertionForRouteMile } from "@/application/places/along-route";
import { asPlaceId, type NearbyPlace } from "@/application/places/types";
import { newStopId } from "@/domain/ride/ids";

function place(overrides: Partial<NearbyPlace> & Pick<NearbyPlace, "id" | "name">): NearbyPlace {
  const { id, name, ...details } = overrides;
  return {
    id,
    kind: "happy_hour",
    name,
    coordinate: { lon: -75.2, lat: 40.1 },
    category: "Bar",
    label: "Til 10 PM",
    status: "now",
    city: "Bridgeport",
    address: "",
    specials: ["$3 drafts"],
    schedule: null,
    rating: null,
    popular: false,
    dogFriendly: null,
    patio: null,
    url: "https://example.test/place",
    mapsUrl: null,
    offRouteMiles: 0.3,
    routeMile: 42,
    ...details,
  };
}

describe("alongRouteRows", () => {
  it("orders by route mile, keeps the nearest duplicate, and hides finished places", () => {
    const near = place({ id: asPlaceId("hh:near"), name: "Near", routeMile: 12 });
    const duplicate = place({ id: near.id, name: "Duplicate", routeMile: 24 });
    const far = place({ id: asPlaceId("hh:far"), name: "Far", routeMile: 50 });
    const done = place({ id: asPlaceId("hh:done"), name: "Done", routeMile: 4, status: "done" });

    expect(alongRouteRows([far, duplicate, done, near]).map((row) => row.place)).toEqual([near, far]);
  });

  it("formats mile, special, live time, and off-route labels", () => {
    const row = alongRouteRows([
      place({
        id: asPlaceId("hh:chickies"),
        name: "Chickie's & Pete's",
        routeMile: 42.3,
        specials: ["$7 burger", "$3 drafts"],
        label: "Til 10 PM",
        offRouteMiles: 0.3,
      }),
    ])[0];

    expect(row).toMatchObject({
      mileLabel: "Mile 42",
      title: "Chickie's & Pete's",
      detail: "$3 drafts",
      when: "On now · until 10 PM",
      live: true,
      offRoute: "0.3 mi off",
    });
  });

  it("uses start, schedule, and event labels when special or distance values are absent", () => {
    const atStart = place({
      id: asPlaceId("hh:start"),
      name: "First stop",
      routeMile: 0.4,
      status: "later",
      label: "4–7 PM",
      specials: [],
      schedule: "Tue–Sun 4–7 PM",
      offRouteMiles: 0.05,
    });
    const event = place({
      id: asPlaceId("ev:fair"),
      name: "County fair",
      kind: "event",
      routeMile: 8,
      status: "upcoming",
      label: "County fair · 6–9 PM",
      specials: [],
      offRouteMiles: null,
    });

    expect(alongRouteRows([atStart, event])).toMatchObject([
      { mileLabel: "At the start", detail: "Tue–Sun 4–7 PM", when: "Today 4–7 PM", offRoute: "On your route" },
      { mileLabel: "Mile 8", detail: "County fair · 6–9 PM", when: "County fair · 6–9 PM", offRoute: "Distance unavailable" },
    ]);
  });

  it("places an unknown route mile last and labels the missing position honestly", () => {
    const known = place({ id: asPlaceId("hh:known"), name: "Known", routeMile: 1 });
    const unknown = place({ id: asPlaceId("hh:unknown"), name: "Unknown", routeMile: null });

    expect(alongRouteRows([unknown, known]).map((row) => row.mileLabel)).toEqual([
      "Mile 1",
      "Mile unavailable",
    ]);
  });

  it("applies its limit after filtering and ordering", () => {
    const places = Array.from({ length: 10 }, (_, index) =>
      place({ id: asPlaceId(`hh:${index}`), name: `Place ${index}`, routeMile: 10 - index }),
    );

    expect(alongRouteRows(places).map((row) => row.place.name)).toEqual([
      "Place 9", "Place 8", "Place 7", "Place 6", "Place 5", "Place 4", "Place 3", "Place 2",
    ]);
    expect(alongRouteRows(places, { limit: 2 }).map((row) => row.place.name)).toEqual(["Place 9", "Place 8"]);
  });
});

describe("stopInsertionForRouteMile", () => {
  it("inserts before the next later stop and appends after the route", () => {
    const [early, late] = [newStopId(), newStopId()];
    const stops = [
      { id: early, routeMile: 10 },
      { id: late, routeMile: 30 },
    ];

    expect(stopInsertionForRouteMile(stops, 20)).toBe(late);
    expect(stopInsertionForRouteMile(stops, 30)).toBeUndefined();
  });

  it("appends when any existing stop has an unknown route position", () => {
    const [known, unknown] = [newStopId(), newStopId()];
    expect(stopInsertionForRouteMile([
      { id: known, routeMile: 10 },
      { id: unknown, routeMile: null },
    ], 5)).toBeUndefined();
  });
});
