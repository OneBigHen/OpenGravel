import "server-only";

import type { CatalogEntry } from "@/application/explore/catalog";
import { US_STATES } from "@/application/geocoding/us-states";
import { decodeLine, splitSegments } from "@/application/route-library/geometry";
import type { RideDetail } from "@/application/route-library/types";

import { packRide, type PackRide } from "./pack";

const KM_PER_MILE = 1.609344;
const STATE_NAMES: ReadonlyMap<string, string> = new Map(Object.entries(US_STATES).map(([name, code]) => [code, name]));

function regionFor(states: readonly string[]): string {
  const names = states.map((state) => STATE_NAMES.get(state)).filter((name): name is string => name !== undefined);
  if (names.length === 0) return "Across the United States";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function libraryProvenanceDetail(detail: Pick<RideDetail, "credit" | "track">): string {
  const year = detail.track.year === null ? "undated" : String(detail.track.year);
  return `Source track from ${detail.credit.sourceName} (${year}). Not checked against today's roads, closures or surface.`;
}

/**
 * A library ride shaped as a catalog entry, so the existing ride page can show
 * it. The line is a reference: a rough track, a trail bundle or a ride with no
 * line comes back with empty geometry rather than a guessed one.
 */
export function entryFromPackRide(ride: PackRide): CatalogEntry {
  const { detail } = ride;
  const drawable = ride.line !== "" && !detail.track.rough && detail.kind !== "area";
  const geometry = drawable ? splitSegments(ride.line).flatMap(decodeLine) : [];
  return {
    id: detail.id,
    source: "catalog",
    name: detail.name,
    region: regionFor(detail.states),
    summary: detail.summary,
    distanceKm: detail.miles === null ? null : Math.round(detail.miles * KM_PER_MILE * 100) / 100,
    bounds: detail.bounds,
    geometry,
    provenance: detail.credit.sourceName,
    credit: {
      author: detail.credit.author,
      sourceName: detail.credit.sourceName,
      sourceUrl: detail.credit.sourceUrl,
    },
    provenanceDetail: libraryProvenanceDetail(detail),
    ...(detail.facts.surface.value === "paved" ? { surfaceSummary: "Paved" } : {}),
    referenceTrack: true,
  };
}

/** The library ride for an id, or `null` when there is no pack or no such ride. */
export function libraryRideAsCatalogEntry(id: string): CatalogEntry | null {
  const ride = packRide(id);
  return ride === null ? null : entryFromPackRide(ride);
}
