/**
 * The planner view model (04-PLANNER-AND-WORKSPACE-UX §8–§11, §21, §29).
 *
 * A pure selector over `(RideDocument, PlanningSessionSnapshot)` that produces
 * exactly what the workspace renders: phases as copy, points as labels,
 * candidates as decision cards, and a plan-commitment answer with a *truthful*
 * disabled reason.
 *
 * Three product rules are enforced here rather than in a component:
 *
 * - **A disabled button always says why** (04 §8): missing start, missing
 *   destination, or an attempt already in flight — never a silent `disabled`.
 * - **Unknown stays unknown**: a missing duration renders as "Unknown", never
 *   as "0 min"; a missing role renders as "Alternative", never as "Best Ride".
 * - **Failure is classified copy, not one generic sentence** (04 §29): each
 *   session error code has its own rider sentence, and the failure copy never
 *   replaces the previous route on the map.
 */

import { isSketchPreviewBundle } from "./sketch-preview";
import { buildRoutingMethodComparison, type RoutingComparisonVm } from "./routing-method-comparison";
import type {
  PlanningErrorCode,
  PlanningSessionSnapshot,
} from "@/application/planner/planning-session";
import {
  aggregateRouteSurface,
  surfaceBandLabel,
  unverifiedSurfaceMeters,
} from "@/application/roads/surface-evidence";
import type { SurfaceBand } from "@/domain/roads/surface";
import {
  CURVINESS_LABELS,
  curvatureLabel,
  curvinessLevel,
  surfaceMixLabel,
  surfaceRuns,
  type SurfaceRun,
  surfaceShares,
} from "@/application/roads/engine-road-evidence";
import type { MapObjectRef } from "@/application/map/types";
import { canRedo, canUndo } from "@/domain/ride/history";
import type { ShapingId, StopId } from "@/domain/ride/ids";
import type {
  Coordinate,
  RideDocument,
  StopArrivalIntent,
} from "@/domain/ride/types";
import type { SketchEndpoints } from "@/domain/sketch/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type {
  RouteBundle,
  RouteCandidate,
  RouteRole,
  RouteRoles,
} from "@/domain/route/types";
import {
  formatAddedTime,
  formatDistance,
  formatDuration,
  isKnownMeasurement,
  METERS_PER_MILE,
} from "./measurements";

/**
 * The rider-facing spelling of a measurement (04 §11), re-exported because the
 * card, the delta chip and the workspace read them from this module's public
 * surface. They live in `measurements.ts` now so the deterministic route
 * explanation can share the exact same formatting (`OGV-D-250`).
 */
export { formatAddedTime, formatDistance, formatDuration } from "./measurements";

/** Rider-facing role names (06 §15). Never an engine or provider name. */
export const ROLE_LABELS: Readonly<Record<RouteRole, string>> = {
  "best-ride": "Best Ride",
  fastest: "Fastest",
  "fast-and-fun": "Fast & Fun",
  "more-twisties": "More Twisties",
  "more-dirt": "More Dirt",
  "lower-workload": "Lower Workload",
};

/** Shown for a candidate the bundle assigned no role (04 §11). */
export const ALTERNATIVE_LABEL = "Alternative";

/** Evidence-driven badge: generated routes have no surface evidence. */
export const UNVERIFIED_SURFACE_BADGE = "Surface unknown";

/**
 * The 07 §5 rider vocabulary for surface confidence. The bands come from the
 * surface aggregation, so a band a rider sees here can never be more confident
 * than the evidence that produced it (07 §7 lowers a conflicting or stale
 * winner one band or more). The words name what is uncertain (the surface) rather than an abstract
 * "confidence" (UX rework 2). No numeric confidence is ever shown: 07 §5 says not
 * to expose false precision, so the band is the whole claim.
 */
export type RouteConfidenceLabel =
  | "Surface confirmed"
  | "Surface mostly known"
  | "Surface partly guessed"
  | "Unknown";

/** The 07 §5 band names, in the aggregation's own vocabulary. */
export const CONFIDENCE_LABELS: Readonly<Record<SurfaceBand, RouteConfidenceLabel>> = {
  confirmed: "Surface confirmed",
  likely: "Surface mostly known",
  possible: "Surface partly guessed",
  unknown: "Unknown",
};

/** 04 §11: at most three meaningful choices. */
export const MAX_ROUTE_CARDS = 3;

export const NO_START_LABEL = "No start yet";
export const NO_FINISH_LABEL = "No destination yet";

/** The plan-commitment refusal, in the order a rider can act on it. */
export const DISABLED_MISSING_START = "Search for a start, or set it on the map.";
export const DISABLED_MISSING_FINISH = "Search for a destination, or choose it on the map.";
export const DISABLED_IN_FLIGHT = "Your ride is on its way — one moment.";

/** One route choice (04 §11). */
export interface RouteCardVm {
  readonly routeId: RouteCandidateId;
  /**
   * The role behind the label, as a stable token (`best-ride`, `alternative`,
   * …). Stable identity rather than display copy: it is what a hook, a test or
   * an analytics label keys off, so renaming a rider-facing role name does not
   * silently change them.
   */
  readonly roleKey: RouteRole | "alternative";
  readonly roleLabel: string;
  readonly durationLabel: string;
  readonly distanceLabel: string;
  readonly addedTimeLabel: string | null;
  readonly badges: readonly string[];
  /** Optional for compatibility with injected view models; absent is unknown. */
  readonly trafficLabel?: string;
  /**
   * The candidate's colour slot (its bundle index), shared with its map line so
   * the rider matches a card to a line by colour. Absent is slot 0 (Ember).
   */
  readonly tint?: number;
  /** Curviness 1–5 with its word, for the card's meter; absent when unmeasured. */
  readonly curviness?: { readonly level: 1 | 2 | 3 | 4 | 5; readonly label: string };
  /** Surface shares for the card's strip; absent when the mix is unmeasured. */
  readonly surfaceStrip?: { readonly paved: number; readonly gravel: number; readonly dirt: number; readonly unknown: number };
  /** Where each surface is along the line, for the strip under the elevation profile. */
  readonly surfaceRuns?: readonly SurfaceRun[];

  /**
   * The 07 §5 surface-confidence band (04 §11's "confidence summary"), or
   * `null` for a card whose route has no measurable metric at all: a band on a
   * line we cannot measure would be a claim about nothing (`OGV-D-251`).
   */
  readonly confidenceLabel: RouteConfidenceLabel | null;
  /**
   * Miles of this route whose surface no usable evidence covers, from the
   * evidence's own coverage share. `null` when that share is not measurable —
   * never `0` by implication (`OGV-D-251`).
   */
  readonly unknownSurfaceMi: number | null;
  /**
   * The DOM id of this card's explanation region, so the `Why this ride?`
   * control and the region it expands are matched by construction rather than by
   * a convention. Keyed by the candidate identity, not the role: two unroled
   * candidates are both "alternative", and duplicate DOM ids are invalid.
   */
  readonly whyKey: string;
  readonly isSelected: boolean;
}

/** The card badge for a line the hosted fallback router drew (WORK-ORDER §1.2). */
export const BASIC_ROUTING_BADGE = "Basic routing";
export const OFFLINE_ROUTING_BADGE = "Planned offline";

export interface PlannerViewModel {
  readonly phase: PlanningSessionSnapshot["phase"];
  readonly statusMessage: string;
  /**
   * What the start value cell reads as: the rider's own name for the point, or
   * `Dropped pin` — never an invented name (04 §3, OGV-D-224 follow-up).
   */
  readonly startLabel: string;
  /**
   * The start's coordinate at four decimals, or `null` when there is no start.
   *
   * It is a *secondary* value: the cell shows the name (or "Dropped pin") and
   * this is the machine-readable detail beside it, so a dropped pin is not
   * mistaken for a place OpenGravel knows the name of.
   */
  readonly startCoordinateLabel: string | null;
  readonly finishLabel: string;
  readonly finishCoordinateLabel: string | null;
  readonly canPlan: boolean;
  readonly disabledReason: string | null;
  readonly routeCards: readonly RouteCardVm[];
  readonly routingComparisons: RoutingComparisonVm;
  readonly selectedRouteId: RouteCandidateId | null;
  readonly errorMessage: string | null;
  /**
   * True when the last attempt failed (04 §29). The commitment button must not
   * read as a success claim next to a visible error, and the recovery action is
   * offered beside it (owner review 2026-09-17).
   */
  readonly failed: boolean;
  /** `Create ride` / `Update ride` / `Plan again` — never a success claim on
   * top of an error. */
  readonly planLabel: string;
  /**
   * True when the routes on screen were planned from the current ride revision,
   * so planning again would change nothing. The plan button steps back to a
   * secondary action and Start ride becomes the primary one.
   */
  readonly planIsCurrent: boolean;
  /** Start · stops (in order) · finish, as the list renders them (04 §15). */
  readonly itinerary: readonly PointRowVm[];
  /** The shaping anchors, which never appear in the itinerant list (04 §15). */
  readonly shapingPoints: readonly PointRowVm[];
  /** The label the visible Undo control would cross, or `null` (04 §20). */
  readonly undoLabel: string | null;
  /** The label the visible Redo control would cross, or `null` (04 §20). */
  readonly redoLabel: string | null;
}

export interface PlannerViewModelInput {
  readonly document: RideDocument;
  readonly session: PlanningSessionSnapshot;
  /**
   * The endpoints a committed sketch derives from its own trace (03 §13, 04 §19),
   * resolved by the caller that holds a `GeometryStore`.
   *
   * The view model cannot read geometry itself, but the two rules it owns — "can
   * this ride be planned" and "what does the endpoint read as" — both depend on
   * the trace when the ride has no authored endpoint of its own. `null` (or an
   * omitted value) means there is nothing to derive from, which is exactly the
   * state a ride with no sketch is in.
   */
  readonly sketchDerivedEndpoints?: SketchEndpoints | null;
  /**
   * The name a geocoder found for an unnamed point's coordinate (M1, OGV-D-260),
   * or `undefined` while none is known. Derived evidence, never authored: it
   * stands in only where the document carries no label of its own.
   */
  readonly placeNameFor?: PlaceNameLookup;
  /**
   * The selected route's live traffic, checked once by the route briefing (M4,
   * OGV-D-266). A card whose own evidence carries no traffic band shows it;
   * every other card stays "Traffic unknown".
   */
  readonly routeTraffic?: { readonly routeId: string; readonly label: string } | null;
}

/** Reads a cached place name for a coordinate (`application/geocoding/place-names`). */
export type PlaceNameLookup = (coordinate: Coordinate) => string | undefined;

/** What an unnamed start taken from the rider's GPS reads as until it is named. */
export const YOUR_LOCATION_LABEL = "Your location";

/** What kind of authored object a list row addresses (04 §15). */
export type ItineraryKind = "start" | "stop" | "finish" | "shaping";

/**
 * A list-addressable authored point, by *identity* rather than by position: the
 * stop list reorders freely, so an index would address a different object after
 * every move. The discriminants mirror the command payloads a row dispatches.
 */
export type ItineraryRef =
  | { readonly kind: "start" }
  | { readonly kind: "finish" }
  | { readonly kind: "stop"; readonly stopId: StopId }
  | { readonly kind: "shaping"; readonly shapingId: ShapingId };

/** One row of the object list (04 §15). */
export interface PointRowVm {
  readonly ref: ItineraryRef;
  readonly kind: ItineraryKind;
  /** The rider's own label, or `Dropped pin` — never an invented name. */
  readonly label: string;
  /** The same point's coordinate at four decimals, as the row's secondary value. */
  readonly coordinateLabel: string;
  readonly coordinate: Coordinate;
  /** Stops only; `null` when no intent was authored. */
  readonly arrivalIntent: StopArrivalIntent | null;
  /** 1-based position among the stops; `null` for the endpoints and anchors. */
  readonly position: number | null;
}

/**
 * The list ref behind a map selection, or `null` when the selection is not an
 * authored point. The map knows a shaping anchor as a generic `point` ref, so the
 * document is what says whether it is the start, the destination or an anchor.
 */
export function itineraryRefFor(
  document: RideDocument,
  ref: MapObjectRef | null,
): ItineraryRef | null {
  if (ref === null) return null;
  if (ref.kind === "stop") return { kind: "stop", stopId: ref.stopId };
  if (ref.kind !== "point") return null;
  // The renderer's `point` ref is the generic one (start, destination or shaping
  // anchor), and its brand says which of the two id kinds it carries.
  const selectedPointId = ref.pointId;
  if (document.intent.start?.id === selectedPointId) return { kind: "start" };
  if (document.intent.finish?.id === selectedPointId) return { kind: "finish" };
  const anchor = document.intent.shaping.find((point) => point.id === selectedPointId);
  return anchor === undefined ? null : { kind: "shaping", shapingId: anchor.id };
}

/** A stable key for a list ref, for React keys and snap-candidate reports. */
export function itineraryRefKey(ref: ItineraryRef): string {
  switch (ref.kind) {
    case "start":
    case "finish":
      return ref.kind;
    case "stop":
      return `stop:${ref.stopId}`;
    case "shaping":
      return `shape:${ref.shapingId}`;
  }
}

/**
 * The map object a list row addresses, or `null` when the object is gone (a
 * stale ref after an undo). Selection and "zoom to" both go through this, so a
 * list never names an object the document does not hold.
 */
export function mapRefForItineraryRef(
  document: RideDocument,
  ref: ItineraryRef,
): MapObjectRef | null {
  switch (ref.kind) {
    case "start": {
      const start = document.intent.start;
      return start === null ? null : { kind: "point", pointId: start.id };
    }
    case "finish": {
      const finish = document.intent.finish;
      return finish === null ? null : { kind: "point", pointId: finish.id };
    }
    case "stop":
      return document.intent.stops.some((stop) => stop.id === ref.stopId)
        ? { kind: "stop", stopId: ref.stopId }
        : null;
    case "shaping":
      return document.intent.shaping.some((point) => point.id === ref.shapingId)
        ? { kind: "point", pointId: ref.shapingId }
        : null;
  }
}

/** Rider copy per §29 error class; never "Something went wrong". */
const ERROR_COPY: Readonly<Record<PlanningErrorCode, string>> = {
  // The owner review's copy: a failed plan says what failed and what to do next,
  // in one quiet line (no exclamation, no blame, no "oops").
  "no-route": "No legal route to this destination — try another point.",
  "provider-unavailable": "The routing service is unavailable right now.",
  "constraint-conflict": "Your constraints leave no eligible route.",
};

/** A loop has no destination to blame, so its no-route copy says "this ride". */
const NO_ROUTE_LOOP_COPY = "No legal route for this ride — try another point.";

/** The commitment label per phase (04 §8, §29): never a success claim on error. */
export const PLAN_LABEL_CREATE = "Create ride";
export const PLAN_LABEL_UPDATE = "Update ride";
export const PLAN_LABEL_RETRY = "Plan again";

/** Phases in which an attempt is still running (04 §8, §9). */
const IN_FLIGHT_PHASES: ReadonlySet<PlanningSessionSnapshot["phase"]> = new Set([
  "validating",
  "routing-primary",
  "primary-ready",
  "alternatives-loading",
]);

/** True while an attempt is still running (04 §8–§9). */
export function isPlanningInFlight(
  phase: PlanningSessionSnapshot["phase"],
): boolean {
  return IN_FLIGHT_PHASES.has(phase);
}

/**
 * What a placed point with no name of its own is called (04 §3, §5).
 *
 * "Dropped pin" is the honest name for a point the rider tapped onto the map:
 * the coordinate is real, but no place name exists for it, and inventing one
 * would be a claim the app cannot support. The coordinate stays available as the
 * cell's secondary value.
 */
export const DROPPED_PIN_LABEL = "Dropped pin";

/**
 * A placed point's label: its authored name, else the place a geocoder found at
 * its coordinate, else "Your location" for an unnamed GPS start, else
 * {@link DROPPED_PIN_LABEL}. Never an invented name: the geocoded one is a
 * lookup of the rider's own coordinate.
 */
function formatEndpointLabel(
  point: {
    readonly label?: string;
    readonly coordinate: Coordinate;
    readonly provenance?: { readonly type: string };
  } | null,
  placeNameFor?: PlaceNameLookup,
): string {
  if (point === null) return "";
  if (point.label !== undefined && point.label.length > 0) return point.label;
  const resolved = placeNameFor?.(point.coordinate);
  if (resolved !== undefined && resolved.length > 0) return resolved;
  if (point.provenance?.type === "gps") return YOUR_LOCATION_LABEL;
  return DROPPED_PIN_LABEL;
}

/**
 * A placed point's coordinate at four decimals, or `null` when nothing is placed.
 *
 * Four decimals is the precision the owner review pinned (OGV-D-224): it is
 * ~11 m, enough to identify a junction, and short enough to wrap onto a second
 * line instead of being clipped.
 */
function formatEndpointCoordinate(
  point: { readonly coordinate: Coordinate } | null,
): string | null {
  if (point === null) return null;
  return `${point.coordinate.lat.toFixed(4)}, ${point.coordinate.lon.toFixed(4)}`;
}

/**
 * The label for an endpoint the sketch derives (04 §19), or `null` when there is
 * no trace to derive from.
 *
 * It says where the value came from on purpose: the coordinate alone would read as
 * an authored point the rider could edit, and the one honest thing to say about a
 * derived endpoint is that it belongs to the drawing. The coordinate is the row's
 * secondary value, exactly as it is for a dropped pin.
 */
const SKETCH_DERIVED_LABEL = "From your sketch";

function sketchDerivedCoordinate(coordinate: Coordinate): string {
  return `${coordinate.lat.toFixed(4)}, ${coordinate.lon.toFixed(4)}`;
}

function drawableBundle(session: PlanningSessionSnapshot): RouteBundle | null {
  return session.committedBundle ?? session.lastGoodBundle;
}

/** The role the bundle assigned this candidate, in `best-ride`-first order. */
function roleFor(roles: RouteRoles, candidateId: RouteCandidateId): RouteRole | null {
  const entries = Object.entries(roles) as readonly [RouteRole, RouteCandidateId | null][];
  for (const [role, id] of entries) {
    if (id === candidateId) return role;
  }
  return null;
}

/**
 * `06 §13`'s fastest order: shortest duration, then shortest distance, then the
 * stable id — the same order the role module ranks with (`roles.ts`), so a tie
 * cannot make the card and the explanation name different references.
 */
function isFasterCandidate(
  candidate: RouteCandidate,
  incumbent: RouteCandidate,
): boolean {
  if (candidate.durationSeconds !== incumbent.durationSeconds) {
    return candidate.durationSeconds < incumbent.durationSeconds;
  }
  if (candidate.distanceMeters !== incumbent.distanceMeters) {
    return candidate.distanceMeters < incumbent.distanceMeters;
  }
  return candidate.id < incumbent.id;
}

/**
 * The fastest measurable candidate of a bundle, or `null` when none measured a
 * duration.
 *
 * This is the added-time reference (`06 §13`), and it is exported because both
 * the cards and the deterministic explanation read it: a bundle's candidates
 * share one request's hard constraints, so the quickest of them *is* the
 * same-constraint reference, and one reader means the card's `+11 min vs
 * Fastest` and the headline that explains it can never disagree
 * (`OGV-D-204`, `OGV-D-252`).
 */
export function fastestReference(
  candidates: readonly RouteCandidate[],
): RouteCandidate | null {
  let fastest: RouteCandidate | null = null;
  for (const candidate of candidates) {
    if (!isKnownMeasurement(candidate.durationSeconds)) continue;
    if (fastest === null || isFasterCandidate(candidate, fastest)) fastest = candidate;
  }
  return fastest;
}

/**
 * The cards to show: at most {@link MAX_ROUTE_CARDS}, in bundle order, always
 * including the selected candidate so the rider can see what is drawn.
 */
function chooseCards(
  candidates: readonly RouteCandidate[],
  selectedRouteId: RouteCandidateId | null,
): readonly RouteCandidate[] {
  const head = candidates.slice(0, MAX_ROUTE_CARDS);
  if (selectedRouteId === null) return head;
  if (head.some((candidate) => candidate.id === selectedRouteId)) return head;
  const selected = candidates.find((candidate) => candidate.id === selectedRouteId);
  if (selected === undefined) return head;
  return [...head.slice(0, MAX_ROUTE_CARDS - 1), selected];
}

function roleLabelFor(
  role: RouteRole | null,
  isPlaceholderSelection: boolean,
): string {
  if (role !== null) return ROLE_LABELS[role];
  return isPlaceholderSelection ? ROLE_LABELS["best-ride"] : ALTERNATIVE_LABEL;
}

/**
 * The stable identity behind a card's label: the bundle's role, or the
 * placeholder the card is presented as. A rider's own pick is never relabelled
 * (OGV-D-183), so this always agrees with {@link roleLabelFor}.
 */
function roleKeyFor(
  role: RouteRole | null,
  isPlaceholderSelection: boolean,
): RouteCardVm["roleKey"] {
  if (role !== null) return role;
  return isPlaceholderSelection ? "best-ride" : "alternative";
}

function routeCards(
  bundle: RouteBundle | null,
  selectedRouteId: RouteCandidateId | null,
  routeTraffic?: { readonly routeId: string; readonly label: string } | null,
): readonly RouteCardVm[] {
  if (bundle === null) return [];
  const reference = fastestReference(bundle.candidates);
  return chooseCards(bundle.candidates, selectedRouteId).map((candidate) => {
    const role = roleFor(bundle.roles, candidate.id);
    // OGV-D-183 — placeholder role mirror. The client bundle's `roles` stay
    // empty until Task 3.3 (OGV-D-168), while the product's recommendation today
    // is the automatic selection rule: the first eligible candidate of the
    // highest-priority provider — the same candidate the server-side stub calls
    // `best-ride`. So an *automatically selected* candidate with no role of its
    // own is presented as the recommendation, and nothing else is. A bundle that
    // assigns roles always wins, and a rider's own pick is never relabelled.
    const placeholderSelection =
      role === null &&
      bundle.selectionSource === "automatic" &&
      candidate.id === selectedRouteId;
    const surface = aggregateRouteSurface(candidate.evidence["surfaceMix"]);
    const curves = curvatureLabel(candidate.evidence["curvature"]);
    const ownTraffic = trafficLabelFor(candidate);
    // A card with no measurable metric describes nothing a band could qualify,
    // so it makes no confidence claim (OGV-D-251); every other card carries the
    // 07 §5 band itself, never a numeric confidence.
    const measurable =
      isKnownMeasurement(candidate.distanceMeters) ||
      isKnownMeasurement(candidate.durationSeconds);
    const unverifiedMeters = unverifiedSurfaceMeters(
      candidate.evidence["surfaceMix"],
      candidate.distanceMeters,
    );
    const curviness = curvinessLevel(candidate.evidence["curvature"]);
    const strip = surfaceShares(candidate.evidence["surfaceMix"]);
    const runs = surfaceRuns(candidate.evidence["surfaceMix"]);
    return {
      routeId: candidate.id,
      tint: bundle.candidates.indexOf(candidate),
      ...(curviness === null ? {} : { curviness: { level: curviness, label: CURVINESS_LABELS[curviness - 1] ?? "Curvy" } }),
      ...(strip === null ? {} : { surfaceStrip: strip }),
      ...(runs === null ? {} : { surfaceRuns: runs }),
      roleKey: roleKeyFor(role, placeholderSelection),
      roleLabel: roleLabelFor(role, placeholderSelection),
      durationLabel: formatDuration(candidate.durationSeconds),
      distanceLabel: formatDistance(candidate.distanceMeters),
      addedTimeLabel:
        reference === null
          ? null
          : formatAddedTime(candidate.durationSeconds, reference.durationSeconds),
      badges: [
        surface.band === "unknown"
          ? UNVERIFIED_SURFACE_BADGE
          : surfaceMixLabel(candidate.evidence["surfaceMix"]) ?? surfaceBandLabel(surface.band),
        ...(curves === null ? [] : [curves]),
        ...(candidate.warnings.some((warning) => warning.code === "basic-routing") ? [BASIC_ROUTING_BADGE] : []),
        ...(candidate.warnings.some((warning) => warning.code === "offline-routing") ? [OFFLINE_ROUTING_BADGE] : []),
      ],
      confidenceLabel: measurable ? CONFIDENCE_LABELS[surface.band] : null,
      unknownSurfaceMi:
        unverifiedMeters === null
          ? null
          : Number((unverifiedMeters / METERS_PER_MILE).toFixed(1)),
      whyKey: `why-${candidate.id}`,
      trafficLabel:
        ownTraffic === "Traffic unknown" && routeTraffic?.routeId === candidate.id
          ? routeTraffic.label
          : ownTraffic,
      isSelected: candidate.id === selectedRouteId,
    };
  });
}

function trafficLabelFor(candidate: RouteCandidate): string {
  const band = candidate.evidence["trafficBand"];
  if (
    band !== undefined
    && (band.status === "known" || band.status === "estimated")
    && typeof band.value === "string"
    && band.value.length > 0
  ) return band.value;
  return "Traffic unknown";
}

function requiresDestination(document: RideDocument): boolean {
  // A loop rides back to its origin (06 §17), so only a start is required.
  return document.intent.shape !== "loop";
}

/**
 * What an unarmed map click still has to author: the one point this ride needs,
 * in the order a rider can act on it (04 §3, §5; OGV-D-213).
 *
 * `null` means the ride has everything planning requires, so a click on the map
 * is a selection click rather than an authorship one. A loop needs only its
 * origin (06 §17), so an authored destination never blocks a loop. A committed
 * sketch satisfies a missing endpoint with its own trace (04 §19 "first stroke in
 * a new ride derives start/finish"), which is why the derived endpoints are an
 * input here rather than a detail of the request builder.
 */
export type PlacementTarget = "start" | "finish" | null;

/** The start the sketch supplies, or `null` when it supplies none. */
function sketchStart(endpoints: SketchEndpoints | null): Coordinate | null {
  return endpoints === null ? null : endpoints.start;
}

/** The finish the sketch supplies, or `null` when it supplies none. */
function sketchFinish(endpoints: SketchEndpoints | null): Coordinate | null {
  return endpoints === null ? null : endpoints.finish;
}

/** The next point this ride needs, or `null` when planning is unblocked. */
export function nextPlacementTarget(
  document: RideDocument,
  endpoints: SketchEndpoints | null = null,
): PlacementTarget {
  if (document.intent.start === null && sketchStart(endpoints) === null) return "start";
  if (
    requiresDestination(document) &&
    document.intent.finish === null &&
    sketchFinish(endpoints) === null
  ) {
    return "finish";
  }
  return null;
}

/**
 * The idle status reports the plan's state, not a second instruction.
 *
 * The composer's disabled reason is the single explanation of why planning is
 * blocked (OGV-D-214), so the status line must not restate it: on a phone both
 * are on screen at once, and "Set your start on the map." above "Set a start
 * point on the map." was the duplication the first preview review flagged.
 */
function idleStatus(document: RideDocument, endpoints: SketchEndpoints | null): string {
  return nextPlacementTarget(document, endpoints) === null ? "Ready to plan." : "No plan yet.";
}

/** True when a route is currently on screen, from this attempt or the last one. */
function hasRouteOnScreen(session: PlanningSessionSnapshot): boolean {
  return drawableBundle(session) !== null;
}

/**
 * True when this attempt answers a *newer* revision than the route on screen,
 * i.e. the rider is changing a ride that already has an answer. The controller
 * keeps the previous bundle as `lastGoodBundle` during a replan (OGV-D-168), so
 * the revision is what distinguishes "finding" from "updating" — `lastGood` is
 * also refreshed by a successful commit, which is not an update.
 */
/**
 * The session as the planner shows it (UX audit PP-01 / CL-01).
 *
 * When an edit or an undo leaves the ride without a point it needs, the last
 * answer answers a ride that no longer exists: its route cards, line, briefing
 * and "Ride ready." would all describe it. The session keeps that answer (so an
 * undo that restores the point replans at once), but the planner shows none of
 * it until the ride is whole again.
 */
export function visiblePlanningSession(
  document: RideDocument,
  session: PlanningSessionSnapshot,
  sketchPreview: { readonly generations: readonly number[]; readonly drawing: boolean } = {
    generations: [],
    drawing: false,
  },
): PlanningSessionSnapshot {
  const drawn = session.committedBundle ?? session.lastGoodBundle;
  // A snap-as-you-go answer plans a drawing the ride does not hold: once the
  // pen is put away without Done, it describes nothing and is not shown
  // (OGV-D-285).
  if (!sketchPreview.drawing && isSketchPreviewBundle(drawn, sketchPreview.generations)) {
    return {
      ...session,
      phase: isPlanningInFlight(session.phase) ? session.phase : "idle",
      committedBundle: null,
      lastGoodBundle: null,
      selectedRouteId: null,
      error: null,
    };
  }
  if (drawn === null || drawn.rideRevision === document.revision) return session;
  if (isPlanningInFlight(session.phase)) return session;
  if (document.intent.sketch !== null || nextPlacementTarget(document) === null) return session;
  return {
    ...session,
    phase: "idle",
    committedBundle: null,
    lastGoodBundle: null,
    selectedRouteId: null,
    error: null,
  };
}

function isReplanningAnswer(session: PlanningSessionSnapshot): boolean {
  const previous = session.lastGoodBundle;
  return previous !== null && previous.rideRevision !== session.identity.rideRevision;
}

function statusFor(
  phase: PlanningSessionSnapshot["phase"],
  document: RideDocument,
  session: PlanningSessionSnapshot,
  endpoints: SketchEndpoints | null,
): string {
  switch (phase) {
    case "idle":
      return idleStatus(document, endpoints);
    case "validating":
    case "routing-primary":
      return isReplanningAnswer(session) ? "Updating ride…" : "Finding your ride…";
    case "primary-ready":
    case "alternatives-loading":
      return "Finding other roads…";
    case "ready":
      return isReplanningAnswer(session) ? "Ride updated." : "Ride ready.";
    case "failed":
      return hasRouteOnScreen(session)
        ? "Planning failed — your previous ride is still shown."
        : "Planning failed.";
    case "cancelled":
      return hasRouteOnScreen(session)
        ? "Planning cancelled — showing your last ride."
        : "Planning cancelled.";
  }
}

function disabledReasonFor(
  document: RideDocument,
  phase: PlanningSessionSnapshot["phase"],
  endpoints: SketchEndpoints | null,
): string | null {
  // A ride with nothing to plan says what is missing, even while an older
  // attempt is still settling: "on its way" over an empty form read as stuck
  // (owner review 2026-10-04).
  const target = nextPlacementTarget(document, endpoints);
  if (target === "start") return DISABLED_MISSING_START;
  if (target === "finish") return DISABLED_MISSING_FINISH;
  if (isPlanningInFlight(phase)) return DISABLED_IN_FLIGHT;
  return null;
}

/**
 * The object list (04 §15): start, then the stops in their authored order, then
 * the finish. Shaping anchors are projected separately — the product rule is
 * explicit that they never appear in the itinerary.
 */
function pointRows(document: RideDocument, placeNameFor?: PlaceNameLookup): {
  readonly itinerary: readonly PointRowVm[];
  readonly shapingPoints: readonly PointRowVm[];
} {
  const itinerary: PointRowVm[] = [];
  const start = document.intent.start;
  if (start !== null) {
    itinerary.push({
      ref: { kind: "start" },
      kind: "start",
      label: formatEndpointLabel(start, placeNameFor),
      coordinateLabel: formatEndpointCoordinate(start) ?? "",
      coordinate: start.coordinate,
      arrivalIntent: null,
      position: null,
    });
  }
  document.intent.stops.forEach((stop, index) => {
    itinerary.push({
      ref: { kind: "stop", stopId: stop.id },
      kind: "stop",
      label: formatEndpointLabel(stop, placeNameFor),
      coordinateLabel: formatEndpointCoordinate(stop) ?? "",
      coordinate: stop.coordinate,
      arrivalIntent: stop.arrivalIntent ?? null,
      position: index + 1,
    });
  });
  const finish = document.intent.finish;
  if (finish !== null) {
    itinerary.push({
      ref: { kind: "finish" },
      kind: "finish",
      label: formatEndpointLabel(finish, placeNameFor),
      coordinateLabel: formatEndpointCoordinate(finish) ?? "",
      coordinate: finish.coordinate,
      arrivalIntent: null,
      position: null,
    });
  }
  return {
    itinerary,
    shapingPoints: document.intent.shaping.map((anchor) => ({
      ref: { kind: "shaping", shapingId: anchor.id },
      kind: "shaping" as const,
      // A shaping anchor carries no name and can never be given one: it is a pin
      // the rider dragged onto the map, so the coordinate *is* its identity.
      label: DROPPED_PIN_LABEL,
      coordinateLabel: formatEndpointCoordinate(anchor) ?? "",
      coordinate: anchor.coordinate,
      arrivalIntent: null,
      position: null,
    })),
  };
}

/**
 * The label of the history entry the given move would cross (04 §20's undo
 * labels). Read from the document, so the control always describes the entry it
 * would actually undo.
 */
function historyLabel(document: RideDocument, direction: "undo" | "redo"): string | null {
  const { entries, cursor } = document.history;
  const entry = entries[direction === "undo" ? cursor : cursor + 1];
  if (entry === undefined) return null;
  if (direction === "undo" ? !canUndo(document) : !canRedo(document)) return null;
  return entry.label;
}

/**
 * Projects one view model. Pure and total: every phase produces copy, every
 * missing value stays visibly missing, and no field is invented.
 */
export function buildPlannerViewModel(
  input: PlannerViewModelInput,
): PlannerViewModel {
  const { document, session } = input;
  const derived = input.sketchDerivedEndpoints ?? null;
  const bundle = drawableBundle(session);
  const selectedRouteId = bundle?.selectedRouteId ?? null;
  const cards = routeCards(bundle, selectedRouteId, input.routeTraffic);
  const reading = session.diagnostics.find((diagnostic) => diagnostic.outcome === "ok" && diagnostic.funCharacter !== undefined)?.funCharacter;
  const disabledReason = disabledReasonFor(document, session.phase, derived);
  const rows = pointRows(document, input.placeNameFor);
  const failed = session.phase === "failed";
  return {
    phase: session.phase,
    statusMessage: statusFor(session.phase, document, session, derived),
    startLabel:
      document.intent.start !== null
        ? formatEndpointLabel(document.intent.start, input.placeNameFor)
        : derived === null
          ? NO_START_LABEL
          : SKETCH_DERIVED_LABEL,
    startCoordinateLabel:
      document.intent.start !== null
        ? formatEndpointCoordinate(document.intent.start)
        : derived === null
          ? null
          : sketchDerivedCoordinate(derived.start),
    finishLabel:
      document.intent.finish !== null
        ? formatEndpointLabel(document.intent.finish, input.placeNameFor)
        : derived === null
          ? NO_FINISH_LABEL
          : SKETCH_DERIVED_LABEL,
    finishCoordinateLabel:
      document.intent.finish !== null
        ? formatEndpointCoordinate(document.intent.finish)
        : derived === null
          ? null
          : sketchDerivedCoordinate(derived.finish),
    canPlan: disabledReason === null,
    disabledReason,
    routeCards: cards,
    routingComparisons: buildRoutingMethodComparison({
      bundle: bundle === null ? null : { ...bundle, candidates: bundle.candidates.filter((candidate) => cards.some((card) => card.routeId === candidate.id)) },
      selectedRouteId,
      intent: document.intent,
      stale: bundle !== null && (bundle.rideId !== session.identity.rideId || bundle.rideRevision !== document.revision || bundle.rideRevision !== session.identity.rideRevision || bundle.planningGeneration !== session.identity.planningGeneration),
      ...(reading === undefined ? {} : { reading }),
      labelFor: (id) => cards.find((card) => card.routeId === id)?.roleLabel ?? null,
    }),
    selectedRouteId,
    errorMessage:
      session.error === null ? null : planningErrorCopy(session.error.code, document, session.error.riderMessage),
    failed,
    planLabel: failed
      ? PLAN_LABEL_RETRY
      : (bundle?.candidates.length ?? 0) > 0
        ? PLAN_LABEL_UPDATE
        : PLAN_LABEL_CREATE,
    planIsCurrent:
      !failed &&
      bundle !== null &&
      bundle.candidates.length > 0 &&
      bundle.rideRevision === document.revision,
    itinerary: rows.itinerary,
    shapingPoints: rows.shapingPoints,
    undoLabel: historyLabel(document, "undo"),
    redoLabel: historyLabel(document, "redo"),
  };
}

/** The §29 copy for one error code, with the loop's destination-free variant. */
export function planningErrorCopy(code: PlanningErrorCode, document: RideDocument, riderMessage?: string): string {
  if (code === "no-route" && riderMessage !== undefined && riderMessage.length > 0) return riderMessage;
  if (code === "no-route" && document.intent.shape === "loop") {
    return NO_ROUTE_LOOP_COPY;
  }
  return ERROR_COPY[code];
}
