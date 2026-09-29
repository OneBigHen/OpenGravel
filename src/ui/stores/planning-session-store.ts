/**
 * The `PlanningSession` container (02-ARCHITECTURE-CONTRACT §8–§9, §17).
 *
 * It hosts the Task 2.3 controller through the client composition root and
 * republishes its snapshots. Two jobs, both thin:
 *
 * - **Mirror the session.** Every `onUpdate` notification replaces the store's
 *   snapshot, so React re-renders on phase changes, arriving alternatives and
 *   selection changes alike (OGV-D-175).
 * - **Cache candidate geometry.** A bundle holds `GeometryRef`s; the map needs
 *   coordinates. Each candidate's line is read once from the geometry store and
 *   kept in a plain record the projection can read synchronously, so
 *   `buildMapScene` stays a pure function (02 §17).
 *
 * It never decides anything: phases, selection, eligibility and errors all come
 * from the session, and geometry comes from the store the pipeline wrote to.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  ClientPlanningBeginInput,
  ClientPlanningService,
} from "@/application/planner/client-planning-service";
import { createClientPlanningService } from "@/application/planner/client-planning-service";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type { RouteCandidateId } from "@/domain/route/ids";

export interface PlanningSessionState {
  readonly snapshot: PlanningSessionSnapshot;
  /** Candidate geometry by handle; `undefined` means "not read yet". */
  readonly geometry: Readonly<Record<string, GeometryPayload>>;
  readonly begin: (input: ClientPlanningBeginInput) => Promise<void>;
  readonly cancel: () => void;
  readonly selectRoute: (routeId: RouteCandidateId) => void;
}

/** Read-only store surface: no `setState`, no second write path. */
export type PlanningSessionStore = Pick<
  StoreApi<PlanningSessionState>,
  "getState" | "getInitialState" | "subscribe"
>;

export interface PlanningSessionStoreOptions {
  /** Injected service (tests, SSR); the client composition root by default. */
  readonly service?: ClientPlanningService;
}

/** Creates one planning-session container around one service. */
export function createPlanningSessionStore(
  options: PlanningSessionStoreOptions = {},
): PlanningSessionStore {
  const service = options.service ?? createClientPlanningService();
  const store = createStore<PlanningSessionState>((set, get) => {
    const refresh = (): void => {
      const snapshot = service.snapshot();
      set({ snapshot });
      const bundle = snapshot.committedBundle ?? snapshot.lastGoodBundle;
      if (bundle === null) return;
      const missing = bundle.candidates
        .map((candidate) => candidate.geometryRef)
        .filter((ref) => get().geometry[ref] === undefined);
      if (missing.length === 0) return;
      void Promise.all(
        missing.map(
          async (ref): Promise<readonly [GeometryRef, GeometryPayload | null]> => [
            ref,
            await service.readGeometry(ref),
          ],
        ),
      ).then((resolved) => {
        const next: Record<string, GeometryPayload> = { ...get().geometry };
        let changed = false;
        for (const [ref, payload] of resolved) {
          // A handle that resolves to nothing stays missing: the projection
          // draws an empty line rather than a fabricated one.
          if (payload !== null && next[ref] === undefined) {
            next[ref] = payload;
            changed = true;
          }
        }
        if (changed) set({ geometry: next });
      });
    };

    service.subscribe(refresh);

    return {
      snapshot: service.snapshot(),
      geometry: {},
      begin: async (input: ClientPlanningBeginInput): Promise<void> => {
        await service.begin(input);
      },
      cancel: (): void => {
        service.cancel();
      },
      selectRoute: (routeId: RouteCandidateId): void => {
        service.selectRoute(routeId);
      },
    };
  });

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}

/** The process-wide planner session container. */
export const planningSessionStore: PlanningSessionStore = createPlanningSessionStore();
