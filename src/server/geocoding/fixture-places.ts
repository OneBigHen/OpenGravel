/**
 * The deterministic geocoder the browser gate runs against (`OGV_GEOCODE_FIXTURE=1`),
 * the same pattern as `OGV_ROUTE_PLAN_FIXTURE`: an ordinary deployment never
 * reads it, and the gate can never go red because Photon blinked.
 *
 * Search matches a query against these names (case-insensitive, any word
 * prefix). Reverse names a coordinate only when it lies within
 * `FIXTURE_REVERSE_RADIUS_METERS` of one of them, so a click anywhere else keeps
 * reading "Dropped pin" and the existing placement gates are unaffected.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { PlaceMatch } from "@/application/geocoding/place-search";

export const GEOCODE_FIXTURE_ENV = "OGV_GEOCODE_FIXTURE";
export const FIXTURE_REVERSE_RADIUS_METERS = 1_000;
/** A query containing this word makes the fixture fail like an outage. */
export const FIXTURE_OUTAGE_QUERY = "outage";

function place(id: string, name: string, context: string, lat: number, lon: number): PlaceMatch {
  return {
    id: `fixture:${id}`,
    label: `${name}, ${context.split(", ").at(-1) ?? ""}`.replace(/, $/, ""),
    name,
    context,
    coordinate: { lat, lon },
    provider: "fixture",
  };
}

export const FIXTURE_PLACES: readonly PlaceMatch[] = [
  place("jim-thorpe", "Jim Thorpe", "Carbon County, PA", 40.8757, -75.7324),
  place("hawk-mountain", "Hawk Mountain Sanctuary", "Kempton, Berks County, PA", 40.6348, -75.9913),
  place("hawk-mountain-brewery", "Hawk Mountain Brewery", "Whitehall, Lehigh County, PA", 40.6557, -75.4942),
  place("bethlehem", "Bethlehem", "Northampton County, PA", 40.6259, -75.3705),
  place("easton", "Easton", "Northampton County, PA", 40.6884, -75.2207),
  place("allentown", "Allentown", "Lehigh County, PA", 40.6023, -75.4714),
];

function matches(query: string, candidate: PlaceMatch): boolean {
  const words = `${candidate.name} ${candidate.context}`.toLowerCase().split(/[\s,]+/);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

export function fixtureSearch(query: string): PlaceMatch[] {
  if (query.toLowerCase().includes(FIXTURE_OUTAGE_QUERY)) {
    throw new Error("fixture geocoder outage");
  }
  return FIXTURE_PLACES.filter((candidate) => matches(query, candidate));
}

export function fixtureReverse(coordinate: Coordinate): PlaceMatch | null {
  const nearest = FIXTURE_PLACES.map((candidate) => ({
    candidate,
    distance: haversine(coordinate, candidate.coordinate),
  })).sort((left, right) => left.distance - right.distance)[0];
  if (nearest === undefined || nearest.distance > FIXTURE_REVERSE_RADIUS_METERS) return null;
  return { ...nearest.candidate, coordinate };
}
