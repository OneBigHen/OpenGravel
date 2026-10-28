import type { Coordinate } from "../../../src/domain/ride/types";
import type { TrailSource } from "./types";

export type TrailFeatureKind = "waterfall" | "viewpoint" | "peak" | "fire-tower" | "water" | "cave" | "historic" | "shelter" | "campsite" | "drinking-water" | "toilets" | "parking" | "trailhead";
export interface AlongTrailFeature {
  readonly id: string;
  readonly kind: TrailFeatureKind;
  readonly name: string | null;
  readonly coordinate: Coordinate;
  /** Sum of retained parts before this point; never includes a gap. */
  readonly distanceAlongMeters: number;
  readonly distanceFromTrailMeters: number;
  readonly lineIndex: number;
  readonly source: TrailSource;
  readonly wikipedia?: string;
  readonly wikidata?: string;
}
export interface RichHike {
  readonly descriptions?: readonly TrailDescription[];
  readonly photos?: readonly TrailPhoto[];
  readonly photo?: TrailPhoto;
  readonly officialStatus?: string | null;
  readonly officialDifficulty?: string | null;
  readonly allowedUses?: string | null;
  readonly fieldSources?: Readonly<Record<string, TrailSource>>;
  readonly officialEvidence?: readonly { readonly source: TrailSource; readonly attributes: Readonly<Record<string,string | null>> }[];
  readonly park?: CatalogPlace | null;
  readonly nearestTown?: CatalogPlace | null;
  readonly difficulty?: CatalogDifficulty | null;
  readonly featureKinds?: readonly TrailFeatureKind[];
  readonly featureCount?: number;
  /** Detail only: omitted by the list API. */
  readonly features?: readonly AlongTrailFeature[];
}
export interface CatalogPlace {
  readonly name: string;
  readonly source: TrailSource;
  readonly wikipedia?: string;
  readonly wikidata?: string;
  readonly distanceMeters?: number;
  readonly sampledShare?: number;
}
export interface CatalogDifficulty {
  readonly label: string;
  readonly basis: "osm" | "official" | "derived";
  readonly score?: number;
  readonly method?: string;
  readonly sourceUrl: string;
}
export interface TrailDescription {
  readonly subject: string;
  readonly kind: "trail" | "park" | "feature";
  readonly text: string;
  readonly sourceUrl: string;
  readonly author: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly revision?: number;
}
export interface TrailPhoto {
  readonly pageId: number;
  readonly title: string;
  readonly thumbnailUrl: string;
  readonly pageUrl: string;
  readonly author: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly attribution?: string;
  readonly coordinate: Coordinate;
  readonly distanceFromTrailMeters: number;
  readonly width: number;
  readonly height: number;
}
