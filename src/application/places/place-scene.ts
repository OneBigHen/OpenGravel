/**
 * Places → what the map draws and what the card says.
 *
 * Pure projection, no renderer vocabulary: the MapLibre host (or any other)
 * turns `PlaceScene` into pills, and the UI turns `PlaceCardModel` into a sheet.
 * The pill carries the one fact a rider chooses by — the cheapest special, or
 * the time — the way a listings map shows a price.
 */

import type { NearbyPlace, PlaceId } from "./types";

/** How loud a pill is: on now, later today / upcoming, or finished. */
export type PlaceTone = "live" | "soon" | "quiet";

export interface PlaceScene {
  readonly id: PlaceId;
  /**
   * `NearbyPlace["kind"]` for a places-provider pin, or a namespaced string
   * for anything else drawn through this same pill layer (ride-interest
   * points, OGV#13). Never read by a MapLibre expression — the map styles a
   * pin by `tone`, not `kind` — so widening it here cannot change a pixel.
   */
  readonly kind: NearbyPlace["kind"] | (string & {});
  readonly coordinate: NearbyPlace["coordinate"];
  /** Short pill text ("$3 · til 10p", "4–7p", "Sat 7p"). */
  readonly pill: string;
  readonly tone: PlaceTone;
  /** Higher draws on top and survives density thinning first. */
  readonly priority: number;
  readonly selected: boolean;
}

export interface PlaceCardModel {
  readonly id: PlaceId;
  readonly title: string;
  /** "On now · until 10 PM", "Today 4–7 PM", "Sat, 7 PM". */
  readonly when: string;
  readonly eventTime: string | null;
  readonly updated: string | null;
  readonly live: boolean;
  /** "Sports Bar · Bridgeport · 0.4 mi off route · mile 42". */
  readonly meta: string;
  readonly specials: readonly string[];
  /** "★ 4.4 · Patio · Dogs OK". */
  readonly perks: string;
  readonly detailUrl: string;
  readonly directionsUrl: string | null;
}

function localInstant(iso: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!iso || !timeZone) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}

const PRICE = /\$\s?(\d{1,3}(?:\.\d{2})?)/g;

function cheapestSpecialEntry(specials: readonly string[]): { readonly amount: number; readonly line: string } | null {
  let best: { readonly amount: number; readonly line: string } | null = null;
  for (const special of specials) {
    for (const match of special.matchAll(PRICE)) {
      const value = Number.parseFloat(match[1] ?? "");
      if (value > 0 && (best === null || value < best.amount)) best = { amount: value, line: special };
    }
  }
  return best;
}

/** The cheapest "$N" across the specials, formatted for a pill ("$3", "$4.50"). */
export function cheapestSpecial(specials: readonly string[]): string | null {
  const best = cheapestSpecialEntry(specials);
  if (best === null) return null;
  return Number.isInteger(best.amount) ? `$${best.amount}` : `$${best.amount.toFixed(2)}`;
}

/** The full special line carrying the lowest price, or `null` when there is none. */
export function cheapestSpecialLine(specials: readonly string[]): string | null {
  return cheapestSpecialEntry(specials)?.line ?? null;
}

/** "10 PM" → "10p", "11:30 AM" → "11:30a". Unknown shapes pass through. */
export function compactTime(label: string): string {
  return label.replace(/:00(?=\s?[AP]M)/i, "").replace(/\s?([AP])M\b/i, (_, meridiem: string) => meridiem.toLowerCase());
}

/** Longest venue name a pill shows before it is shortened. */
const PILL_NAME_MAX = 16;

/**
 * The venue's name, short enough for a map pill: the first clause of names like
 * "North Ridge Cafe Bar and Taproom", then cut at a word with an ellipsis.
 */
function shortName(name: string): string {
  const first = name.split(/\s+(?:&|and|-|–|—|\|)\s+|\s*[,(:]\s*/i)[0]?.trim() ?? name;
  if (first.length <= PILL_NAME_MAX) return first;
  const cut = first.slice(0, PILL_NAME_MAX);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 6 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/**
 * The pill: who, then the one fact a rider chooses by (UX rework). Without the
 * name a map of "4–6p" pills says when but never where you would be going.
 */
function pillFor(place: NearbyPlace): string {
  const who = shortName(place.name);
  if (place.kind === "event") return `${who} · ${compactTime(place.label)}`;
  const price = cheapestSpecial(place.specials);
  const time = place.status === "now"
    ? compactTime(place.label).replace(/^Til /i, "til ")
    : compactTime(place.label);
  return price === null ? `${who} · ${time}` : `${who} · ${price} · ${time}`;
}

function toneFor(place: NearbyPlace): PlaceTone {
  if (place.status === "now") return "live";
  if (place.status === "done") return "quiet";
  return "soon";
}

function priorityFor(place: NearbyPlace): number {
  const tone = toneFor(place);
  let score = tone === "live" ? 300 : tone === "soon" ? 200 : 0;
  if (place.kind === "happy_hour") score += 20;
  if (place.popular) score += 15;
  if (place.specials.length > 0) score += 10;
  if (place.rating !== null) score += place.rating;
  return score;
}

export interface PlaceSceneOptions {
  readonly selectedId?: PlaceId | null;
  /** Cap on pills; the lowest-priority places are thinned first. */
  readonly maxPills?: number;
  /** Drop happy hours that already ended today (default true). */
  readonly hideFinished?: boolean;
}

export const DEFAULT_MAX_PILLS = 150;

export function buildPlaceScene(
  places: readonly NearbyPlace[],
  options: PlaceSceneOptions = {},
): readonly PlaceScene[] {
  const hideFinished = options.hideFinished ?? true;
  const selectedId = options.selectedId ?? null;
  const seen = new Set<string>();
  const scene: PlaceScene[] = [];
  for (const place of places) {
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    if (hideFinished && place.status === "done" && place.id !== selectedId) continue;
    scene.push({
      id: place.id,
      kind: place.kind,
      coordinate: place.coordinate,
      pill: pillFor(place),
      tone: toneFor(place),
      priority: priorityFor(place) + (place.id === selectedId ? 1000 : 0),
      selected: place.id === selectedId,
    });
  }
  scene.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  return scene.slice(0, options.maxPills ?? DEFAULT_MAX_PILLS);
}

function whenLine(place: NearbyPlace): string {
  if (place.kind === "event") return place.status === "now" ? "Happening now" : place.label;
  if (place.status === "now") return `On now · ${place.label.replace(/^Til /i, "until ")}`;
  if (place.status === "done") return `Ended today · ${place.schedule ?? place.label}`;
  return `Today ${place.label}`;
}

export function buildPlaceCard(place: NearbyPlace, fetchedAt: string | null = null): PlaceCardModel {
  const meta = [
    place.category,
    place.city,
    place.offRouteMiles === null ? "" : place.offRouteMiles < 0.1 ? "on your route" : `${place.offRouteMiles.toFixed(1)} mi off route`,
    place.routeMile === null ? "" : `mile ${Math.round(place.routeMile)}`,
  ].filter((part) => part !== "");
  const perks = [
    place.rating === null ? "" : `★ ${place.rating.toFixed(1)}`,
    place.patio === true ? "Patio" : "",
    place.dogFriendly === true ? "Dogs OK" : "",
    place.popular ? "Popular" : "",
  ].filter((part) => part !== "");
  return {
    id: place.id,
    title: place.name,
    when: whenLine(place),
    eventTime: place.kind !== "event" ? null : (() => {
      const start = localInstant(place.startUtc, place.timeZone);
      if (start === null) return null;
      const end = localInstant(place.endUtc, place.timeZone);
      return end === null ? `${start} · End time not listed` : `${start} – ${end}`;
    })(),
    updated: (() => {
      const local = localInstant(fetchedAt, place.timeZone);
      return local === null ? null : `Updated ${local}`;
    })(),
    live: place.status === "now",
    meta: meta.join(" · "),
    specials: place.specials.slice(0, 3),
    perks: perks.join(" · "),
    detailUrl: place.url,
    directionsUrl: place.mapsUrl,
  };
}
