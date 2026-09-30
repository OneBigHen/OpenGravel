/**
 * The authored ride model (03-DOMAIN-MODEL §2–§19).
 *
 * `RideDocument` is authority #1: the canonical authored ride. Every editable
 * object carries a stable branded ID (§1), every field is readonly, and the
 * document is immutable once created — an edit produces a new revision, it
 * never mutates this shape. This module is pure data plus `SCHEMA_VERSION`:
 * construction lives in `create.ts`, validation in `validate.ts`.
 */

import type { SketchEndpointPolicy, SketchTopologyHint } from "../sketch/types";
import type {
  AvoidAreaId,
  GeometryRef,
  PointId,
  RideHistoryEntryId,
  RideId,
  RoadEntityId,
  RoadSpanId,
  ShapingId,
  SketchId,
  StopId,
} from "./ids";

/** Schema version written into every document (§2). */
export const SCHEMA_VERSION = 1;

/** A WGS84 position, in longitude/latitude order (§4). */
export interface Coordinate {
  readonly lon: number;
  readonly lat: number;
}

/**
 * Where an authored location came from (§5). A default regional camera
 * location is never a `RidePoint`, so there is no such provenance variant.
 */
export type LocationProvenance =
  | { readonly type: "gps"; readonly accuracyMeters: number; readonly observedAt: string }
  | {
      readonly type: "search";
      readonly provider: string;
      readonly placeId?: string;
      readonly query: string;
    }
  | { readonly type: "map"; readonly selectedAt: string }
  | { readonly type: "saved"; readonly savedPlaceId: string }
  | { readonly type: "import"; readonly sourceId: string }
  | { readonly type: "derived"; readonly reason: string };

/** A start or finish endpoint (§4). */
export interface RidePoint {
  readonly id: PointId;
  readonly kind: "start" | "finish";
  readonly coordinate: Coordinate;
  readonly label?: string;
  readonly provenance: LocationProvenance;
}

/** Arrival intent shown in itinerary and guidance (§4). */
export type StopArrivalIntent =
  | "visit"
  | "fuel"
  | "food"
  | "lodging"
  | "scenic"
  | "other";

/** A stop: appears in itinerary and guidance (§4). */
export interface StopPoint {
  readonly id: StopId;
  readonly kind: "stop";
  readonly coordinate: Coordinate;
  readonly label?: string;
  readonly arrivalIntent?: StopArrivalIntent;
  readonly provenance: LocationProvenance;
}

/** A shaping anchor: routes through it, never appears in guidance (§4). */
export interface ShapingPoint {
  readonly id: ShapingId;
  readonly kind: "shape";
  readonly coordinate: Coordinate;
  readonly source: "map-drag" | "search" | "sketch" | "import" | "advisor";
}

/** Time budget or deadline (§6). */
export type TimeIntent =
  | { readonly kind: "none" }
  | { readonly kind: "budget"; readonly targetMinutes: number; readonly toleranceMinutes: number }
  | {
      readonly kind: "returnBy";
      readonly localTime: string;
      readonly date: string;
      readonly toleranceMinutes: number;
    }
  | {
      readonly kind: "arriveBy";
      readonly localTime: string;
      readonly date: string;
      readonly toleranceMinutes: number;
    };

/** When the ride starts (§3). */
export type DepartureIntent =
  | { readonly kind: "now" }
  | { readonly kind: "future"; readonly at: string };

/** Rider-facing road character (§7); RoutePolicy owns the internal mapping. */
export type RoadCharacterIntent =
  | "efficient"
  | "balanced"
  | "curvy"
  | "backroads";

/** How strongly route selection should value roads this rider has not ridden. */
export type NoveltyPreference =
  | "prefer-new-to-me"
  | "balanced"
  | "prefer-familiar";

/** Surface preference (§8). A target is an envelope, not a promise. */
export interface SurfaceIntent {
  readonly preference: "pavement" | "mostly-pavement" | "mixed" | "dirt-preferred";
  readonly targetUnpavedShare?: {
    readonly min?: number;
    readonly target?: number;
    readonly max?: number;
  };
  readonly unknownSurfacePolicy: "allow-with-warning" | "avoid-when-possible";
}

/**
 * Terrain level (§9). Evaluated from difficulty evidence; when evidence is
 * insufficient the answer is `unknown`, not a route guarantee.
 */
export type TerrainIntent =
  | { readonly level: "known-easy-only" }
  | { readonly level: "moderate" }
  | { readonly level: "any-supported" };

/** Traffic preference (§3). */
export type TrafficPreference = "protect-ride" | "minimize-delay";

/** Toll policy (§3). */
export type TollPolicy = "avoid" | "allow-with-warning";

/**
 * Bike constraints snapshotted into the ride (§10), so a later change to global
 * bike settings never silently rewrites an existing ride.
 */
export interface BikeConstraintSnapshot {
  readonly bikeId: string;
  readonly category: "street" | "touring" | "adventure" | "dual-sport";
  readonly fuelRangeMiles: number;
  readonly reserveMiles: number;
  readonly maintainedGravel: "allow" | "avoid";
  readonly roughTracks: "allow" | "avoid";
  readonly unknownSurface: "allow-with-warning" | "avoid-when-possible";
  readonly custom?: Readonly<Record<string, boolean | number | string>>;
}

/** Who authored an object (§25). */
export type CommandSource =
  | "rider"
  | "map"
  | "drawing"
  | "import"
  | "advisor"
  | "settings"
  | "recovery"
  | "system-location";

/** A selectable, editable, removable area the ride should avoid (§11). */
export interface AvoidArea {
  readonly id: AvoidAreaId;
  readonly name: string | null;
  readonly geometryRef: GeometryRef;
  readonly enabled: boolean;
  readonly createdBy: CommandSource;
}

/**
 * Intentionally open placeholder for the access evidence captured alongside a
 * road span. 03-DOMAIN-MODEL §12 names the type but not its shape; the
 * road-intelligence wave (07) refines it.
 */
export interface AccessEvidenceSnapshot {
  readonly evidenceVersion?: string;
  readonly notes?: string;
}

/**
 * A road the rider wants kept, preferred, or avoided (§12). The matching
 * tolerance is policy, never exposed here.
 */
export interface RoadSpanConstraint {
  readonly id: RoadSpanId;
  readonly mode: "must" | "prefer" | "avoid";
  readonly direction: "forward" | "reverse" | "either";
  readonly roadEntityId?: RoadEntityId;
  readonly geometryRef: GeometryRef;
  readonly anchorRefs: readonly Coordinate[];
  /** Reserved for the evidence snapshot captured with the constraint. */
  readonly evidenceSnapshot?: AccessEvidenceSnapshot;
}

/**
 * One structural feature of a sketch's raw trace (03-DOMAIN-MODEL §13, 04 §19,
 * 05 §19).
 *
 * Refined by Task 4.4 from the 1.1 placeholder: the concrete shape lives in
 * `domain/sketch/types.ts` besides the rest of the sketch vocabulary, and is
 * re-exported here because `SketchIntent` — the authored field — is defined in
 * this module. A hint records *where* the feature was measured (`at`), so a
 * consumer never has to re-run the geometry to act on it.
 */
export type { SketchTopologyHint } from "../sketch/types";

/**
 * A committed sketch (§13). Raw strokes are preserved; the corridor may simplify.
 *
 * `rawStrokeRefs` is the authority for a retry: a replan re-derives the corridor,
 * the topology hints and the endpoints from the stored trace (04 §19 "retry uses
 * the original geographic trace, not re-unprojected screen pixels"), and the
 * persisted `corridorRef` plus `topologyHints` are the committed record of that
 * same derivation. They are separate fields because `06 §18` measures the route
 * against the corridor, while the hints describe how the rider drew it.
 */
export interface SketchIntent {
  readonly id: SketchId;
  readonly rawStrokeRefs: readonly GeometryRef[];
  readonly corridorRef: GeometryRef;
  readonly topologyHints: readonly SketchTopologyHint[];
  readonly endpointPolicy: SketchEndpointPolicy;
}

/**
 * Intentionally open placeholder for multi-day / staged ride planning.
 * 03-DOMAIN-MODEL §3 requires the slot but does not specify its shape; Task 7.5
 * refines it. Do not grow this into a plan schema before that task.
 */
export interface LongTripIntent {
  readonly staged: boolean;
  readonly notes?: string;
}

/**
 * How this ride came to exist (§28): `new`, `import`, `catalog`/`shared`/
 * `recorded` derivatives, or a track the rider recreated the ride from. A
 * derivative keeps the identity of the input it came from in `sourceId`.
 */
export interface RideProvenance {
  readonly type:
    | "new"
    | "import"
    | "catalog"
    | "shared"
    | "recorded"
    | "recreated-from-track"
    | "derived";
  readonly sourceId?: string;
  /** Recognized external owner for an explicitly imported document. */
  readonly source?: "SwitchBack";
}

/**
 * One logical undo unit (§27 — one user action is one history unit). The entry
 * snapshots the whole intent it produced, which stays cheap because every large
 * geometry payload lives behind a `GeometryRef` (VNX-004): history stores
 * references, never repeated 50k-point arrays.
 *
 * `revision` is the document revision this entry produced. The bounded
 * undo/redo engine that walks `cursor` is Task 1.3; this module only owns the
 * shape.
 */
export interface RideHistoryEntry {
  readonly entryId: RideHistoryEntryId;
  readonly label: string;
  readonly revision: number;
  readonly intent: RideIntent;
}

/**
 * The authored ride's linear history index (Task 1.3 owns the engine).
 *
 * - `entries` is append-ordered; `cursor` is the position of the entry that
 *   produced the current intent, with `-1` meaning "the current intent is
 *   `baseIntent`": the pre-history state, or a document only ever seeded by a
 *   non-undoable system-location start.
 * - `baseIntent` is the authored ride before any history entry. It is the undo
 *   destination at the origin, and pruning moves it forward so undo stays
 *   well-defined across the 50-entry boundary.
 * - A new edit slices `entries` to `cursor + 1` before appending, which is the
 *   "a new edit cuts redo" rule.
 * - `appliedProposalIds` remembers recently applied advisor proposals so that
 *   re-applying one is idempotent (03-DOMAIN-MODEL §24).
 */
export interface RideHistoryIndex {
  readonly entries: readonly RideHistoryEntry[];
  readonly cursor: number;
  /** The intent before any history entry; survives pruning (see `history.ts`). */
  readonly baseIntent: RideIntent;
  readonly appliedProposalIds: readonly string[];
}

/** Everything the rider authored about the ride (§3). */
export interface RideIntent {
  readonly shape: "destination" | "loop" | "open";
  readonly start: RidePoint | null;
  readonly finish: RidePoint | null;
  readonly stops: readonly StopPoint[];
  readonly shaping: readonly ShapingPoint[];
  readonly time: TimeIntent;
  readonly departure: DepartureIntent;
  readonly roadCharacter: RoadCharacterIntent;
  /**
   * Personal familiarity preference. Optional only for backward-compatible
   * persisted v1 rides; absence has the same meaning as "balanced".
   */
  readonly noveltyPreference?: NoveltyPreference;
  readonly surface: SurfaceIntent;
  readonly terrain: TerrainIntent;
  readonly traffic: TrafficPreference;
  readonly avoidHighways: boolean;
  readonly tollPolicy: TollPolicy;
  readonly bike: BikeConstraintSnapshot;
  readonly avoidAreas: readonly AvoidArea[];
  readonly roadSpans: readonly RoadSpanConstraint[];
  readonly sketch: SketchIntent | null;
  readonly longTrip: LongTripIntent | null;
}

/** The canonical authored ride (§2). */
export interface RideDocument {
  readonly schemaVersion: number;
  readonly rideId: RideId;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly title: string | null;
  readonly provenance: RideProvenance;
  readonly intent: RideIntent;
  readonly history: RideHistoryIndex;
}
