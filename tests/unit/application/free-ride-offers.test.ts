import { describe, expect, it } from "vitest";

import {
  EMPTY_OFFER_HISTORY,
  EMPTY_RIDE_OFFER_ATTENTION,
  OFFER_MAX_OBSERVATION_AGE_MS,
  OFFER_MOVING_COOLDOWN_MS,
  OFFER_STRAIGHT_MIN_MS,
  evaluateRideOfferAttention,
  parseOfferCatalog,
  rankRideOffers,
  recordOfferSkip,
  rideOfferTiming,
  summarizeRideOffer,
  type OfferCatalogRoute,
  type RideOfferAttentionInput,
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

  it("does not treat unknown speed as stopped, including for a requested offer", () => {
    expect(rideOfferTiming({ speedMps: null, nowMs: 0, lastOfferEndedAtMs: null, requested: false }).mayOffer).toBe(false);
    expect(rideOfferTiming({ speedMps: null, nowMs: 0, lastOfferEndedAtMs: null, requested: true }).mayOffer).toBe(false);
  });
});

describe("ride offers: attention gate", () => {
  const base: Omit<RideOfferAttentionInput, "state"> = {
    nowMs: 10_000,
    observedAtMs: 10_000,
    speedMps: 12,
    headingDegrees: 90,
    instructionDistanceMeters: null,
  };

  function next(
    state: typeof EMPTY_RIDE_OFFER_ATTENTION,
    input: Partial<typeof base> = {},
  ) {
    return evaluateRideOfferAttention({ ...base, ...input, state });
  }

  it("requires a fresh straight interval before allowing a moving offer", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    expect(first.allowed).toBe(false);
    const second = next(first.state, { nowMs: 11_000, observedAtMs: 11_000 });
    expect(second.allowed).toBe(false);
    const ready = next(second.state, {
      nowMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
      observedAtMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
    });
    expect(ready.allowed).toBe(true);
  });

  it("allows a known stopped rider while keeping unknown speed blocked", () => {
    const stopped = next(EMPTY_RIDE_OFFER_ATTENTION, { speedMps: 0, headingDegrees: null });
    expect(stopped.allowed).toBe(true);
    const unknown = next(EMPTY_RIDE_OFFER_ATTENTION, { speedMps: null, headingDegrees: null });
    expect(unknown.allowed).toBe(false);
  });

  it("allows a known stopped rider after a turn once the close maneuver is gone", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    const turn = next(first.state, { nowMs: 11_000, observedAtMs: 11_000, headingDegrees: 120 });
    const stopped = next(turn.state, { nowMs: 12_000, observedAtMs: 12_000, speedMps: 0, headingDegrees: 120 });
    expect(stopped.allowed).toBe(true);
  });

  it("blocks a heading change until fresh straight evidence follows it", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    const turn = next(first.state, { nowMs: 11_000, observedAtMs: 11_000, headingDegrees: 120 });
    expect(turn.allowed).toBe(false);
    const recovering = next(turn.state, { nowMs: 12_000, observedAtMs: 12_000, headingDegrees: 120 });
    expect(recovering.allowed).toBe(false);
    const ready = next(recovering.state, {
      nowMs: 12_000 + OFFER_STRAIGHT_MIN_MS,
      observedAtMs: 12_000 + OFFER_STRAIGHT_MIN_MS,
      headingDegrees: 120,
    });
    expect(ready.allowed).toBe(true);
  });

  it("handles heading wraparound without treating north as a turn", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION, { headingDegrees: 359 });
    const stable = next(first.state, {
      nowMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
      observedAtMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
      headingDegrees: 1,
    });
    expect(stable.allowed).toBe(true);
  });

  it("requires two distinct fresh straight observations", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    const repeated = next(first.state, { nowMs: 10_000 + OFFER_STRAIGHT_MIN_MS, observedAtMs: 10_000 });
    expect(repeated.allowed).toBe(false);
    const fresh = next(repeated.state, {
      nowMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
      observedAtMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
    });
    expect(fresh.allowed).toBe(true);
    const duplicateAfterReady = next(fresh.state, {
      nowMs: 10_000 + OFFER_STRAIGHT_MIN_MS * 2,
      observedAtMs: 10_000 + OFFER_STRAIGHT_MIN_MS,
    });
    expect(duplicateAfterReady.allowed).toBe(true);
  });

  it("blocks cumulative heading drift even when each individual fix is small", () => {
    let result = next(EMPTY_RIDE_OFFER_ATTENTION, { headingDegrees: 0 });
    result = next(result.state, { nowMs: 11_000, observedAtMs: 11_000, headingDegrees: 10 });
    result = next(result.state, { nowMs: 12_000, observedAtMs: 12_000, headingDegrees: 20 });
    result = next(result.state, { nowMs: 13_000, observedAtMs: 13_000, headingDegrees: 30 });
    expect(result.allowed).toBe(false);
    expect(result.state.turnDetectedAtMs).toBe(12_000);
  });

  it("forgets the straight window after a stale observation", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    const stale = next(first.state, { nowMs: 16_000, observedAtMs: 10_000 });
    expect(stale.allowed).toBe(false);
    const restarted = next(stale.state, { nowMs: 16_000, observedAtMs: 16_000 });
    expect(restarted.allowed).toBe(false);
    const ready = next(restarted.state, { nowMs: 19_000, observedAtMs: 19_000 });
    expect(ready.allowed).toBe(true);
  });

  it("restarts after a timer gap even when the next fix is fresh", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    const second = next(first.state, { nowMs: 11_000, observedAtMs: 11_000 });
    const gap = next(second.state, {
      nowMs: 11_000 + OFFER_MAX_OBSERVATION_AGE_MS + 1,
      observedAtMs: 11_000 + OFFER_MAX_OBSERVATION_AGE_MS + 1,
    });
    expect(gap.allowed).toBe(false);
    const ready = next(gap.state, {
      nowMs: 11_000 + OFFER_MAX_OBSERVATION_AGE_MS + 1 + OFFER_STRAIGHT_MIN_MS,
      observedAtMs: 11_000 + OFFER_MAX_OBSERVATION_AGE_MS + 1 + OFFER_STRAIGHT_MIN_MS,
    });
    expect(ready.allowed).toBe(true);
  });

  it("does not count a non-increasing observation timestamp", () => {
    const first = next(EMPTY_RIDE_OFFER_ATTENTION);
    const second = next(first.state, { nowMs: 11_000, observedAtMs: 11_000 });
    const backwards = next(second.state, { nowMs: 14_000, observedAtMs: 10_500 });
    expect(backwards.allowed).toBe(false);
    const ready = next(backwards.state, { nowMs: 14_000, observedAtMs: 14_000 });
    expect(ready.allowed).toBe(false);
  });

  it("blocks a close maneuver even while stopped or after cooldown bypass", () => {
    const close = next(EMPTY_RIDE_OFFER_ATTENTION, { speedMps: 0, headingDegrees: null, instructionDistanceMeters: 100 });
    expect(close.allowed).toBe(false);
    const far = next(EMPTY_RIDE_OFFER_ATTENTION, { speedMps: 0, headingDegrees: null, instructionDistanceMeters: 151 });
    expect(far.allowed).toBe(true);

    let moving = next(EMPTY_RIDE_OFFER_ATTENTION, { speedMps: 20 });
    moving = next(moving.state, { nowMs: 11_000, observedAtMs: 11_000, speedMps: 20 });
    moving = next(moving.state, { nowMs: 13_000, observedAtMs: 13_000, speedMps: 20 });
    const tenSecondClose = next(moving.state, {
      nowMs: 14_000,
      observedAtMs: 14_000,
      speedMps: 20,
      instructionDistanceMeters: 200,
    });
    expect(tenSecondClose.allowed).toBe(false);
    const beyondLookahead = next(tenSecondClose.state, {
      nowMs: 15_000,
      observedAtMs: 15_000,
      instructionDistanceMeters: 201,
    });
    expect(beyondLookahead.allowed).toBe(true);
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
