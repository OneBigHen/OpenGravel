/**
 * Nearby places: happy hours, bars, restaurants and events a rider can stop at.
 *
 * Places are **cached provider data**, not ride state (AGENTS.md "exactly three
 * ride state authorities"): they never enter a RideDocument, a PlanningSession or
 * a RideSession, and choosing one does not author anything. A rider who wants to
 * stop somewhere adds a stop through the existing typed `stop` commands, using the
 * place's coordinate like any other map tap. That is why these types live in the
 * application layer and not in `src/domain`.
 *
 * The vocabulary is provider-neutral. The first source is sample places provider
 * (`src/infrastructure/places/places-geojson.ts`); a second source maps into the
 * same shape without changing anything above the port.
 */

import type { Coordinate } from "@/domain/ride/types";

/** Stable, source-namespaced identity (`hh:<venue>`, `ev:<event>`). */
export type PlaceId = string & { readonly __brand: "PlaceId" };

export function asPlaceId(value: string): PlaceId {
  return value as PlaceId;
}

export type PlaceKind = "happy_hour" | "event";

/**
 * Where the place is in its day, relative to the provider's clock:
 * `now` (on right now), `later` (later today), `done` (ended earlier today),
 * `day` (browsing another day), `upcoming` (an event that has not started yet).
 */
export type PlaceStatus = "now" | "later" | "done" | "day" | "upcoming";

export interface NearbyPlace {
  readonly id: PlaceId;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly coordinate: Coordinate;
  /** Provider category in its own words ("Sports Bar", "festival"). */
  readonly category: string;
  /** The provider's short label ("Til 10 PM", "Sat 7 PM"). */
  readonly label: string;
  readonly status: PlaceStatus;
  readonly city: string;
  readonly address: string;
  /** Up to five specials, verbatim ("$5 drafts"). Empty for events. */
  readonly specials: readonly string[];
  /** Weekly schedule summary ("Mon–Fri 4–7 PM"), or `null`. */
  readonly schedule: string | null;
  /** Source occurrence times; absent means the source did not give a range. */
  readonly startUtc?: string | null;
  readonly endUtc?: string | null;
  /** IANA zone at the place, supplied by its source rather than guessed by UI. */
  readonly timeZone?: string | null;
  /** 0–5, or `null` when the source has no rating. */
  readonly rating: number | null;
  readonly popular: boolean;
  /** Only an explicit `true` is a claim; `null` means "not known". */
  readonly dogFriendly: boolean | null;
  readonly patio: boolean | null;
  /**
   * Optional per-item provenance from an aggregator such as events.henning.rodeo.
   * These are additive contract fields: older providers may omit them.
   */
  readonly sourceId?: string | null;
  /** The event's own photo (an https URL from the provider), when it has one. */
  readonly imageUrl?: string | null;
  /** Where an event happens, e.g. "Hellerick's Adventure Farm". */
  readonly venue?: string | null;
  readonly sourceLabel?: string | null;
  readonly sourceUrl?: string | null;
  /**
   * Explicit upstream classification only. `true` means the source says this
   * event/place is motorcycle-specific; absent/null means OpenGravel must infer
   * nothing from the omission.
   */
  readonly motorcycleSpecific?: boolean | null;
  /** Normalized provider tags such as `dual-sport`, `adventure`, `park-event`. */
  readonly tags?: readonly string[];
  /** Detail page on the source site; riders are sent here for the full story. */
  readonly url: string;
  /** Directions deep link, or `null`. */
  readonly mapsUrl: string | null;
  /** Along-route answers only: how far off the line, and where along it. */
  readonly offRouteMiles: number | null;
  readonly routeMile: number | null;
}

/** When a rider cares about: right now, the rest of today, or this week. */
export type PlaceWindow = "now" | "today" | "week";

export interface PlaceQuery {
  readonly kinds: readonly PlaceKind[];
  readonly window: PlaceWindow;
}

export const DEFAULT_PLACE_QUERY: PlaceQuery = {
  kinds: ["happy_hour", "event"],
  window: "today",
};

/** WGS84 viewport. */
export interface PlaceExtent {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * A truthful answer. `unavailable` has no places and must never be read as
 * "nothing nearby" (the same rule traffic follows: unknown is not clear).
 */
export type PlacesResult =
  | {
      readonly availability: "available";
      readonly places: readonly NearbyPlace[];
      readonly fetchedAt: string;
      readonly attribution: string;
    }
  | {
      readonly availability: "unavailable";
      readonly places: readonly [];
      readonly reason: string;
      readonly retryable: boolean;
    };

/** The map port's extent vocabulary → the places viewport. */
export function placeExtentFromMap(extent: {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}): PlaceExtent {
  return { west: extent.minLon, south: extent.minLat, east: extent.maxLon, north: extent.maxLat };
}
