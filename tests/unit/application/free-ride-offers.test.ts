import { describe, expect, it } from "vitest";

import {
  EMPTY_OFFER_HISTORY,
  OFFER_MOVING_COOLDOWN_MS,
  parseOfferCatalog,
  rankRideOffers,
  recordOfferSkip,
  rideOfferTiming,
  summarizeRideOffer,
  type OfferCatalogRoute,
} from "@/application/free-ride/ride-offers";
import type { Coordinate } from "@/domain/ride/types";

const HERE: Coordinate = { lon: -75.9, lat: 40.6 };

/** A short east-west line starting `eastKm` east of here. */
function route(id: string, eastKm: number, extra: Partial<OfferCatalogRoute> = {}): OfferCatalogRoute {
  const degreesPerKm = 1 / (111.32 * Math.cos((HERE.lat * Math.PI) / 180));
  return {
    id,
    name: `Route ${id}`,
    region: "Pennsylvania",
    distanceKm: 40,
    line: [
      { lon: HERE.lon + eastKm * degreesPerKm, lat: HERE.lat },
      { lon: HERE.lon + (eastKm + 5) * degreesPerKm, lat: HERE.lat },
    ],
    ...extra,
  };
}

describe("ride offers: ranking", () => {
  it("puts a nearby curvy shared route first, then loops, and home last", () => {
    const offers = rankRideOffers({
      position: HERE,
      headingDegrees: null,
      catalog: [route("near", 2, { curvatureSummary: "15 mi of curves" }), route("far", 80)],
      home: { lon: -76.2, lat: 40.6 },
      history: EMPTY_OFFER_HISTORY,
    });
    expect(offers.map((offer) => offer.id)).toEqual(["catalog:near", "loop:45", "loop:90", "home"]);
  });

  it("prefers a route the way the rider is already heading", () => {
    // West ends 3 km away, east starts 8 km away: heading east wins it.
    const offers = rankRideOffers({
      position: HERE,
      headingDegrees: 90,
      catalog: [route("west", -8), route("east", 8)],
      home: null,
      history: EMPTY_OFFER_HISTORY,
    });
    expect(offers[0]?.id).toBe("catalog:east");
  });

  it("never offers a skipped ride again and sinks a kind the rider keeps skipping", () => {
    let history = EMPTY_OFFER_HISTORY;
    const input = { position: HERE, headingDegrees: null, catalog: [route("a", 1), route("b", 3)], home: null };
    const first = rankRideOffers({ ...input, history });
    expect(first[0]?.id).toBe("catalog:a");
    history = recordOfferSkip(history, first[0]!);
    const second = rankRideOffers({ ...input, history });
    expect(second.some((offer) => offer.id === "catalog:a")).toBe(false);
    // One skipped shared route: the next one now ranks below a loop.
    expect(second[0]?.id).toBe("loop:45");
    expect(second.findIndex((offer) => offer.id === "catalog:b")).toBeGreaterThan(0);
  });

  it("leaves home out when the rider is nearly there", () => {
    const offers = rankRideOffers({
      position: HERE,
      headingDegrees: null,
      catalog: [],
      home: { lon: HERE.lon + 0.01, lat: HERE.lat },
      history: EMPTY_OFFER_HISTORY,
    });
    expect(offers.some((offer) => offer.kind === "home")).toBe(false);
  });
});

describe("ride offers: the card", () => {
  it("reads a shared route as time, curves, surface and where it ends", () => {
    const [offer] = rankRideOffers({
      position: HERE,
      headingDegrees: null,
      catalog: [route("hawk", 3, {
        name: "Hawk Mountain Loop",
        curvatureSummary: "12 mi of curves",
        surfaceSummary: "Mostly paved · 2.5 mi gravel",
      })],
      home: null,
      history: EMPTY_OFFER_HISTORY,
    });
    const summary = summarizeRideOffer(offer!, { durationSeconds: 2_700, distanceMeters: 48_000 });
    expect(summary).toMatchObject({
      title: "Hawk Mountain Loop",
      kicker: "Shared route · 1.9 mi away",
      minutes: 45,
      chips: ["Very curvy", "2.5 mi gravel", "Back here"],
    });
    expect(summary.spoken).toContain("45 minutes");
  });
});

describe("ride offers: timing", () => {
  it("waits minutes between offers while moving, seconds while stopped, none when asked", () => {
    const ended = 1_000_000;
    expect(rideOfferTiming({ speedMps: 20, nowMs: ended + 60_000, lastOfferEndedAtMs: ended, requested: false }).mayOffer).toBe(false);
    expect(rideOfferTiming({ speedMps: 20, nowMs: ended + OFFER_MOVING_COOLDOWN_MS, lastOfferEndedAtMs: ended, requested: false }).mayOffer).toBe(true);
    expect(rideOfferTiming({ speedMps: 0, nowMs: ended + 10_000, lastOfferEndedAtMs: ended, requested: false }).mayOffer).toBe(true);
    expect(rideOfferTiming({ speedMps: 20, nowMs: ended + 1, lastOfferEndedAtMs: ended, requested: true }).mayOffer).toBe(true);
    expect(rideOfferTiming({ speedMps: 20, nowMs: 0, lastOfferEndedAtMs: null, requested: false }).lifetimeMs).toBeLessThan(
      rideOfferTiming({ speedMps: 0, nowMs: 0, lastOfferEndedAtMs: null, requested: false }).lifetimeMs,
    );
  });
});

describe("ride offers: catalog payload", () => {
  it("keeps well-formed routes and drops the rest", () => {
    const parsed = parseOfferCatalog({
      routes: [
        { id: "a", name: "A", region: "PA", distanceKm: 30, preview: [{ lon: -75, lat: 40 }, { lon: -75.1, lat: 40 }], curvatureSummary: "3 mi of curves" },
        { id: "b", name: "B", preview: [{ lon: -75, lat: 40 }] },
        { id: 3, name: "C", preview: [] },
      ],
    });
    expect(parsed.map((route) => route.id)).toEqual(["a"]);
    expect(parseOfferCatalog(null)).toEqual([]);
  });
});
