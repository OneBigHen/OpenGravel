/**
 * Route intelligence: normalized, provider-free vocabulary
 * (ROUTE-INTELLIGENCE-PROVIDER-MESH §4–§5, wave RI-0).
 *
 * Sources are capabilities behind ports, never per-vendor application
 * interfaces. A record carries where it came from, how authoritative that
 * source is and when it applies; what it *does* to a route (the effect) is
 * OpenGravel policy (`policy.ts`), never the provider's claim.
 */

import type { Coordinate } from "@/domain/ride/types";

/** How much a source's word counts, per §5. */
export type AuthorityClass =
  | "authoritative-regulatory"
  | "authoritative-operational"
  | "government-modeled"
  | "government-observed"
  | "community-observed"
  | "contextual";

/** What OpenGravel lets a record do to a route (§5). Policy, not provider. */
export type EffectClass = "eligibility" | "score" | "warning" | "preparation" | "discovery";

/** The capability families of §4; a provider may serve more than one. */
export type CapabilityFamily =
  | "road-authority"
  | "road-character"
  | "recon"
  | "connectivity"
  | "environment"
  | "rider-services"
  | "destination";

export interface BoundingBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** What a road-authority record describes. */
export type RoadAuthorityKind =
  | "closure"
  | "restriction"
  | "work-zone"
  | "incident"
  | "winter-condition"
  /** A legal motor-vehicle designation (USFS MVUM): who may ride it, and when. */
  | "motor-vehicle-designation";

/** An inclusive month/day window, e.g. 05/15–12/15; it may wrap the new year. */
export interface SeasonWindow {
  readonly startMonth: number;
  readonly startDay: number;
  readonly endMonth: number;
  readonly endDay: number;
}

/** One absolute access window. `validUntil` is exclusive. */
export interface AccessWindow {
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface MotorcycleAccess {
  /** `unknown` when the designation names no class a motorcycle belongs to. */
  readonly status: "open" | "closed" | "unknown";
  /**
   * Recurring month/day windows. `null` means all year; empty means the
   * authority says it is seasonal but has not published exact dates.
   */
  readonly seasons: readonly SeasonWindow[] | null;
  /**
   * Year-specific windows from an authority, e.g. a state-forest opening
   * schedule. When present these take precedence over recurring `seasons`.
   */
  readonly windows?: readonly AccessWindow[];
  /**
   * What applies outside published absolute windows. A road described as
   * normally closed can therefore fail closed without pretending the opening
   * repeats every year.
   */
  readonly outsideWindowStatus?: "closed" | "unknown";
}

export type RoadAuthorityGeometry =
  | { readonly type: "line"; readonly coordinates: readonly Coordinate[] }
  | { readonly type: "point"; readonly coordinate: Coordinate };

export interface RoadAuthorityRecord {
  readonly sourceId: string;
  /** The provider's own id, for dedupe and diagnostics only. */
  readonly sourceRecordId: string;
  readonly kind: RoadAuthorityKind;
  readonly geometry: RoadAuthorityGeometry;
  readonly roadName: string | null;
  /** Short rider-safe text (the provider's description, trimmed). */
  readonly description: string;
  /** ISO instants; `null` means the source did not say. */
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  /** For closures and work zones: every lane is closed. */
  readonly allLanesClosed?: boolean;
  /** For designations: what a street-legal motorcycle may do. */
  readonly motorcycleAccess?: MotorcycleAccess;
}

export interface RoadAuthoritySourceInfo {
  readonly id: string;
  /** Human-safe source line, e.g. "NJDOT work zones (WZDx)". */
  readonly label: string;
  readonly authority: AuthorityClass;
  readonly family: CapabilityFamily;
  /**
   * Which question the source answers for a route: temporary `closures`
   * (closures, restrictions, work zones, incidents) or legal `access`
   * (designations such as MVUM).
   */
  readonly facet: "closures" | "access";
  /**
   * Where this source can speak at all. Outside it the source says nothing,
   * which is unknown, never clear.
   */
  readonly coverage: readonly BoundingBox[];
  /** Lower wins when two sources report the same event (§9: the road owner first). */
  readonly precedence: number;
}

/**
 * The data-budget contract every adapter declares (§11). Core planning must
 * work with every source disabled; these bound what an enabled one may cost.
 */
export interface SourceBudget {
  readonly maxRemoteCallsPerPlan: number;
  readonly maxRecords: number;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly cacheTtlMs: number;
  /** How long past its TTL a cached answer may still be served, marked stale. */
  readonly serveStaleMs: number;
  readonly retry: "none" | "once";
  readonly cancellable: boolean;
}

export type SnapshotStatus = "fresh" | "stale" | "unavailable";

export interface RoadAuthoritySnapshot {
  readonly status: SnapshotStatus;
  readonly fetchedAt: string | null;
  /** Why it is stale or unavailable, for diagnostics and honest copy. */
  readonly reason: string | null;
  readonly records: readonly RoadAuthorityRecord[];
  /**
   * The part of the asked corridor this answer actually covers. An MVUM ingest
   * that fetched only some cells covers only those.
   */
  readonly covered: readonly BoundingBox[];
  /**
   * Where this source speaks for, if narrower than `info.coverage`: a national
   * registry source knows only per answer which states have a feed. Absent
   * means `info.coverage`.
   */
  readonly scope?: readonly BoundingBox[];
  /**
   * Areas inside `covered` this answer still cannot speak for, e.g. where a
   * state box with no feed overlaps a covered neighbor's box at the border.
   */
  readonly unknownAreas?: readonly BoundingBox[];
}

export interface CapabilityProbe {
  readonly available: boolean;
  /** Why not, e.g. "PENNDOT_RCRS_USERNAME is not set". */
  readonly reason: string | null;
}
