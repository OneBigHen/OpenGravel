/**
 * Free Ride ride offers (owner 2026-09-29, OneBigHen/OpenGravel#14): "act like
 * Uber does for drivers — pop up potential routes, see a summary, swipe to
 * accept or skip, so at speed I can judge quickly."
 *
 * Offers are whole rides from where the rider is: a shared route nearby
 * (ridden from here and back), a loop of a set length, or the way home. This
 * module is the pure part: which candidates exist, in what order, what the
 * card says, and when an offer may interrupt. Planning (the real minutes and
 * miles) and binding stay with the return planner and the ride store.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** A shared route the offer deck may propose (from the route catalog). */
export interface OfferCatalogRoute {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly distanceKm: number | null;
  readonly line: readonly Coordinate[];
  readonly curvatureSummary?: string;
  readonly surfaceSummary?: string;
}

export type RideOfferCandidate =
  | { readonly kind: "catalog"; readonly id: string; readonly route: OfferCatalogRoute; readonly joinMeters: number }
  | { readonly kind: "loop"; readonly id: string; readonly minutes: number }
  | { readonly kind: "home"; readonly id: "home"; readonly home: Coordinate; readonly homeMeters: number };

export type RideOfferKind = RideOfferCandidate["kind"];

/** How the rider has answered offers this ride: skipped ids and a per-kind count. */
export interface RideOfferHistory {
  readonly skippedIds: ReadonlySet<string>;
  readonly skipsByKind: Readonly<Partial<Record<RideOfferKind, number>>>;
}

export const EMPTY_OFFER_HISTORY: RideOfferHistory = { skippedIds: new Set(), skipsByKind: {} };

export function recordOfferSkip(history: RideOfferHistory, candidate: RideOfferCandidate): RideOfferHistory {
  return {
    skippedIds: new Set([...history.skippedIds, candidate.id]),
    skipsByKind: { ...history.skipsByKind, [candidate.kind]: (history.skipsByKind[candidate.kind] ?? 0) + 1 },
  };
}

/** Shared routes further than this from the rider are a trip, not an offer. */
export const OFFER_CATALOG_RADIUS_METERS = 40_000;
/** Home closer than this is not worth an offer: the rider knows the way. */
export const OFFER_HOME_MIN_METERS = 8_000;
export const OFFER_LOOP_MINUTES = [45, 90] as const;

/** Metres from `point` to the nearest vertex of `line` (lines are dense enough). */
export function nearestPointMeters(line: readonly Coordinate[], point: Coordinate): number {
  let best = Number.POSITIVE_INFINITY;
  for (const vertex of line) best = Math.min(best, haversine(vertex, point));
  return best;
}

const METERS_PER_MILE = 1_609.344;

/** Catalog curvature reads "34 mi of curves": weigh it against the route's length. */
function curvyWeight(summary: string | undefined, distanceKm: number | null): number {
  const miles = /([\d.]+)\s*mi of curves/i.exec(summary ?? "")?.[1];
  if (miles === undefined || distanceKm === null || distanceKm <= 0) return 0;
  const share = Number(miles) / (distanceKm / 1.609344);
  if (!Number.isFinite(share)) return 0;
  return share >= 0.3 ? 2 : share >= 0.12 ? 1 : share < 0.05 ? -1 : 0;
}

function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const toRadians = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * toRadians) * Math.cos(to.lat * toRadians);
  const x =
    Math.cos(from.lat * toRadians) * Math.sin(to.lat * toRadians) -
    Math.sin(from.lat * toRadians) * Math.cos(to.lat * toRadians) * Math.cos((to.lon - from.lon) * toRadians);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Candidates best first. A shared route scores by how close it is, whether it
 * lies the way the rider is already heading, and how curvy it is; loops fill
 * in between; home comes last unless it is the only thing left. Every skip of
 * a kind pushes that kind further down. Skipped ids never come back.
 */
export function rankRideOffers(input: {
  readonly position: Coordinate;
  readonly headingDegrees: number | null;
  readonly catalog: readonly OfferCatalogRoute[];
  readonly home: Coordinate | null;
  readonly history: RideOfferHistory;
}): readonly RideOfferCandidate[] {
  const { position, headingDegrees, history } = input;
  const scored: { readonly candidate: RideOfferCandidate; readonly score: number }[] = [];
  const kindPenalty = (kind: RideOfferKind): number => (history.skipsByKind[kind] ?? 0) * 25;

  for (const route of input.catalog) {
    if (route.line.length < 2) continue;
    const id = `catalog:${route.id}`;
    if (history.skippedIds.has(id)) continue;
    const joinMeters = nearestPointMeters(route.line, position);
    if (!Number.isFinite(joinMeters) || joinMeters > OFFER_CATALOG_RADIUS_METERS) continue;
    let score = 100 - (joinMeters / 1_000) * 2 + curvyWeight(route.curvatureSummary, route.distanceKm) * 10;
    if (headingDegrees !== null && joinMeters > 500) {
      const nearest = route.line.reduce((best, vertex) =>
        haversine(vertex, position) < haversine(best, position) ? vertex : best);
      const delta = Math.abs(((bearingDegrees(position, nearest) - headingDegrees + 540) % 360) - 180);
      if (delta <= 60) score += 15;
      else if (delta >= 120) score -= 10;
    }
    scored.push({ candidate: { kind: "catalog", id, route, joinMeters }, score: score - kindPenalty("catalog") });
  }

  OFFER_LOOP_MINUTES.forEach((minutes, index) => {
    const id = `loop:${minutes}`;
    if (history.skippedIds.has(id)) return;
    scored.push({ candidate: { kind: "loop", id, minutes }, score: 70 - index * 5 - kindPenalty("loop") });
  });

  if (input.home !== null && !history.skippedIds.has("home")) {
    const homeMeters = haversine(input.home, position);
    if (homeMeters >= OFFER_HOME_MIN_METERS) {
      scored.push({
        candidate: { kind: "home", id: "home", home: input.home, homeMeters },
        score: 20 - kindPenalty("home"),
      });
    }
  }

  return scored
    .sort((first, second) => second.score - first.score || first.candidate.id.localeCompare(second.candidate.id))
    .map((entry) => entry.candidate);
}

export interface RideOfferSummary {
  readonly title: string;
  /** "Shared route · Hawk Mountain", "Loop from here", "Home". */
  readonly kicker: string;
  readonly minutes: number;
  readonly distanceMeters: number;
  /** At most three short facts: "Curvy", "Some gravel", "Back here". */
  readonly chips: readonly string[];
  /** One line for the voice. */
  readonly spoken: string;
}

/** "Mostly paved · 2.5 mi gravel" → "2.5 mi gravel"; "Paved" → "Paved". */
function surfaceChip(summary: string | undefined): string | null {
  if (summary === undefined) return null;
  const unpaved = /([\d.]+\s*mi (?:gravel|dirt))/i.exec(summary)?.[1];
  if (unpaved !== undefined) return unpaved;
  return /paved/i.test(summary) ? "Paved" : null;
}

function curvyChip(route: OfferCatalogRoute): string | null {
  const weight = curvyWeight(route.curvatureSummary, route.distanceKm);
  return weight >= 2 ? "Very curvy" : weight === 1 ? "Curvy" : null;
}

function awayText(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return miles < 0.5 ? "here" : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi away`;
}

/** What the card and the voice say, once the planner has the real route. */
export function summarizeRideOffer(
  candidate: RideOfferCandidate,
  plan: { readonly durationSeconds: number; readonly distanceMeters: number },
): RideOfferSummary {
  const minutes = Math.max(1, Math.round(plan.durationSeconds / 60));
  if (candidate.kind === "catalog") {
    const curvy = curvyChip(candidate.route);
    const chips = [curvy, surfaceChip(candidate.route.surfaceSummary), "Back here"]
      .filter((chip): chip is string => chip !== null)
      .slice(0, 3);
    return {
      title: candidate.route.name,
      kicker: `Shared route · ${awayText(candidate.joinMeters)}`,
      minutes,
      distanceMeters: plan.distanceMeters,
      chips,
      spoken: `New ride: ${candidate.route.name}, ${minutes} minutes${curvy === null ? "" : `, ${curvy.toLowerCase()}`}, back here. Swipe right to take it.`,
    };
  }
  if (candidate.kind === "loop") {
    return {
      title: `${candidate.minutes < 60 ? `${candidate.minutes} min` : `${candidate.minutes / 60} h`} curvy loop`,
      kicker: "Loop from here",
      minutes,
      distanceMeters: plan.distanceMeters,
      chips: ["Curvy", "Back here"],
      spoken: `New ride: a ${minutes} minute curvy loop, back here. Swipe right to take it.`,
    };
  }
  return {
    title: "Head home",
    kicker: "Home",
    minutes,
    distanceMeters: plan.distanceMeters,
    chips: ["Ends at home"],
    spoken: `Home is ${minutes} minutes away. Swipe right to head home.`,
  };
}

/** When an offer may appear and how long it stays (the Uber countdown). */
export interface RideOfferTiming {
  readonly mayOffer: boolean;
  /** How long this offer stays up before it counts as a skip. */
  readonly lifetimeMs: number;
}

/** Below this the rider is stopped: offers come quickly and wait longer. */
export const OFFER_STOPPED_SPEED_MPS = 2;
export const OFFER_MOVING_COOLDOWN_MS = 180_000;
export const OFFER_STOPPED_COOLDOWN_MS = 8_000;
export const OFFER_MOVING_LIFETIME_MS = 20_000;
export const OFFER_STOPPED_LIFETIME_MS = 60_000;

export function rideOfferTiming(input: {
  readonly speedMps: number | null;
  readonly nowMs: number;
  readonly lastOfferEndedAtMs: number | null;
  /** The rider asked for an offer: no cooldown. */
  readonly requested: boolean;
}): RideOfferTiming {
  const stopped = input.speedMps === null || input.speedMps < OFFER_STOPPED_SPEED_MPS;
  const lifetimeMs = stopped ? OFFER_STOPPED_LIFETIME_MS : OFFER_MOVING_LIFETIME_MS;
  if (input.requested || input.lastOfferEndedAtMs === null) return { mayOffer: true, lifetimeMs };
  const cooldown = stopped ? OFFER_STOPPED_COOLDOWN_MS : OFFER_MOVING_COOLDOWN_MS;
  return { mayOffer: input.nowMs - input.lastOfferEndedAtMs >= cooldown, lifetimeMs };
}

/** Parses `/api/catalog` routes into offer routes; anything malformed is dropped. */
export function parseOfferCatalog(payload: unknown): readonly OfferCatalogRoute[] {
  const routes = (payload as { readonly routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes)) return [];
  return routes.flatMap((value): OfferCatalogRoute[] => {
    if (typeof value !== "object" || value === null) return [];
    const route = value as Record<string, unknown>;
    if (typeof route.id !== "string" || typeof route.name !== "string" || !Array.isArray(route.preview)) return [];
    const line = route.preview.flatMap((point): Coordinate[] => {
      const candidate = point as { readonly lon?: unknown; readonly lat?: unknown } | null;
      return typeof candidate?.lon === "number" && typeof candidate.lat === "number" &&
        Number.isFinite(candidate.lon) && Number.isFinite(candidate.lat)
        ? [{ lon: candidate.lon, lat: candidate.lat }]
        : [];
    });
    if (line.length < 2) return [];
    return [{
      id: route.id,
      name: route.name,
      region: typeof route.region === "string" ? route.region : "",
      distanceKm: typeof route.distanceKm === "number" && Number.isFinite(route.distanceKm) ? route.distanceKm : null,
      line,
      ...(typeof route.curvatureSummary === "string" ? { curvatureSummary: route.curvatureSummary } : {}),
      ...(typeof route.surfaceSummary === "string" ? { surfaceSummary: route.surfaceSummary } : {}),
    }];
  });
}
