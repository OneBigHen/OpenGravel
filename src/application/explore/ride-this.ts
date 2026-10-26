/**
 * "Ride this" from Explore: the route a rider was reading opens in the planner
 * as that ride's own line.
 *
 * A catalog route already carries the line it is published with, and the route
 * page has just drawn it. Opening the planner by re-planning the same start and
 * finish made the rider wait for an answer they had already seen, and it could
 * come back as a different line than the one they chose. So the ride is opened
 * the way a saved ride opens (a derivative document the planner restores) and
 * the line it was read with is handed over as the answer for that ride.
 *
 * What is handed over, and what is not:
 *
 * - the line is the catalog route's own geometry, stored in the same geometry
 *   store the planner reads, so nothing is re-measured or re-routed here;
 * - the distance and the time are the route's published numbers, and a route
 *   with neither is opened without a prepared answer instead of a guessed one;
 * - the answer claims no score and no evidence (`unscored`, evidence empty), so
 *   the planner keeps saying "surface unknown" rather than inventing a verdict.
 *
 * Only a published catalog route qualifies. A saved or imported ride's line is
 * the rider's own record or track, not a routing answer, so those rides open the
 * ordinary way and are planned by the planner itself.
 *
 * The handoff is one short-lived session-storage record, so it survives the
 * client-side navigation and nothing else: it is dropped as soon as the planner
 * reads it, and it expires if it is never read.
 */

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { CatalogEntry } from "@/application/explore/catalog";
import type { ClientPlanningService } from "@/application/planner/client-planning-service";
import { UNSCORED_POLICY_VERSION } from "@/application/planner/planning-controller";
import { emptyRouteRoles, type PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { RouteBundle, RouteCandidate, RouteScore, RouteScoreComponents } from "@/domain/route/types";
import { asRouteCandidateId } from "@/domain/route/ids";

/** The one key the handoff uses; it holds one ride at a time. */
export const PREPARED_ROUTE_STORAGE_KEY = "opengravel.explore.ride-this";

/**
 * How long a prepared route waits for the planner. The planner is a client-side
 * navigation away, so this only has to cover a slow phone; an older record is a
 * leftover and is ignored rather than applied to whatever ride is open.
 */
export const PREPARED_ROUTE_TTL_MS = 90_000;

/**
 * The mile pace used when the catalog carries no ride time, and the rounding the
 * route page states its estimate with. Both surfaces must read the same number
 * for the same route (`RouteDetail`'s "Est. time" and the planner's card).
 */
const ESTIMATE_MPH = 28;
const ESTIMATE_STEP_MINUTES = 15;

/** The slice of Web Storage this module needs; the browser's sessionStorage. */
export interface PreparedRouteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One route handed from Explore to the planner, ready to be the answer. */
export interface PreparedRoute {
  readonly version: 1;
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly geometryRef: GeometryRef;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly preparedAt: string;
}

function browserStorage(): PreparedRouteStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

function knownMeters(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Whether the route can be ridden as it is: a published catalog line with at
 * least two points. Everything else is a ride the planner has to plan.
 */
export function canOpenAsItsOwnRoute(entry: CatalogEntry): boolean {
  return entry.source === "catalog" && entry.geometry.length >= 2;
}

/** The ride's own distance and time, or `null` when the route states neither. */
function routeNumbers(entry: CatalogEntry): { readonly distanceMeters: number; readonly durationSeconds: number } | null {
  if (!knownMeters(entry.distanceKm)) return null;
  const distanceMeters = entry.distanceKm * 1000;
  if (knownMeters(entry.estimatedTimeMinutes)) {
    return { distanceMeters, durationSeconds: entry.estimatedTimeMinutes * 60 };
  }
  // The catalog carries no ride time: borrow the route page's estimate, rounded
  // the same way, so the planner's card does not state a second number.
  const minutes = Math.max(
    ESTIMATE_STEP_MINUTES,
    Math.round((distanceMeters / 1609.344 / ESTIMATE_MPH) * 60 / ESTIMATE_STEP_MINUTES) * ESTIMATE_STEP_MINUTES,
  );
  return { distanceMeters, durationSeconds: minutes * 60 };
}

/**
 * Store the route's line and leave the note the planner reads.
 *
 * Returns `null` (and writes nothing) when this route is not one that can be
 * ridden as it is, so the caller falls back to opening the ride plainly.
 */
export async function prepareExploreRoute(
  entry: CatalogEntry,
  document: RideDocument,
  geometryStore: Pick<GeometryStore, "put">,
  options: {
    readonly now?: () => string;
    readonly storage?: PreparedRouteStorage | null;
  } = {},
): Promise<PreparedRoute | null> {
  if (!canOpenAsItsOwnRoute(entry)) return null;
  const numbers = routeNumbers(entry);
  if (numbers === null) return null;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (storage === null) return null;
  const now = options.now ?? ((): string => new Date().toISOString());
  const preparedAt = now();
  const record = await geometryStore.put(
    { kind: "line", coordinates: entry.geometry.map(copyCoordinate) },
    { kind: "route", now: preparedAt },
  );
  const prepared: PreparedRoute = {
    version: 1,
    rideId: document.rideId,
    rideRevision: document.revision,
    geometryRef: record.geometryRef,
    ...numbers,
    preparedAt,
  };
  try {
    storage.setItem(PREPARED_ROUTE_STORAGE_KEY, JSON.stringify(prepared));
  } catch {
    // A storage that refuses the write only costs the rider the replan.
    return null;
  }
  return prepared;
}

function parsePreparedRoute(value: unknown): PreparedRoute | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1) return null;
  if (typeof record["rideId"] !== "string" || record["rideId"].length === 0) return null;
  if (typeof record["rideRevision"] !== "number" || !Number.isSafeInteger(record["rideRevision"]) || record["rideRevision"] < 0) return null;
  if (typeof record["geometryRef"] !== "string" || record["geometryRef"].length === 0) return null;
  if (typeof record["preparedAt"] !== "string" || !Number.isFinite(Date.parse(record["preparedAt"]))) return null;
  if (typeof record["distanceMeters"] !== "number" || !Number.isFinite(record["distanceMeters"]) || record["distanceMeters"] <= 0) return null;
  if (typeof record["durationSeconds"] !== "number" || !Number.isFinite(record["durationSeconds"]) || record["durationSeconds"] <= 0) return null;
  return {
    version: 1,
    rideId: record["rideId"] as RideId,
    rideRevision: record["rideRevision"],
    geometryRef: record["geometryRef"] as GeometryRef,
    distanceMeters: record["distanceMeters"],
    durationSeconds: record["durationSeconds"],
    preparedAt: record["preparedAt"],
  };
}

/**
 * Read the handoff once: the record is dropped whatever happens next, so a
 * later page view can never open a route the rider did not just ask for.
 */
export function takePreparedRoute(options: {
  readonly now?: () => string;
  readonly storage?: PreparedRouteStorage | null;
  readonly maxAgeMs?: number;
} = {}): PreparedRoute | null {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (storage === null) return null;
  const raw = storage.getItem(PREPARED_ROUTE_STORAGE_KEY);
  if (raw === null) return null;
  try {
    storage.removeItem(PREPARED_ROUTE_STORAGE_KEY);
  } catch {
    // An unreadable store is not a reason to apply an unverified record.
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const prepared = parsePreparedRoute(parsed);
  if (prepared === null) return null;
  const now = Date.parse((options.now ?? ((): string => new Date().toISOString()))());
  const maxAge = options.maxAgeMs ?? PREPARED_ROUTE_TTL_MS;
  if (!Number.isFinite(now) || now - Date.parse(prepared.preparedAt) > maxAge) return null;
  return prepared;
}

/**
 * The documented placeholder score: no policy produced it and no component
 * measured anything, so nothing downstream can read a verdict here. The same
 * shape the planner's own placeholder pipeline uses for a candidate it did not
 * score (`UNSCORED_POLICY_VERSION`).
 */
function unscoredScore(): RouteScore {
  const component = (key: string): RouteScoreComponents["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `unscored.${key}`,
    evidenceStatus: "unknown",
  });
  return {
    policyVersion: UNSCORED_POLICY_VERSION,
    total: 0,
    components: {
      curvature: component("curvature"),
      backroad: component("backroad"),
      surfaceFit: component("surfaceFit"),
      elevation: component("elevation"),
      traffic: component("traffic"),
      junctionFriction: component("junctionFriction"),
      novelty: component("novelty"),
      closureRisk: component("closureRisk"),
      timeCost: component("timeCost"),
      confidence: component("confidence"),
    },
  };
}

/** The answer the planner shows for the prepared ride, before any attempt. */
export function preparedRouteAnswer(prepared: PreparedRoute): RouteBundle {
  // A ride session only binds `route_…` identities (validateSessionRouteBinding),
  // so the handed-over line wears that prefix or Start ride is refused.
  const candidateId = asRouteCandidateId(`route_explore-${prepared.rideId}`);
  const candidate: RouteCandidate = {
    id: candidateId,
    // Provenance for diagnostics only: the line came from the published route.
    provider: { providerId: "explore-catalog", profile: "catalog-route" },
    geometryRef: prepared.geometryRef,
    distanceMeters: prepared.distanceMeters,
    durationSeconds: prepared.durationSeconds,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: unscoredScore(),
    warnings: [],
    fingerprint: `explore-catalog:${prepared.geometryRef}`,
  };
  return {
    rideId: prepared.rideId,
    rideRevision: prepared.rideRevision,
    planningGeneration: 1,
    policyVersion: UNSCORED_POLICY_VERSION,
    graphVersion: "unknown",
    evidenceVersion: "unknown",
    candidates: [candidate],
    selectedRouteId: candidateId,
    selectionSource: "automatic",
    roles: emptyRouteRoles(),
    createdAt: prepared.preparedAt,
  };
}

/** The session the planner shows while the prepared answer is the answer. */
export function preparedRouteSession(prepared: PreparedRoute): PlanningSessionSnapshot {
  const bundle = preparedRouteAnswer(prepared);
  return {
    identity: {
      rideId: prepared.rideId,
      rideRevision: prepared.rideRevision,
      planningGeneration: bundle.planningGeneration,
    },
    // `ready` is what the planner says for an answer it holds: "Ride ready."
    phase: "ready",
    lastGoodBundle: bundle,
    committedBundle: bundle,
    selectionSource: "automatic",
    selectedRouteId: bundle.selectedRouteId,
    error: null,
    diagnostics: [],
    startedAt: prepared.preparedAt,
    settledAt: prepared.preparedAt,
  };
}

/**
 * A planning service that answers with the prepared route until the session has
 * an answer of its own.
 *
 * It is a decorator, not a second session: every command (`begin`, `cancel`,
 * `selectRoute`, `dispose`) still goes to the real controller, and the prepared
 * answer is only shown while that controller holds nothing (idle, no bundle).
 * The first real attempt takes over completely, which is what keeps one plan
 * lifecycle — an edit made in the planner replans exactly as it always did.
 *
 * The answer is offered from the first read, before the container has had time
 * to ask for a plan: the ride document is restored asynchronously, so waiting
 * for anything else would let the restored-draft replan win the race and the
 * rider would be back to waiting for an answer they already had. The line was
 * written into the geometry store before the handoff was written, so the card
 * that appears has a line behind it.
 */
export function withPreparedRoute(
  service: ClientPlanningService,
  prepared: PreparedRoute | null,
): ClientPlanningService {
  if (prepared === null) return service;
  const preparedSession = preparedRouteSession(prepared);
  /** A real attempt has begun: the controller owns the answer from now on. */
  let live = false;
  const listeners = new Set<() => void>();

  const ownsAnswer = (inner: PlanningSessionSnapshot): boolean =>
    !live
    && inner.phase === "idle"
    && inner.committedBundle === null
    && inner.lastGoodBundle === null
    && (inner.identity.rideId === null || inner.identity.rideId === prepared.rideId);

  return {
    snapshot: (): PlanningSessionSnapshot => {
      const inner = service.snapshot();
      return ownsAnswer(inner) ? preparedSession : inner;
    },
    begin: (input): Promise<void> => {
      live = true;
      return service.begin(input);
    },
    cancel: (): void => service.cancel(),
    selectRoute: (routeId): void => service.selectRoute(routeId),
    dispose: (): void => service.dispose(),
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      const unsubscribe = service.subscribe(listener);
      // The container reads the prepared answer once, in this same tick, so it
      // caches the prepared line through `readGeometry` and draws it before the
      // ride document restore can ask for a fresh plan.
      queueMicrotask(() => {
        if (!live) for (const notify of [...listeners]) notify();
      });
      return (): void => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    readGeometry: (ref): Promise<GeometryPayload | null> => service.readGeometry(ref),
  };
}

/**
 * The prepared route for this page load, read at most once.
 *
 * The read is memoized here rather than in a component: a render pass that runs
 * twice must not consume the record and lose it.
 */
let pendingPreparedRoute: PreparedRoute | null | undefined;

export function takePreparedRouteOnce(): PreparedRoute | null {
  if (pendingPreparedRoute === undefined) pendingPreparedRoute = takePreparedRoute();
  return pendingPreparedRoute;
}

/**
 * The geometry this page must not reclaim while it is in use.
 *
 * The prepared line is referenced by the ride session rather than by a library
 * row, so the storage sweep cannot tell it apart from an orphan. It is kept for
 * the life of the page, which is exactly as long as the ride that uses it.
 */
export function preparedRouteGeometryRefs(): readonly GeometryRef[] {
  const prepared = takePreparedRouteOnce();
  return prepared === null ? [] : [prepared.geometryRef];
}
