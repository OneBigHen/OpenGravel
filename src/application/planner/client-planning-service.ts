/**
 * The client composition root (02-ARCHITECTURE-CONTRACT §7, §8, §17).
 *
 * One factory that wires the pieces a browser planner needs and nothing else:
 *
 * ```text
 * api-provider (infrastructure/routing)  ─┐
 * graphhopper profile mapping            ─┼→ PlanningController (application)
 * memory GeometryStore (this slice)      ─┘        ↑
 *                                          planning-session-store (ui)
 * ```
 *
 * ## Why the wiring lives here, not in the store
 *
 * Architecture rule B forbids `src/ui/**` from importing
 * `src/infrastructure/routing/**`. The store therefore receives a ready-made
 * service from this module instead of constructing one, and the store stays a
 * container with no knowledge of transports. This module *is* the client
 * composition root, which is why it is allowed to name the deployment's adapter
 * and its engine-profile mapping; no other application module may.
 *
 * ## Why the identity is installed after `begin`
 *
 * The `RouteCandidateProvider` port carries a provider-neutral request, which
 * has no `rideId`/revision/generation (Task 2.1). The bridge needs them for the
 * API's ownership identity, so `begin` scopes the attempt on the provider
 * *synchronously* right after `controller.begin(...)` — the controller moves
 * ownership before it aborts the previous attempt (OGV-D-169), and a superseded
 * attempt never reaches `candidates()` at all. The generation is read back from
 * the controller rather than counted twice, so the two can never disagree.
 */

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { PlanRequestVersions } from "@/application/planner/build-plan-request";
import { createPlanningController } from "@/application/planner/planning-controller";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import { withOfflineFallback, type OfflineRouteEngine } from "@/application/offline/offline-route-fallback";
import { createOfflineRouteEngine } from "@/infrastructure/offline/offline-route-engine";
import { RegionDownloadStore } from "@/infrastructure/offline/region-download-store";
import { createApiRouteProvider } from "@/infrastructure/routing/api-provider";
import { profileFor as graphHopperProfileFor } from "@/infrastructure/routing/graphhopper/profiles";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { RideIntent } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";

/** Marks a policy/score/role answer that no policy produced yet. */
export const STUB_POLICY_VERSION = "VNEXT_STUB_0";

/**
 * Client-side planning versions. The graph and evidence versions are `unknown`
 * until the deployment declares them (23 §12 reports the same defaults), and the
 * policy version is the stub marker — a cache key must never claim a policy the
 * build does not have.
 */
export const DEFAULT_CLIENT_PLAN_VERSIONS: PlanRequestVersions = {
  routePolicy: STUB_POLICY_VERSION,
  graph: "unknown",
  evidence: "unknown",
};

export interface ClientPlanningBeginInput {
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly intent: RideIntent;
}

/** The surface a store container consumes. */
export interface ClientPlanningService {
  snapshot(): PlanningSessionSnapshot;
  /** Starts an attempt; resolves when it is no longer the owner (OGV-D-169). */
  begin(input: ClientPlanningBeginInput): Promise<void>;
  cancel(): void;
  selectRoute(routeId: RouteCandidateId): void;
  dispose(): void;
  /** Snapshot-change notification (OGV-D-175). */
  subscribe(listener: () => void): () => void;
  /** Reads a stored geometry payload for the map projection. */
  readGeometry(ref: GeometryRef): Promise<GeometryPayload | null>;
}

export interface ClientPlanningServiceOptions {
  /** Injectable `fetch` for tests and non-browser transports. */
  readonly fetcher?: typeof fetch;
  /** Where candidate geometry is stored; an in-memory store by default. */
  readonly geometryStore?: GeometryStore;
  readonly versions?: PlanRequestVersions;
  /** Deployment profile mapping; the GraphHopper baseline by default. */
  readonly profileFor?: (intent: RideIntent) => string;
  readonly now?: () => string;
  readonly includeAlternatives?: boolean;
  readonly routePlanPath?: string;
  /**
   * Plans from downloaded offline regions when the planner cannot be reached.
   * The browser's worker-backed engine by default; `null` turns it off.
   */
  readonly offlineEngine?: OfflineRouteEngine | null;
}

function defaultOfflineEngine(): OfflineRouteEngine | null {
  if (typeof Worker === "undefined" || typeof indexedDB === "undefined") return null;
  const engine = createOfflineRouteEngine();
  // With a downloaded area, load a routing worker while there is signal: once
  // it is lost, the browser cannot fetch the worker's script (OF-01).
  void new RegionDownloadStore().list().then(
    (regions) => { if (regions.length > 0) engine.prepare(); },
    () => undefined,
  );
  return engine;
}

/** Creates an independent `/api/route-plan` provider for non-PlanningSession flows. */
export function createClientRouteCandidateProvider() {
  return createApiRouteProvider();
}

/** Creates one client planning service (one `PlanningSession`). */
export function createClientPlanningService(
  options: ClientPlanningServiceOptions = {},
): ClientPlanningService {
  const geometryStore = options.geometryStore ?? createMemoryGeometryStore();
  const apiProvider = createApiRouteProvider({
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.routePlanPath === undefined ? {} : { path: options.routePlanPath }),
  });
  const listeners = new Set<() => void>();
  const offlineEngine = options.offlineEngine === undefined ? defaultOfflineEngine() : options.offlineEngine;

  const controller = createPlanningController({
    providers: [offlineEngine === null ? apiProvider : withOfflineFallback(apiProvider, offlineEngine)],
    requestContext: {
      resolveGeometry: async (ref): Promise<GeometryPayload | null> => {
        const record = await geometryStore.get(ref);
        return record?.payload ?? null;
      },
      profileFor: options.profileFor ?? graphHopperProfileFor,
      includeAlternatives: options.includeAlternatives ?? true,
    },
    geometryStore,
    ...(options.now === undefined ? {} : { now: options.now }),
    onUpdate: (): void => {
      for (const listener of [...listeners]) listener();
    },
  });

  return {
    snapshot: (): PlanningSessionSnapshot => controller.snapshot(),

    begin(input: ClientPlanningBeginInput): Promise<void> {
      const attempt = controller.begin({
        rideId: input.rideId,
        rideRevision: input.rideRevision,
        intent: input.intent,
        versions: options.versions ?? DEFAULT_CLIENT_PLAN_VERSIONS,
      });
      // Ownership is moved synchronously inside `begin`, which is what makes
      // reading the generation back here the same generation the providers will
      // be called for.
      apiProvider.beginAttempt({
        rideId: input.rideId,
        rideRevision: input.rideRevision,
        planningGeneration: controller.snapshot().identity.planningGeneration,
      });
      return attempt;
    },

    cancel(): void {
      controller.cancel();
    },

    selectRoute(routeId: RouteCandidateId): void {
      controller.selectRoute(routeId);
    },

    dispose(): void {
      listeners.clear();
      controller.dispose();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    async readGeometry(ref: GeometryRef): Promise<GeometryPayload | null> {
      const record = await geometryStore.get(ref);
      return record?.payload ?? null;
    },
  };
}
