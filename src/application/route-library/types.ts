/**
 * Shapes shared by the national ride library's pack builder, its server reader
 * and (through the index) the phone. Plain data only.
 */

export type RideType = "twisty" | "scenic" | "dirt" | "trail";
export type RideKind = "road" | "area" | "trip";
export type SurfaceCode = "p" | "u" | "m" | null;
export type PolicyMode = "host" | "link" | "hide";

/** Index flag bits (plan section 6). Bit 128 (merged from several sites) is set by the L2 dedupe stage. */
export const FLAG = {
  line: 1,
  loop: 2,
  gpx: 4,
  old: 8,
  rough: 16,
  notes: 32,
  stops: 64,
  merged: 128,
} as const;

export interface LibraryBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface LibraryPoi {
  readonly name: string;
  readonly source: string;
  readonly kind?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly notes?: string;
}

/** The part of a `routes/<ST>/<id>.json` record the pack uses. */
export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly states: readonly string[];
  readonly lane: string;
  readonly lanes_secondary?: readonly string[];
  readonly source: { readonly name: string; readonly url: string; readonly page_title?: string };
  readonly author_credit: {
    readonly author: string;
    readonly author_url?: string;
    readonly credit_line?: string;
  };
  readonly value_score: number;
  readonly value_reason?: string;
  readonly summary?: string;
  readonly scraped_at: string;
  readonly last_verified: string;
  readonly claimed_distance_km?: number;
  readonly location?: {
    readonly lat: number;
    readonly lon: number;
    readonly precision: "trailhead" | "town" | "area";
    readonly source?: string;
  };
  readonly surface?: {
    readonly mix?: string;
    readonly surface_claim_source?: string;
    readonly legal_status?: string;
    readonly difficulty?: string;
    readonly difficulty_source?: string;
    readonly seasonality?: string;
    readonly permits?: string;
  };
  readonly gpx: {
    readonly availability: "hosted" | "link-only" | "none";
    readonly local_file?: string;
    readonly download_url?: string;
    readonly distance_km?: number;
    readonly points?: number;
    readonly bounds?: LibraryBounds;
    readonly is_bundle?: boolean;
    readonly track_names?: readonly string[];
    readonly track_vintage?: string;
  };
  readonly ancillary?: {
    readonly fuel?: readonly LibraryPoi[];
    readonly camping?: readonly LibraryPoi[];
    readonly lodging?: readonly LibraryPoi[];
    readonly pois?: readonly LibraryPoi[];
  };
  readonly alternates?: readonly { readonly label: string; readonly difficulty: string; readonly notes?: string; readonly gpx_url?: string }[];
  readonly discussion?: {
    readonly post_text?: string;
    readonly comments_url?: string;
    readonly comments_captured?: readonly { readonly author: string; readonly text: string; readonly captured_at: string; readonly url?: string }[];
  };
}

/** One card in the phone's index. Field names are short on purpose: the file ships to every phone. */
export interface IndexRow {
  readonly id: string;
  readonly n: string;
  readonly k: RideKind;
  readonly t: RideType;
  readonly q: number;
  readonly mi: number | null;
  readonly st: readonly string[];
  readonly p: readonly [number, number] | null;
  readonly pp: "start" | "area" | "town" | null;
  readonly bb: readonly [number, number, number, number] | null;
  readonly f: number;
  readonly s: number;
  readonly c: string | null;
  readonly sf: "p" | "u" | "m" | null;
}

/** A fact the source claims, kept with its words; `value` is null when the source did not say. */
export interface RideFact<T> {
  readonly value: T | null;
  readonly quote: string | null;
  readonly source: string | null;
}

export interface RideCreditLine {
  readonly author: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly creditLine: string;
}

export interface RideDetail {
  readonly id: string;
  readonly name: string;
  readonly kind: RideKind;
  readonly type: RideType;
  readonly score: number;
  readonly scoreReason: string | null;
  readonly states: readonly string[];
  readonly summary: string;
  readonly miles: number | null;
  /** Bundles only: the trail segments added up. It is not a ride length. */
  readonly trailMiles: number | null;
  readonly loop: boolean;
  readonly start: { readonly lat: number; readonly lon: number } | null;
  readonly bounds: LibraryBounds | null;
  readonly points: number;
  readonly segmentCount: number;
  readonly track: {
    readonly availability: "hosted" | "link" | "none";
    readonly year: number | null;
    readonly vintage: string | null;
    readonly old: boolean;
    readonly rough: boolean;
    readonly mismatch: boolean;
    readonly gpxAllowed: boolean;
    readonly sourceDownloadUrl: string | null;
  };
  readonly facts: {
    readonly surface: RideFact<"paved" | "unpaved" | "mixed">;
    readonly legal: RideFact<string>;
    readonly difficulty: RideFact<string>;
    readonly permits: RideFact<string>;
    readonly season: RideFact<string>;
  };
  readonly credit: RideCreditLine;
  readonly alsoOn: readonly RideCreditLine[];
  readonly partOf: readonly (readonly [string, string])[];
  readonly includes: readonly (readonly [string, string])[];
  readonly sourceRating: null;
  readonly notes: readonly { readonly author: string; readonly text: string; readonly date: string | null; readonly url: string | null }[];
  readonly stops: {
    readonly fuel: readonly LibraryPoi[];
    readonly camping: readonly LibraryPoi[];
    readonly lodging: readonly LibraryPoi[];
    readonly pois: readonly LibraryPoi[];
  };
  readonly alternates: readonly { readonly label: string; readonly difficulty: string; readonly notes: string | null; readonly gpxUrl: string | null }[];
  readonly sections: readonly string[] | null;
  readonly provenance: { readonly basis: string; readonly scrapedAt: string; readonly lastVerified: string };
}
