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
import {
  createPlanningController,
  createStubCandidatePipeline,
  type CandidatePipelineInput,
  type CandidatePipelineRoleInput,
} from "@/application/planner/planning-controller";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { LibraryExploreRide } from "@/application/library/library-service";
import { personalNoveltyEvidence, personalRideHistory, type PersonalRideTrace } from "@/application/roads/personal-road-history";
import { isUsableEvidence } from "@/domain/evidence/types";
import { withOfflineFallback, type OfflineRouteEngine } from "@/application/offline/offline-route-fallback";
import { createOfflineRouteEngine } from "@/infrastructure/offline/offline-route-engine";
import { RegionDownloadStore } from "@/infrastructure/offline/region-download-store";
import { createApiRouteProvider } from "@/infrastructure/routing/api-provider";
import { profileFor as graphHopperProfileFor } from "@/infrastructure/routing/graphhopper/profiles";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { RideIntent } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { ProviderCandidate, RouteCandidateProvider } from "@/application/planner/route-provider";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { assignRoles } from "@/domain/route/roles";
import { replaceNoveltyScore } from "@/domain/route/scoring";
import type { RouteCandidate, RouteRoles } from "@/domain/route/types";
import { timeboxPreferredIndexes } from "./pipeline";

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
  /** Local-only recorded ride history; never sent to a provider. */
  readonly localHistoryReader?: () => Promise<readonly Pick<LibraryExploreRide, "geometry" | "riddenAt">[]>;
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

const LOCAL_HISTORY_CACHE_LIMIT = 8;

/** The longest the full request waits for the first-route answer before going anyway. */
const FIRST_ROUTE_WAIT_MS = 25_000;

function attemptKey(input: { readonly rideId: RideId | null; readonly rideRevision: number; readonly planningGeneration: number }): string {
  return `${input.rideId}:${input.rideRevision}:${input.planningGeneration}`;
}

interface LocalHistoryPipeline {
  readonly candidateTransform: (
    input: CandidatePipelineInput,
    providerCandidate: ProviderCandidate,
    candidate: RouteCandidate,
  ) => Promise<RouteCandidate>;
  readonly roleAssigner: (input: CandidatePipelineRoleInput) => RouteRoles | null;
}

function createLocalHistoryPipeline(
  options: Pick<ClientPlanningServiceOptions, "localHistoryReader" | "now">,
): LocalHistoryPipeline {
  const historyPromises = new Map<string, Promise<readonly PersonalRideTrace[]>>();
  const usableHistory = new Set<string>();
  const now = options.now ?? ((): string => new Date().toISOString());
  const policy = PA_NJ_ROUTE_POLICY_VNEXT_1;

  const historyFor = (input: CandidatePipelineInput): Promise<readonly PersonalRideTrace[]> => {
    const key = attemptKey(input.identity);
    const existing = historyPromises.get(key);
    if (existing !== undefined) return existing;
    const promise = options.localHistoryReader === undefined
      ? Promise.resolve<readonly PersonalRideTrace[]>([])
      : Promise.resolve()
          .then(() => options.localHistoryReader!())
          .then((entries) => personalRideHistory(entries))
          .catch(() => [] as readonly PersonalRideTrace[]);
    historyPromises.set(key, promise);
    while (historyPromises.size > LOCAL_HISTORY_CACHE_LIMIT) {
      const oldest = historyPromises.keys().next().value;
      if (oldest === undefined) break;
      historyPromises.delete(oldest);
      usableHistory.delete(oldest);
    }
    return promise;
  };

  const candidateTransform = async (
    input: CandidatePipelineInput,
    providerCandidate: ProviderCandidate,
    candidate: RouteCandidate,
  ): Promise<RouteCandidate> => {
    const history = await historyFor(input);
    const key = attemptKey(input.identity);
    if (history.length === 0 || candidate.score.policyVersion !== policy.version) return candidate;
    const novelty = personalNoveltyEvidence(providerCandidate.geometry, history, { now: now() });
    if (!isUsableEvidence(novelty)) return candidate;
    usableHistory.add(key);
    const evidence = { ...candidate.evidence, novelty };
    const score = replaceNoveltyScore({
      score: candidate.score,
      evidence,
      intent: {
        roadCharacter: input.request.options.roadCharacter,
        noveltyPreference: input.request.options.noveltyPreference,
      },
      policy,
    });
    return {
      ...candidate,
      evidence,
      score,
    };
  };

  const roleAssigner = (input: CandidatePipelineRoleInput): RouteRoles | null => {
    if (!usableHistory.has(attemptKey(input.identity))) return null;
    const candidates = input.candidates.filter((candidate) => candidate.eligibility.eligible);
    const preferred = timeboxPreferredIndexes(candidates, input.discoveryTimebox);
    const canBeBestRide = preferred === null
      ? undefined
      : (candidate: { readonly id: string | number }): boolean => {
          const index = candidates.findIndex((entry) => entry.id === candidate.id);
          return index >= 0 && preferred.has(index);
        };
    return assignRoles(
      candidates.map((candidate) => ({
        id: candidate.id,
        durationSeconds: candidate.durationSeconds,
        distanceMeters: candidate.distanceMeters,
        score: candidate.score,
      })),
      policy,
      undefined,
      canBeBestRide,
    );
  };

  return { candidateTransform, roleAssigner };
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
  // Long routes take the engine many seconds to widen into alternatives. A
  // second request for the main route alone lets the planner show a ride as
  // soon as it exists while "Finding other roads…" keeps filling in the rest.
  const firstRouteProvider =
    (options.includeAlternatives ?? true)
      ? createApiRouteProvider({
          ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
          ...(options.routePlanPath === undefined ? {} : { path: options.routePlanPath }),
          firstRouteOnly: true,
        })
      : null;
  // The server does its scoring on one thread, so two requests sent together
  // slow each other down (measured: 6 s alone, 16-23 s together). The full
  // request therefore waits for the first-route answer (or 25 s, whichever is
  // first) before it goes out: the rider sees a ride sooner and everything
  // still arrives.
  let firstRouteSettled: Promise<void> = Promise.resolve();
  const startedFirstRoute: RouteCandidateProvider | null =
    firstRouteProvider === null
      ? null
      : {
          ...firstRouteProvider,
          candidates: (request, signal) => {
            const answer = firstRouteProvider.candidates(request, signal);
            firstRouteSettled = answer.then(() => undefined, () => undefined);
            return answer;
          },
        };
  const fullProvider: RouteCandidateProvider =
    firstRouteProvider === null
      ? apiProvider
      : {
          ...apiProvider,
          candidates: async (request, signal) => {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, FIRST_ROUTE_WAIT_MS);
              const done = (): void => { clearTimeout(timer); resolve(); };
              void firstRouteSettled.then(done);
              signal.addEventListener("abort", done, { once: true });
            });
            if (signal.aborted) throw signal.reason;
            return apiProvider.candidates(request, signal);
          },
        };
  const listeners = new Set<() => void>();
  const offlineEngine = options.offlineEngine === undefined ? defaultOfflineEngine() : options.offlineEngine;
  const localHistoryPipeline = createLocalHistoryPipeline({
    ...(options.localHistoryReader === undefined ? {} : { localHistoryReader: options.localHistoryReader }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const controller = createPlanningController({
    providers: [
      ...(startedFirstRoute === null ? [] : [startedFirstRoute]),
      offlineEngine === null ? fullProvider : withOfflineFallback(fullProvider, offlineEngine),
    ],
    requestContext: {
      resolveGeometry: async (ref): Promise<GeometryPayload | null> => {
        const record = await geometryStore.get(ref);
        return record?.payload ?? null;
      },
      profileFor: options.profileFor ?? graphHopperProfileFor,
      includeAlternatives: options.includeAlternatives ?? true,
    },
    geometryStore,
    pipeline: createStubCandidatePipeline({
      geometryStore,
      ...(options.now === undefined ? {} : { now: options.now }),
      candidateTransform: localHistoryPipeline.candidateTransform,
      roleAssigner: localHistoryPipeline.roleAssigner,
    }),
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
      const identity = {
        rideId: input.rideId,
        rideRevision: input.rideRevision,
        planningGeneration: controller.snapshot().identity.planningGeneration,
      };
      apiProvider.beginAttempt(identity);
      firstRouteProvider?.beginAttempt(identity);
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
