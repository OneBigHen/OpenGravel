import { describe, expect, it } from "vitest";

import {
  asPlaceId,
  buildPlaceCard,
  buildPlaceScene,
  cheapestSpecial,
  compactTime,
  type NearbyPlace,
} from "@/application/places";

function place(overrides: Partial<NearbyPlace> = {}): NearbyPlace {
  return {
    id: asPlaceId("hh:a"),
    kind: "happy_hour",
    name: "Chickie's & Pete's",
    coordinate: { lon: -75.3, lat: 40.1 },
    category: "Sports Bar",
    label: "Til 10 PM",
    status: "now",
    city: "Bensalem",
    address: "",
    specials: ["$3 Domestic Bottles", "$5 White Claw"],
    schedule: "Mon–Fri 4–7 PM",
    rating: 4.2,
    popular: false,
    dogFriendly: null,
    patio: true,
    url: "https://sample places provider/happy/a",
    mapsUrl: null,
    offRouteMiles: null,
    routeMile: null,
    ...overrides,
  };
}

describe("place pills", () => {
  it("leads with the cheapest special, like a price on a listings map", () => {
    expect(cheapestSpecial(["$5 wine", "Half-price wings", "$3.50 drafts"])).toBe("$3.50");
    expect(cheapestSpecial(["Half-price apps"])).toBeNull();
    expect(buildPlaceScene([place()])[0]?.pill).toBe("Chickie's · $3 · til 10p");
  });

  it("falls back to the time when no special is priced", () => {
    const scene = buildPlaceScene([place({ specials: [], status: "later", label: "4–7 PM" })]);
    expect(scene[0]).toMatchObject({ pill: "Chickie's · 4–7p", tone: "soon" });
    expect(compactTime("11:30 AM")).toBe("11:30a");
  });

  it("puts live, selected and popular places on top and thins the rest", () => {
    const scene = buildPlaceScene(
      [
        place({ id: asPlaceId("hh:later"), status: "later" }),
        place({ id: asPlaceId("hh:now"), status: "now" }),
        place({ id: asPlaceId("ev:x"), kind: "event", status: "upcoming", label: "Sat 7 PM", specials: [] }),
        place({ id: asPlaceId("hh:sel"), status: "later" }),
      ],
      { selectedId: asPlaceId("hh:sel"), maxPills: 3 },
    );
    expect(scene.map((s) => s.id)).toEqual(["hh:sel", "hh:now", "hh:later"]);
    expect(scene[0]?.selected).toBe(true);
  });

  it("hides finished happy hours unless selected, and dedupes", () => {
    const done = place({ id: asPlaceId("hh:done"), status: "done" });
    expect(buildPlaceScene([done, done])).toEqual([]);
    expect(buildPlaceScene([done, done], { selectedId: asPlaceId("hh:done") })).toHaveLength(1);
  });
});

describe("place card", () => {
  it("shows an event's local occurrence range and the feed refresh time", () => {
    const card = buildPlaceCard(place({
      kind: "event",
      status: "now",
      label: "Happening now",
      startUtc: "2026-09-25T01:00:00+00:00",
      endUtc: "2026-09-25T05:00:00+00:00",
      timeZone: "America/New_York",
    }), "2026-09-25T01:16:00+00:00");
    expect(card.when).toBe("Happening now");
    expect(card.eventTime).toBe("Thu, Sep 24, 9:00 PM EDT – Fri, Sep 25, 1:00 AM EDT");
    expect(card.updated).toBe("Updated Thu, Sep 24, 9:16 PM EDT");
  });

  it("says when, where along the ride, and what's special", () => {
    const card = buildPlaceCard(place({ offRouteMiles: 0.4, routeMile: 42.3 }));
    expect(card).toMatchObject({
      when: "On now · until 10 PM",
      live: true,
      meta: "Sports Bar · Bensalem · 0.4 mi off route · mile 42",
      perks: "★ 4.2 · Patio",
    });
    expect(card.specials).toEqual(["$3 Domestic Bottles", "$5 White Claw"]);
  });

  it("never claims dog-friendly or patio from an unknown", () => {
    expect(buildPlaceCard(place({ patio: null, dogFriendly: null, rating: null })).perks).toBe("");
  });
});

describe("pill names", () => {
  it("shortens a long venue name to its first clause, then at a word", () => {
    const scene = buildPlaceScene([
      place({ name: "North Ridge Cafe Bar and Taproom", specials: [], label: "4–6 PM", status: "later" }),
    ]);
    expect(scene[0]?.pill).toBe("North Ridge… · 4–6p");
  });
});
