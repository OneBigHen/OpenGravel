/** Typed, provider-grounded stop searches and ranking for advisor proposals. */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate, StopPoint } from "@/domain/ride/types";
import { newCommandId, newStopId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";
import type { NearbyPlace, PlaceCategory } from "@/application/places";

export type AdvisorRoutePosition = "along-route" | "halfway" | "near-end" | "destination";

/** One ordered search request extracted from the rider's words. */
export interface AdvisorStopSearchRequest {
  readonly category: PlaceCategory;
  /** A named town/area supplied by the rider, or `null` for the whole route. */
  readonly vicinity: string | null;
  readonly routePosition: AdvisorRoutePosition;
}

/** A category result with only provider-supplied quality facts attached. */
export interface AdvisorStopCandidate {
  readonly place: NearbyPlace;
  readonly sourceLabel: string;
  readonly detourMinutesEstimate: number | null;
  readonly score: number;
  readonly qualityEvidence?: {
    readonly rating?: number;
    readonly reviewCount?: number;
  };
}

export interface AdvisorStopSearchProposal {
  readonly request: AdvisorStopSearchRequest;
  readonly candidates: readonly AdvisorStopCandidate[];
  readonly sourceLabel: string;
  readonly unavailableReason?: string;
}

export const ADVISOR_STOP_CATEGORY_LABELS: Readonly<Record<PlaceCategory, string>> = {
  brewery: "Brewery",
  coffee: "Coffee",
  diner: "Diner",
  restaurant: "Restaurant",
};

export const ADVISOR_ROUTE_POSITION_LABELS: Readonly<Record<AdvisorRoutePosition, string>> = {
  "along-route": "Along the route",
  halfway: "Around halfway",
  "near-end": "Near the end",
  destination: "At the destination",
};

export function routeLengthMiles(line: readonly Coordinate[]): number {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) {
    const previous = line[index - 1];
    const current = line[index];
    if (previous !== undefined && current !== undefined) meters += haversine(previous, current);
  }
  return meters / 1609.344;
}

function fitsPosition(place: NearbyPlace, request: AdvisorStopSearchRequest, routeMiles: number): boolean {
  const mile = place.routeMile;
  if (request.routePosition === "along-route") return true;
  if (mile === null || !Number.isFinite(mile) || routeMiles <= 0) return false;
  const progress = mile / routeMiles;
  switch (request.routePosition) {
    case "halfway": return progress >= 0.3 && progress <= 0.7;
    case "near-end": return progress >= 0.65 && progress <= 1.05;
    case "destination": return progress >= 0.8 && progress <= 1.05;
  }
}

function matchesCategory(place: NearbyPlace, category: PlaceCategory): boolean {
  if (place.kind === "event") return false;
  const value = place.category.toLocaleLowerCase();
  switch (category) {
    case "brewery": return /brewery|brewpub/.test(value);
    case "coffee": return /coffee|cafe|café|coffeehouse/.test(value);
    case "diner": return /diner/.test(value);
    case "restaurant": return /restaurant|diner|eatery/.test(value);
  }
}

function matchesVicinity(place: NearbyPlace, vicinity: string | null): boolean {
  if (vicinity === null) return true;
  const haystack = `${place.name} ${place.city} ${place.address}`.toLocaleLowerCase();
  const locality = vicinity.split(",")[0] ?? vicinity;
  const words = locality.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1 && !["near", "around", "the", "in", "by"].includes(word));
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

function candidateScore(
  place: NearbyPlace,
  routeDurationMinutes: number,
  timeBudgetMinutes: number | null,
): { readonly score: number; readonly detourMinutesEstimate: number | null } {
  // The provider only gives distance off the line, not a turn-by-turn detour.
  // A conservative, explicitly labelled out-and-back time estimate uses 24 mph.
  const detourMinutesEstimate = place.offRouteMiles !== null && Number.isFinite(place.offRouteMiles)
    ? Math.max(0, place.offRouteMiles) * 5
    : null;
  const rating = place.rating !== null && Number.isFinite(place.rating) ? place.rating : null;
  const reviewCount = place.reviewCount !== undefined && place.reviewCount !== null && Number.isFinite(place.reviewCount)
    ? Math.max(0, place.reviewCount)
    : null;
  const ratingPoints = rating === null ? 0 : rating * 2;
  const reviewPoints = reviewCount === null ? 0 : Math.min(2, Math.log10(reviewCount + 1));
  const detourPenalty = detourMinutesEstimate === null ? 5 : detourMinutesEstimate * 0.4;
  const remainingBudget = timeBudgetMinutes === null ? null : Math.max(0, timeBudgetMinutes - routeDurationMinutes);
  const budgetPenalty = remainingBudget === null || detourMinutesEstimate === null
    ? 0
    : Math.max(0, detourMinutesEstimate - remainingBudget) * 1.5;
  return { score: ratingPoints + reviewPoints - detourPenalty - budgetPenalty, detourMinutesEstimate };
}

/** Filters by the requested route position and sorts on disclosed facts only. */
export function rankAdvisorStopCandidates(input: {
  readonly request: AdvisorStopSearchRequest;
  readonly places: readonly NearbyPlace[];
  readonly attribution: string;
  readonly routeMiles: number;
  readonly routeDurationMinutes: number;
  readonly timeBudgetMinutes?: number | null;
  readonly limit?: number;
}): readonly AdvisorStopCandidate[] {
  const candidates = input.places
    .filter((place) => matchesCategory(place, input.request.category))
    .filter((place) => matchesVicinity(place, input.request.vicinity))
    .filter((place) => fitsPosition(place, input.request, input.routeMiles))
    .map((place) => {
      const scored = candidateScore(place, input.routeDurationMinutes, input.timeBudgetMinutes ?? null);
      const qualityEvidence = {
        ...(place.rating === null ? {} : { rating: place.rating }),
        ...(place.reviewCount === undefined || place.reviewCount === null ? {} : { reviewCount: place.reviewCount }),
      };
      return {
        place,
        sourceLabel: place.sourceLabel?.trim() || input.attribution,
        detourMinutesEstimate: scored.detourMinutesEstimate,
        score: scored.score,
        ...(Object.keys(qualityEvidence).length === 0 ? {} : { qualityEvidence }),
      } satisfies AdvisorStopCandidate;
    })
    .sort((left, right) => right.score - left.score || (left.place.routeMile ?? Infinity) - (right.place.routeMile ?? Infinity));
  return candidates.slice(0, Math.max(1, Math.trunc(input.limit ?? 6)));
}

/** Turns an explicit ordered rider selection into one undoable domain command. */
export function buildAdvisorStopSelectionCommand(
  document: RideDocument,
  selected: readonly AdvisorStopCandidate[],
  requestCount: number,
): Extract<import("@/domain/ride/commands").RideCommand, { type: "proposal.apply" }> | null {
  if (selected.length === 0 || selected.length > requestCount || selected.some((item) => item.place.kind === "event")) return null;
  const operations = selected.map(({ place }) => {
    const stop: StopPoint = {
      id: newStopId(),
      kind: "stop",
      coordinate: place.coordinate,
      label: place.city.trim() === "" || place.name.includes(place.city) ? place.name : `${place.name}, ${place.city}`,
      arrivalIntent: /brewery/i.test(place.category) ? "visit" : "food",
      provenance: { type: "search", provider: place.sourceId ?? "places", placeId: place.id, query: place.category },
    };
    return {
      type: "stop.insert" as const,
      commandId: newCommandId(),
      rideId: document.rideId,
      baseRevision: document.revision,
      source: "rider" as const,
      label: `Add ${place.name}`,
      stop,
    };
  });
  return {
    type: "proposal.apply",
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "rider",
    label: "Add selected stops",
    proposalId: `advisor_stops_${newCommandId()}`,
    operations,
  };
}
