/**
 * Discover: interesting places near a rider, a route or a destination.
 *
 * Providers (OSM, Wikipedia/Wikidata/Commons, later RIDB, iNaturalist,
 * events) normalize into this one OpenGravel-owned model; React never sees a
 * provider payload. Discovery is never a routing authority: a place changes a
 * ride only when the rider adds it (`discovery-commands.ts`).
 */

import type { Coordinate } from "@/domain/ride/types";

/** The bounded taxonomy every provider maps into. */
export const DISCOVER_CATEGORIES = [
  "quirky",
  "history",
  "scenic",
  "nature",
  "architecture",
  "ruins",
  "roadside",
  "viewpoint",
  "waterfall",
  "bridge",
  "museum",
  "public-art",
  "recreation",
  "camping",
  "event",
] as const;

export type DiscoverCategory = (typeof DISCOVER_CATEGORIES)[number];

export const DISCOVER_CATEGORY_LABELS: Readonly<Record<DiscoverCategory, string>> = {
  quirky: "Unusual",
  history: "History",
  scenic: "Scenic",
  nature: "Nature",
  architecture: "Architecture",
  ruins: "Ruins",
  roadside: "Roadside stop",
  viewpoint: "Viewpoint",
  waterfall: "Waterfall",
  bridge: "Bridge",
  museum: "Museum",
  "public-art": "Public art",
  recreation: "Recreation",
  camping: "Camping",
  event: "Event",
};

/** A picture with what its licence requires us to show. */
export interface PlaceImage {
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  /** Where the rider can see the original and its licence. */
  readonly pageUrl: string;
  /** Plain-text author credit, as the source states it. */
  readonly author: string | null;
  /** e.g. "CC BY-SA 4.0", "Public domain". */
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly attributionRequired: boolean;
}

/** One source's contribution to a place, for inspectable provenance. */
export interface PlaceProvenance {
  readonly sourceId: string;
  readonly sourceLabel: string;
  /** The provider-qualified id, e.g. "osm:w123", "wikipedia:en:Ringing_Rocks_Park". */
  readonly recordId: string;
  readonly url: string | null;
  readonly retrievedAt: string;
}

/** Structured facts a card may show; each is optional and never invented. */
export interface PlaceFacts {
  readonly builtYear?: number;
  readonly heritage?: readonly string[];
  readonly instanceOf?: readonly string[];
  readonly creator?: string;
  readonly elevationMeters?: number;
}

export interface InterestingPlace {
  /** Stable, provider-qualified; a merged place keeps its best source's id. */
  readonly id: string;
  readonly name: string;
  readonly category: DiscoverCategory;
  readonly categories: readonly DiscoverCategory[];
  readonly coordinate: Coordinate;
  /** One or two plain sentences, or null. Never provider HTML. */
  readonly description: string | null;
  readonly image: PlaceImage | null;
  readonly wikidataId: string | null;
  readonly facts: PlaceFacts;
  readonly tags: readonly string[];
  /** For time-bound places (events): when it stops being relevant. */
  readonly validUntil?: string;
  /** 0..1: how sure the sources are this is a real, notable place. */
  readonly confidence: number;
  readonly provenance: readonly PlaceProvenance[];
  /** Filled by the coordinator for the query's anchor. */
  readonly distanceMeters?: number;
  /** Corridor queries: how far off the route line. */
  readonly distanceFromRouteMeters?: number;
  /** A rough out-and-back estimate; labelled as an estimate in the UI. */
  readonly detourMinutes?: number;
}

/** The areas a source is asked about: a few bounded circles, never a polyline walk. */
export interface DiscoverSearchArea {
  readonly samples: readonly { readonly center: Coordinate; readonly radiusMeters: number }[];
}

export type DiscoverQuery =
  | { readonly kind: "near"; readonly center: Coordinate; readonly radiusMeters: number }
  | { readonly kind: "corridor"; readonly line: readonly Coordinate[]; readonly bufferMeters: number }
  | { readonly kind: "destination"; readonly center: Coordinate; readonly radiusMeters: number };

export interface DiscoverRequest {
  readonly query: DiscoverQuery;
  /** Only these categories; empty or absent means all. */
  readonly categories?: readonly DiscoverCategory[];
  readonly limit?: number;
}

export type DiscoverSourceStatus = "ok" | "stale" | "unavailable";

export interface DiscoverSourceReport {
  readonly id: string;
  readonly label: string;
  readonly status: DiscoverSourceStatus;
  readonly reason: string | null;
}

export interface DiscoverResult {
  readonly places: readonly InterestingPlace[];
  readonly sources: readonly DiscoverSourceReport[];
  readonly generatedAt: string;
}
