import { calculateSunset, longTripConsiderations, type LongTripFacts, type LongTripRide } from "./index";
import type { RoutePreparation } from "@/application/preparation/prepare-route";

const FIXTURE_DEPARTURE = "2026-09-20T18:00:00.000Z";
const FIXTURE_SUNSET = calculateSunset({ lat: 40.6, lon: -75.4 }, FIXTURE_DEPARTURE);

const FIXTURE_FACTS: LongTripFacts = {
  now: "2026-09-20T13:00:00.000Z",
  daylight: {
    sunset: FIXTURE_SUNSET?.sunset ?? "",
    source: FIXTURE_SUNSET?.source ?? "NOAA solar calculation",
    sourceRef: FIXTURE_SUNSET?.sourceRef ?? "fixture:daylight:solar",
  },
  weather: {
    state: "ready",
    fetchedAt: "2026-09-20T12:30:00.000Z",
    source: "weather service",
    sourceRef: "fixture:weather:service",
    maxPrecipChance: 70,
    alerts: [],
  },
  lodging: {
    status: "unknown",
    summary: "No lodging records in this fixture catalog.",
    source: "fixture catalog",
    sourceRef: "fixture:catalog:lodging",
  },
  service: {
    status: "gap",
    gapKm: 86,
    summary: "No mapped service point in this fixture segment.",
    source: "fixture road knowledge",
    sourceRef: "fixture:road:service",
  },
};

export function longTripFixturePreparation(long: boolean): RoutePreparation {
  const ride: LongTripRide = long
    ? { distanceKm: 300, durationMinutes: 360, departure: FIXTURE_DEPARTURE, bike: null }
    : { distanceKm: 27.5, durationMinutes: 32.1, departure: "2026-09-20T13:00:00.000Z", bike: null };
  return {
    items: [],
    capabilities: [],
    registeredProviderCount: 1,
    considerations: long ? longTripConsiderations(ride, FIXTURE_FACTS) : [],
  };
}
