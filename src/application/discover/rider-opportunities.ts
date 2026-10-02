import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { InterestingPlace } from "./types";
import type { NearbyPlace } from "@/application/places/types";

export type RiderOpportunityKind = "event" | "happy-hour" | "place";

export interface RiderOpportunity {
  readonly id: string;
  readonly kind: RiderOpportunityKind;
  readonly name: string;
  readonly category: string;
  readonly coordinate: Coordinate;
  readonly description: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly url: string | null;
  readonly sourceLabel: string;
  readonly popular: boolean;
  readonly rating: number | null;
  readonly distanceMeters: number | null;
  readonly distanceFromRouteMeters: number | null;
  readonly detourMinutes: number | null;
  readonly routeMile: number | null;
  readonly score: number;
  readonly reason: string;
}

export interface RiderOpportunityRankContext {
  readonly now: string;
  readonly center?: Coordinate;
  readonly routeAware: boolean;
  readonly limit?: number;
  /** Provider label for Places-contract entries; defaults to the rider events service. */
  readonly placesSourceLabel?: string;
}

const PLACE_PRIOR: Readonly<Record<string, number>> = {
  waterfall: 1.15,
  bridge: 1.05,
  viewpoint: 1.05,
  quirky: 1,
  ruins: 0.95,
  scenic: 0.85,
  museum: 0.75,
  history: 0.7,
  architecture: 0.65,
  nature: 0.65,
  recreation: 0.55,
  roadside: 0.55,
  "public-art": 0.5,
  camping: 0.45,
  event: 0.8,
};

function eventUrgency(startsAt: string | null, endsAt: string | null, now: number): number {
  if (startsAt === null) return 0;
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return 0;
  const end = endsAt === null ? null : Date.parse(endsAt);
  if (start <= now && (end === null || !Number.isFinite(end) || now < end)) return 1.1;
  if (end !== null && Number.isFinite(end) && end <= now) return -1.2;
  const hours = (start - now) / 3_600_000;
  if (hours <= 12) return 1;
  if (hours <= 48) return 0.8;
  if (hours <= 7 * 24) return 0.5;
  return 0.1;
}

function routeCost(detourMinutes: number | null, offRouteMeters: number | null): number {
  if (detourMinutes !== null) {
    if (detourMinutes <= 3) return 0.75;
    if (detourMinutes <= 8) return 0.45;
    if (detourMinutes <= 15) return 0.1;
    if (detourMinutes <= 25) return -0.45;
    return -1.1;
  }
  if (offRouteMeters !== null) return -Math.min(1, offRouteMeters / 16_000);
  return -0.35;
}

/**
 * A ride destination has a broad sweet spot: "nearest" is not synonymous with
 * "worth riding to." Very distant items lose some value, but a 30–80 mile
 * destination is not penalized merely for being a ride away.
 */
function destinationDistanceTerm(distanceMeters: number | null): number {
  if (distanceMeters === null) return 0;
  const miles = distanceMeters / 1609.344;
  if (miles < 5) return 0.1;
  if (miles <= 25) return 0.35;
  if (miles <= 80) return 0.45;
  if (miles <= 120) return 0.1;
  return -0.5;
}

function reasonFor(input: {
  readonly kind: RiderOpportunityKind;
  readonly popular: boolean;
  readonly routeAware: boolean;
  readonly detourMinutes: number | null;
  readonly startsAt: string | null;
  readonly now: number;
}): string {
  if (input.routeAware && input.detourMinutes !== null) {
    if (input.detourMinutes <= 3) return "Nearly on your route";
    if (input.detourMinutes <= 10) return `About a ${input.detourMinutes} min detour`;
  }
  if (input.startsAt !== null) {
    const hours = (Date.parse(input.startsAt) - input.now) / 3_600_000;
    if (Number.isFinite(hours) && hours >= 0 && hours <= 48) return "Happening soon";
  }
  if (input.popular) return "Popular stop";
  if (input.kind === "place") return "Worth the ride";
  return "Good rider stop";
}

function scoreOf(
  opportunity: Omit<RiderOpportunity, "score" | "reason">,
  context: RiderOpportunityRankContext,
): number {
  const now = Date.parse(context.now);
  let score = opportunity.kind === "event"
    ? 1.2
    : opportunity.kind === "happy-hour"
      ? 0.75
      : PLACE_PRIOR[opportunity.category] ?? 0.55;

  if (opportunity.popular) score += 0.75;
  if (opportunity.rating !== null) {
    if (opportunity.rating >= 4.7) score += 0.55;
    else if (opportunity.rating >= 4.4) score += 0.35;
    else if (opportunity.rating >= 4) score += 0.15;
  }
  if (opportunity.kind === "event") {
    score += eventUrgency(opportunity.startsAt, opportunity.endsAt, now);
  } else if (opportunity.kind === "happy-hour") {
    score += eventUrgency(opportunity.startsAt, opportunity.endsAt, now) * 0.4;
  }
  score += context.routeAware
    ? routeCost(opportunity.detourMinutes, opportunity.distanceFromRouteMeters)
    : destinationDistanceTerm(opportunity.distanceMeters);
  return Number(score.toFixed(3));
}

export function opportunityFromNearbyPlace(
  place: NearbyPlace,
  context: RiderOpportunityRankContext,
): RiderOpportunity {
  const distanceMeters = context.center === undefined ? null : Math.round(haversine(context.center, place.coordinate));
  const offRouteMeters = place.offRouteMiles === null ? null : Math.round(place.offRouteMiles * 1609.344);
  // Provider-supplied route offsets are more useful than inventing a drive time.
  const detourMinutes = offRouteMeters === null ? null : Math.max(1, Math.round((2 * offRouteMeters) / (40_000 / 3_600) / 60));
  const base = {
    id: `place:${place.id}`,
    kind: place.kind === "event" ? "event" as const : "happy-hour" as const,
    name: place.name,
    category: place.category,
    coordinate: place.coordinate,
    description: place.specials[0] ?? place.schedule ?? place.label ?? null,
    startsAt: place.startUtc ?? null,
    endsAt: place.endUtc ?? null,
    url: place.url,
    sourceLabel: context.placesSourceLabel ?? "events.henning.rodeo",
    popular: place.popular,
    rating: place.rating,
    distanceMeters,
    distanceFromRouteMeters: offRouteMeters,
    detourMinutes,
    routeMile: place.routeMile,
  };
  const score = scoreOf(base, context);
  return {
    ...base,
    score,
    reason: reasonFor({
      kind: base.kind,
      popular: base.popular,
      routeAware: context.routeAware,
      detourMinutes,
      startsAt: base.startsAt,
      now: Date.parse(context.now),
    }),
  };
}

export function opportunityFromInterestingPlace(
  place: InterestingPlace,
  context: RiderOpportunityRankContext,
): RiderOpportunity {
  const distanceMeters = place.distanceMeters
    ?? (context.center === undefined ? null : Math.round(haversine(context.center, place.coordinate)));
  const base = {
    id: `discover:${place.id}`,
    kind: "place" as const,
    name: place.name,
    category: place.category,
    coordinate: place.coordinate,
    description: place.description,
    startsAt: null,
    endsAt: place.validUntil ?? null,
    url: place.provenance[0]?.url ?? null,
    sourceLabel: place.provenance[0]?.sourceLabel ?? "OpenGravel Discover",
    popular: place.provenance.length > 1 || place.wikidataId !== null,
    rating: null,
    distanceMeters,
    distanceFromRouteMeters: place.distanceFromRouteMeters ?? null,
    detourMinutes: place.detourMinutes ?? null,
    routeMile: null,
  };
  const score = scoreOf(base, context);
  return {
    ...base,
    score,
    reason: reasonFor({
      kind: base.kind,
      popular: base.popular,
      routeAware: context.routeAware,
      detourMinutes: base.detourMinutes,
      startsAt: null,
      now: Date.parse(context.now),
    }),
  };
}

const KIND_CAP: Readonly<Record<RiderOpportunityKind, number>> = {
  // Events are useful trip hooks, but this is a rider feed rather than an event
  // directory. Three is enough to surface a strong weekend without drowning
  // roads, viewpoints and destination stops.
  event: 3,
  "happy-hour": 2,
  place: 5,
};

/**
 * Minimal by design: a few varied, high-value ideas. Repeated categories are
 * penalized, and each broad kind has a cap so a dense event feed cannot bury
 * scenic stops or vice versa.
 */
export function rankRiderOpportunities(
  opportunities: readonly RiderOpportunity[],
  limit = 9,
): readonly RiderOpportunity[] {
  const remaining = [...opportunities]
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const selected: RiderOpportunity[] = [];
  const kindCount = new Map<RiderOpportunityKind, number>();
  const categoryCount = new Map<string, number>();

  while (remaining.length > 0 && selected.length < Math.max(1, Math.min(limit, 12))) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    remaining.forEach((item, index) => {
      if ((kindCount.get(item.kind) ?? 0) >= KIND_CAP[item.kind]) return;
      const repeat = categoryCount.get(item.category) ?? 0;
      const adjusted = item.score - repeat * 0.45;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) break;
    const [chosen] = remaining.splice(bestIndex, 1);
    if (chosen === undefined) break;
    selected.push(chosen);
    kindCount.set(chosen.kind, (kindCount.get(chosen.kind) ?? 0) + 1);
    categoryCount.set(chosen.category, (categoryCount.get(chosen.category) ?? 0) + 1);
  }
  return selected;
}
