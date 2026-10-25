import { describe, expect, it } from "vitest";

import {
  calculateSunrise,
  calculateSunset,
  LONG_TRIP_DISTANCE_KM,
  LONG_TRIP_DURATION_MINUTES,
  longTripConsiderations,
  sunState,
  type LongTripFacts,
  type LongTripRide,
} from "@/application/long-trip";

const departure = "2026-09-20T13:00:00.000Z";

const baseRide: LongTripRide = {
  distanceKm: 151,
  durationMinutes: 190,
  departure,
  region: "Lehigh Valley",
  bike: { fuelRangeMiles: 220, reserveMiles: 30 },
};

const baseFacts: LongTripFacts = {
  daylight: {
    sunset: "2026-09-20T15:30:00.000Z",
    source: "NOAA solar calculation",
    sourceRef: "daylight:noaa:2026-09-20:-75.4:40.6",
  },
  weather: {
    state: "ready",
    fetchedAt: "2026-09-20T12:30:00.000Z",
    source: "NWS",
    sourceRef: "weather:nws:fixture",
    maxPrecipChance: 10,
    maxWindMph: 12,
    alerts: [],
  },
};

describe("longTripConsiderations", () => {
  it("keeps a ride just under the long-trip distance and duration gates quiet", () => {
    const considerations = longTripConsiderations(
      {
        ...baseRide,
        distanceKm: LONG_TRIP_DISTANCE_KM,
        durationMinutes: LONG_TRIP_DURATION_MINUTES,
      },
      baseFacts,
    );

    expect(considerations).toEqual([]);
  });

  it("applies distance and duration relevance gates independently", () => {
    const underDistance = longTripConsiderations(
      {
        ...baseRide,
        distanceKm: LONG_TRIP_DISTANCE_KM - 0.01,
        durationMinutes: LONG_TRIP_DURATION_MINUTES,
      },
      baseFacts,
    );
    const overDistance = longTripConsiderations(
      {
        ...baseRide,
        distanceKm: LONG_TRIP_DISTANCE_KM + 0.01,
        durationMinutes: LONG_TRIP_DURATION_MINUTES,
      },
      baseFacts,
    );
    const underDuration = longTripConsiderations(
      {
        ...baseRide,
        distanceKm: LONG_TRIP_DISTANCE_KM,
        durationMinutes: LONG_TRIP_DURATION_MINUTES - 0.01,
      },
      baseFacts,
    );
    const overDuration = longTripConsiderations(
      {
        ...baseRide,
        distanceKm: LONG_TRIP_DISTANCE_KM,
        durationMinutes: LONG_TRIP_DURATION_MINUTES + 0.01,
      },
      baseFacts,
    );

    expect(underDistance.find((item) => item.kind === "daylight")).toBeUndefined();
    expect(overDistance.find((item) => item.kind === "daylight")).toBeDefined();
    expect(underDuration.find((item) => item.kind === "daylight")).toBeUndefined();
    expect(overDuration.find((item) => item.kind === "daylight")).toBeDefined();
  });

  it("surfaces a fuel gap and flags the conservative range assumption", () => {
    const considerations = longTripConsiderations(
      {
        ...baseRide,
        distanceKm: 300,
        bike: null,
      },
      {},
    );

    expect(considerations).toContainEqual(expect.objectContaining({
      kind: "fuel",
      severity: "critical",
      sourceRefs: expect.arrayContaining(["assumption:conservative-fuel-range"]),
    }));
    expect(considerations.find((item) => item.kind === "fuel")?.whyLine).toMatch(/assumption/i);
  });

  it("measures fuel against the bike's usable range and says how it got it (FT-04)", () => {
    const fuel = longTripConsiderations(
      { ...baseRide, distanceKm: 155 * 1.609344, bike: { fuelRangeMiles: 150, reserveMiles: 30 } },
      {},
    ).find((item) => item.kind === "fuel");

    expect(fuel?.severity).toBe("critical");
    expect(fuel?.whyLine).toContain("about 120 mi usable range (150 mi range − 30 mi reserve)");
    expect(fuel?.whyLine).not.toMatch(/assumption/i);
  });

  it("maps a severe current weather alert to critical", () => {
    const considerations = longTripConsiderations(baseRide, {
      weather: {
        ...baseFacts.weather!,
        alerts: [{ severity: "Severe", event: "Severe Thunderstorm Warning" }],
      },
    });

    expect(considerations).toContainEqual(expect.objectContaining({
      kind: "weather",
      severity: "critical",
      sourceRefs: expect.arrayContaining(["weather:nws:fixture"]),
    }));
  });

  it("downgrades stale threshold-crossing weather to watch and states its age", () => {
    const considerations = longTripConsiderations(baseRide, {
      weather: {
        ...baseFacts.weather!,
        state: "stale",
        fetchedAt: "2026-09-20T10:00:00.000Z",
        maxPrecipChance: 70,
      },
      now: "2026-09-20T13:00:00.000Z",
    });

    expect(considerations).toContainEqual(expect.objectContaining({
      kind: "weather",
      severity: "watch",
    }));
    expect(considerations.find((item) => item.kind === "weather")?.whyLine).toMatch(/180 min old|stale/i);
  });

  it("omits lodging and service when no catalog or road knowledge exists", () => {
    const considerations = longTripConsiderations(baseRide, baseFacts);

    expect(considerations.find((item) => item.kind === "lodging")).toBeUndefined();
    expect(considerations.find((item) => item.kind === "service")).toBeUndefined();
    expect(considerations.find((item) => item.kind === "weather")).toBeUndefined();
  });

  it("uses present catalog facts without inventing establishments", () => {
    const considerations = longTripConsiderations(baseRide, {
      lodging: {
        status: "unknown",
        summary: "No lodging records in the route catalog.",
        source: "route catalog",
        sourceRef: "catalog:route-1:lodging",
      },
      service: {
        status: "gap",
        gapKm: 86,
        summary: "No mapped service point in the next catalog segment.",
        source: "road knowledge",
        sourceRef: "road:segment-2:service",
      },
    });

    expect(considerations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "lodging", severity: "watch", whyLine: expect.stringContaining("unknown") }),
      expect.objectContaining({ kind: "service", severity: "watch", whyLine: expect.stringContaining("53 mi") }),
    ]));
  });

  it("is deterministic for the same ride and facts", () => {
    const first = longTripConsiderations(baseRide, baseFacts);
    const second = longTripConsiderations(baseRide, baseFacts);

    expect(second).toEqual(first);
  });
});

describe("the sun at the rider's own coordinate", () => {
  // A backroads start near Philadelphia: sunrise ~11:00Z, sunset ~23:30Z on
  // 2026-09-21, so each case sits well clear of the horizon crossing.
  const coordinate = { lat: 40.6, lon: -75.4 };

  it("puts sunrise in the morning and sunset in the evening of the same day", () => {
    const sunrise = calculateSunrise(coordinate, "2026-09-21T12:00:00.000Z");
    const sunset = calculateSunset(coordinate, "2026-09-21T12:00:00.000Z");
    if (sunrise === null) throw new Error("expected a sunrise for the fixture coordinate");
    if (sunset === null) throw new Error("expected a sunset for the fixture coordinate");
    expect(Date.parse(sunrise)).toBeLessThan(Date.parse(sunset.sunset));
    expect(Date.parse(sunrise)).toBeGreaterThan(Date.parse("2026-09-21T08:00:00.000Z"));
    expect(Date.parse(sunrise)).toBeLessThan(Date.parse("2026-09-21T13:00:00.000Z"));
  });

  it("reads day and night from the horizon crossings, not from the clock hour", () => {
    expect(sunState(coordinate, Date.parse("2026-09-21T16:00:00.000Z"))).toBe("day");
    // Same evening, after the sun is down.
    expect(sunState(coordinate, Date.parse("2026-09-22T02:00:00.000Z"))).toBe("night");
    // The next morning, before it is up: a ride at 4 AM is still a night ride.
    expect(sunState(coordinate, Date.parse("2026-09-21T08:00:00.000Z"))).toBe("night");
  });

  it("says unknown — never day — where the calculation cannot answer", () => {
    // Polar day: the sun never sets, so there is no crossing to compare against.
    expect(sunState({ lat: 78, lon: 15 }, Date.parse("2026-06-21T12:00:00.000Z"))).toBeNull();
    expect(sunState({ lat: Number.NaN, lon: -75.4 }, Date.parse("2026-09-21T16:00:00.000Z"))).toBeNull();
    expect(sunState(coordinate, Number.NaN)).toBeNull();
  });
});

describe("calculateSunset", () => {
  it("returns a deterministic NOAA-style sunset fact for the route coordinate", () => {
    const sunset = calculateSunset(
      { lat: 40.6, lon: -75.4 },
      "2026-09-20T18:00:00.000Z",
    );

    if (sunset === null) throw new Error("expected a sunset for the fixture coordinate");
    expect(sunset.source).toBe("NOAA solar calculation");
    expect(sunset.sourceRef).toContain("2026-09-20:40.6:-75.4");
    expect(Date.parse(sunset.sunset)).toBeGreaterThan(Date.parse("2026-09-20T22:00:00.000Z"));
    expect(Date.parse(sunset.sunset)).toBeLessThan(Date.parse("2026-09-21T00:00:00.000Z"));
    expect(calculateSunset({ lat: 40.6, lon: -75.4 }, "2026-09-20T18:00:00.000Z")).toEqual(sunset);
  });
});
