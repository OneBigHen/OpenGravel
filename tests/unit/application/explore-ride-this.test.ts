/**
 * "Ride this" from Explore: the handoff that opens a catalog route in the
 * planner as that ride's own line.
 *
 * The behaviour these tests pin is what the rider gets: the ride keeps the
 * route's own name, its line is the answer the planner shows, Start ride is
 * available without another plan, and a ride that cannot be opened this way is
 * left to the planner rather than described by a guessed one.
 */

import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import {
  canOpenAsItsOwnRoute,
  prepareExploreRoute,
  preparedRouteAnswer,
  preparedRouteSession,
  PREPARED_ROUTE_STORAGE_KEY,
  PREPARED_ROUTE_TTL_MS,
  KEPT_ROUTE_STORAGE_KEY,
  forgetKeptRoute,
  readKeptRoute,
  preparedRouteGeometryRefs,
  takePreparedRoute,
  takePreparedRouteOnce,
  withPreparedRoute,
  type PreparedRoute,
  type PreparedRouteStorage,
} from "@/application/explore/ride-this";
import { createExploreDerivative, type CatalogEntry } from "@/application/explore/catalog";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { validateSessionRouteBinding } from "@/domain/ride-session/validate";
import type { ClientPlanningService } from "@/application/planner/client-planning-service";
import { emptyPlanningSession, type PlanningSessionSnapshot } from "@/application/planner/planning-session";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";

const NOW = "2026-10-25T12:00:00.000Z";

const LINE: readonly Coordinate[] = [
  { lon: -75.5, lat: 40.5 },
  { lon: -75.35, lat: 40.6 },
  { lon: -75.2, lat: 40.7 },
];

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "sample-ridge-loop",
    source: "catalog",
    name: "Sample Ridge Loop",
    region: "Demo area",
    summary: "A synthetic route.",
    distanceKm: 27.5,
    estimatedTimeMinutes: 58,
    bounds: { west: -75.5, south: 40.5, east: -75.2, north: 40.7 },
    geometry: LINE,
    provenance: "synthetic catalog",
    ...overrides,
  };
}

function memoryStorage(): PreparedRouteStorage & { readonly keys: () => readonly string[] } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    keys: () => [...values.keys()],
  };
}

/** A planning service with no answer of its own, which is what the app starts with. */
function idleService(geometry: GeometryPayload | null = { kind: "line", coordinates: LINE }): {
  readonly service: ClientPlanningService;
  readonly begin: ReturnType<typeof vi.fn>;
  readonly selectRoute: ReturnType<typeof vi.fn>;
} {
  let snapshot: PlanningSessionSnapshot = emptyPlanningSession();
  const begin = vi.fn(async (input: unknown) => { void input; });
  const selectRoute = vi.fn();
  const service: ClientPlanningService = {
    snapshot: () => snapshot,
    begin: async (input) => {
      await begin(input);
      snapshot = { ...snapshot, identity: { rideId: input.rideId, rideRevision: input.rideRevision, planningGeneration: 1 } };
    },
    cancel: () => undefined,
    selectRoute,
    dispose: () => undefined,
    subscribe: () => () => undefined,
    readGeometry: async (ref: GeometryRef) => (geometry === null ? null : { ...geometry, ref }),
  };
  return { service, begin, selectRoute };
}

async function prepared(overrides: Partial<CatalogEntry> = {}): Promise<{
  readonly prepared: PreparedRoute;
  readonly document: ReturnType<typeof createExploreDerivative>;
  readonly storage: ReturnType<typeof memoryStorage>;
  readonly geometryStore: ReturnType<typeof createMemoryGeometryStore>;
}> {
  const geometryStore = createMemoryGeometryStore();
  const storage = memoryStorage();
  const document = createExploreDerivative(entry(overrides), NOW);
  const record = await prepareExploreRoute(entry(overrides), document, geometryStore, {
    now: () => NOW,
    storage,
  });
  expect(record).not.toBeNull();
  return { prepared: record!, document, storage, geometryStore };
}

describe("Explore ride-this handoff", () => {
  it("opens a published catalog route as it is, and only a published catalog route", () => {
    expect(canOpenAsItsOwnRoute(entry())).toBe(true);
    expect(canOpenAsItsOwnRoute(entry({ geometry: LINE.slice(0, 1) }))).toBe(false);
    // A saved or imported ride's line is a record or a track, not an answer.
    expect(canOpenAsItsOwnRoute(entry({ source: "personal" }))).toBe(false);
    expect(canOpenAsItsOwnRoute(entry({ source: "import" }))).toBe(false);
  });

  it("keeps the route's own name on the ride it opens, with no 'copy'", () => {
    const document = createExploreDerivative(entry(), NOW);
    expect(document.title).toBe("Sample Ridge Loop");
    expect(document.provenance).toEqual({ type: "catalog", sourceId: "sample-ridge-loop" });
    // The derived ride still routes through the route's own points.
    expect(document.intent.start?.coordinate).toEqual(LINE[0]);
    expect(document.intent.finish?.coordinate).toEqual(LINE.at(-1));
    expect(document.intent.shaping.length).toBeGreaterThan(0);
  });

  it("hands over the route's line, distance and published time", async () => {
    const { prepared: record, document, geometryStore, storage } = await prepared();

    const stored = await geometryStore.get(record.geometryRef);
    expect(stored?.payload.kind).toBe("line");
    expect(stored?.payload.kind === "line" ? stored.payload.coordinates : []).toEqual([...LINE]);
    expect(record).toMatchObject({
      version: 1,
      rideId: document.rideId,
      rideRevision: document.revision,
      distanceMeters: 27_500,
      durationSeconds: 58 * 60,
    });
    expect(storage.keys()).toEqual([PREPARED_ROUTE_STORAGE_KEY]);
  });

  it("states the route page's own estimate when the catalog carries no ride time", async () => {
    const geometryStore = createMemoryGeometryStore();
    const record = await prepareExploreRoute(
      entry({ estimatedTimeMinutes: undefined }),
      createExploreDerivative(entry(), NOW),
      geometryStore,
      { now: () => NOW, storage: memoryStorage() },
    );
    // 27.5 km at the 28 mph the route page states is 37 min, which the page
    // rounds to the nearest quarter hour; the planner gets the same 30 min.
    expect(record?.durationSeconds).toBe(30 * 60);
  });

  it("writes nothing for a route it cannot ride as it is", async () => {
    const geometryStore = createMemoryGeometryStore();
    const storage = memoryStorage();
    const imported = entry({ source: "import" });
    await expect(prepareExploreRoute(imported, createExploreDerivative(imported, NOW), geometryStore, { now: () => NOW, storage }))
      .resolves.toBeNull();
    const noDistance = entry({ distanceKm: null });
    await expect(prepareExploreRoute(noDistance, createExploreDerivative(noDistance, NOW), geometryStore, { now: () => NOW, storage }))
      .resolves.toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  it("is read exactly once, and never after it has gone stale", async () => {
    const { storage, document } = await prepared();
    const read = takePreparedRoute({ now: () => NOW, storage });
    expect(read?.rideId).toBe(document.rideId);
    // Spent: a later page view cannot reopen a route the rider did not ask for.
    expect(takePreparedRoute({ now: () => NOW, storage })).toBeNull();
  });

  it("ignores a record older than its window, and one that is not a record at all", async () => {
    const { storage } = await prepared();
    const later = new Date(Date.parse(NOW) + PREPARED_ROUTE_TTL_MS + 1).toISOString();
    expect(takePreparedRoute({ now: () => later, storage })).toBeNull();

    const garbage = memoryStorage();
    garbage.setItem(PREPARED_ROUTE_STORAGE_KEY, "{\"version\":1,");
    expect(takePreparedRoute({ now: () => NOW, storage: garbage })).toBeNull();
    expect(garbage.keys()).toEqual([]);
  });

  it("reads the handoff once per page load even if a render runs twice", () => {
    window.sessionStorage.setItem(PREPARED_ROUTE_STORAGE_KEY, JSON.stringify({
      version: 1,
      rideId: "ride-1",
      rideRevision: 1,
      geometryRef: "geometry-1",
      distanceMeters: 1000,
      durationSeconds: 600,
      preparedAt: new Date().toISOString(),
    }));
    const first = takePreparedRouteOnce();
    const second = takePreparedRouteOnce();
    expect(first?.geometryRef).toBe("geometry-1");
    expect(second).toBe(first);
    // The ride session holds this line rather than a library row, so storage is
    // told to keep it instead of reclaiming it as an orphan.
    expect(preparedRouteGeometryRefs()).toEqual(["geometry-1"]);
    window.sessionStorage.clear();
    window.localStorage.removeItem(KEPT_ROUTE_STORAGE_KEY);
  });

  it("answers with the prepared route, and claims no score or evidence for it", async () => {
    const { prepared: record } = await prepared();
    const answer = preparedRouteAnswer(record);
    const candidate = answer.candidates[0]!;

    expect(answer.rideRevision).toBe(record.rideRevision);
    expect(answer.selectedRouteId).toBe(candidate.id);
    expect(candidate.geometryRef).toBe(record.geometryRef);
    // Unknown stays unknown: nothing measured this route here.
    expect(candidate.evidence).toEqual({});
    expect(candidate.score.policyVersion).toBe("unscored-stub");
    expect(Object.values(candidate.score.components).every((component) => component.input === null)).toBe(true);
    expect(candidate.warnings).toEqual([]);
  });

  it("names the prepared route so a ride session will bind it", async () => {
    const { prepared: record } = await prepared();
    const answer = preparedRouteAnswer(record);

    // Live bug 2026-10-26: Start ride refused "route.routeId must be a route_ identifier".
    expect(validateSessionRouteBinding({ planningGeneration: answer.planningGeneration, routeId: answer.selectedRouteId })).toEqual([]);
  });

  it("shows the prepared route until a real attempt owns the session", async () => {
    const { prepared: record } = await prepared();
    const inner = idleService();
    const service = withPreparedRoute(inner.service, record);

    expect(service.snapshot().committedBundle?.candidates).toHaveLength(1);
    expect(service.snapshot().phase).toBe("ready");

    // A selection is still the controller's business, so it is forwarded.
    service.selectRoute(preparedRouteAnswer(record).selectedRouteId);
    expect(inner.selectRoute).toHaveBeenCalledOnce();

    // The first real attempt takes over completely.
    await service.begin({ rideId: record.rideId, rideRevision: 2, intent: createExploreDerivative(entry(), NOW).intent });
    expect(inner.begin).toHaveBeenCalledOnce();
    expect(service.snapshot().committedBundle).toBeNull();
    expectedEmpty(service.snapshot());
  });

  // Live bug 2026-10-27 (mobile UX handoff): Loyalsock State Forest Loop opened
  // at the catalog's 96 mi / 3 h 30, and a reload re-planned the unchanged ride
  // through its checkpoints into 92 mi / 4 h 33 / 62 % dirt, replacing the
  // published line without a word.
  it("keeps the catalog line through a reload while the ride is unchanged", async () => {
    const { storage, document } = await prepared();
    const kept = memoryStorage();
    const first = takePreparedRoute({ now: () => NOW, storage, keep: kept });
    expect(first).not.toBeNull();
    // Reload: the session handoff is spent, the kept line is not.
    expect(takePreparedRoute({ now: () => NOW, storage, keep: kept })).toBeNull();
    const again = readKeptRoute(document.rideId, { storage: kept });
    expect(again).toEqual(first);
    // Only for the ride it was prepared for.
    expect(readKeptRoute("ride-other", { storage: kept })).toBeNull();
    expect(readKeptRoute(null, { storage: kept })).toBeNull();

    // The restored ride asks to plan itself at the same revision: no replan.
    const inner = idleService();
    const diverged = vi.fn();
    const service = withPreparedRoute(inner.service, again, { onDiverged: diverged });
    await service.begin({ rideId: document.rideId, rideRevision: again!.rideRevision, intent: document.intent });
    expect(inner.begin).not.toHaveBeenCalled();
    expect(diverged).not.toHaveBeenCalled();
    expect(service.snapshot().committedBundle?.candidates[0]?.distanceMeters).toBe(27_500);
  });

  it("tells the storage sweep to spare the kept line, so a reload still has it", () => {
    window.localStorage.setItem(KEPT_ROUTE_STORAGE_KEY, JSON.stringify({
      version: 1, rideId: "ride-kept", rideRevision: 0, geometryRef: "geometry-kept",
      distanceMeters: 154_478, durationSeconds: 12_600, preparedAt: NOW,
    }));
    expect(preparedRouteGeometryRefs()).toContain("geometry-kept");
    window.localStorage.removeItem(KEPT_ROUTE_STORAGE_KEY);
  });

  it("drops the kept line once the ride is edited, and plans the edit", async () => {
    const { storage, document } = await prepared();
    const kept = memoryStorage();
    const record = takePreparedRoute({ now: () => NOW, storage, keep: kept })!;
    const inner = idleService();
    const service = withPreparedRoute(inner.service, record, { onDiverged: () => forgetKeptRoute({ storage: kept }) });
    await service.begin({ rideId: document.rideId, rideRevision: record.rideRevision + 1, intent: document.intent });
    expect(inner.begin).toHaveBeenCalledOnce();
    expect(kept.getItem(KEPT_ROUTE_STORAGE_KEY)).toBeNull();
    expect(readKeptRoute(document.rideId, { storage: kept })).toBeNull();
  });

  it("keeps answering plainly when no route was prepared", () => {
    const inner = idleService();
    expect(withPreparedRoute(inner.service, null)).toBe(inner.service);
  });

  it("feeds the planner container the prepared answer and its line in the same tick", async () => {
    const { prepared: record } = await prepared();
    const inner = idleService({ kind: "line", coordinates: LINE });
    const store = createPlanningSessionStore({ service: withPreparedRoute(inner.service, record) });

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = store.getState();
    expect(state.snapshot.committedBundle?.rideRevision).toBe(record.rideRevision);
    const candidate = state.snapshot.committedBundle?.candidates[0];
    expect(candidate).toBeDefined();
    const line = state.geometry[candidate!.geometryRef];
    expect(line?.kind).toBe("line");
    expect(line?.kind === "line" ? line.coordinates : []).toEqual([...LINE]);
  });
});

function expectedEmpty(snapshot: PlanningSessionSnapshot): void {
  expect(snapshot.lastGoodBundle).toBeNull();
  expect(snapshot.phase).toBe("idle");
}

describe("Explore ride-this session", () => {
  it("says the ride is ready, because an answer is on screen", async () => {
    const { prepared: record } = await prepared();
    const session = preparedRouteSession(record);
    expect(session.phase).toBe("ready");
    expect(session.settledAt).toBe(NOW);
    expect(session.diagnostics).toEqual([]);
  });
});
