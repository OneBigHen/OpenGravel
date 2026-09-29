/**
 * Selecting, committing and editing a road span through the workspace's real
 * seams (04-PLANNER-AND-WORKSPACE-UX §17, §20, §31;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §4, §20; 03-DOMAIN-MODEL §12, §27).
 *
 * The claims that need the workspace rather than a unit:
 *
 * - **One gesture, one command, one undo unit.** Dragging a span is presentation
 *   until an action-bar button commits it, and the commit is exactly one
 *   `roadSpan.create` — observable only where the pointer stream, the UI store and
 *   the document store meet.
 * - **The geometry store is written before the command.** The handle the document
 *   keeps must resolve in the store the workspace wrote to.
 * - **The drafted span is drawn as a proposal, not as an authored object**, and the
 *   committed span is what the map then draws.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { MapIntent } from "@/application/map/types";
import { emptyRouteRoles, type PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { PlanningSessionState, PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { GeometryPayload } from "@/domain/geometry/types";
import { asGeometryRef, newCommandId, newRideId, newRoadSpanId, type GeometryRef, type RoadSpanId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import { asRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";
import type { RouteCandidate, RouteBundle, RouteScore, RouteScoreComponents } from "@/domain/route/types";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore, placeFinishCommand, placeStartCommand } from "@/ui/stores/ride-document-store";

import { createStubMapHostFactory, type StubMapHost, type StubMapHostFactory } from "../support/stub-map-host";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const MAP_SIZE = 1000;

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

/** The route the session returns: a straight line with a vertex every 100 m. */
const ROUTE_LINE: readonly Coordinate[] = [0, 100, 200, 300, 400].map((east) =>
  metres(east, 0),
);

const ZERO_COMPONENT: RouteScoreComponents["curvature"] = {
  input: null,
  weight: 0,
  contribution: 0,
  explanationKey: "unscored",
  evidenceStatus: "unknown",
};

function unscoredScore(): RouteScore {
  return {
    policyVersion: "VNEXT_STUB_0",
    total: 0,
    components: {
      curvature: ZERO_COMPONENT,
      backroad: ZERO_COMPONENT,
      surfaceFit: ZERO_COMPONENT,
      elevation: ZERO_COMPONENT,
      traffic: ZERO_COMPONENT,
      junctionFriction: ZERO_COMPONENT,
      novelty: ZERO_COMPONENT,
      closureRisk: ZERO_COMPONENT,
      timeCost: ZERO_COMPONENT,
      confidence: ZERO_COMPONENT,
    },
  };
}

interface FakeSession {
  readonly store: PlanningSessionStore;
  readonly routeId: RouteCandidateId;
}

/**
 * A session container exposing one committed bundle, without a network.
 *
 * The planning path itself is covered elsewhere (`planning-session-store.test.ts`);
 * this fixture exists so the span workflow is exercised against a real committed
 * route rather than a mocked projection.
 */
function sessionWith(
  committed: boolean,
  revision = 0,
  instructions?: RouteCandidate["instructions"],
): FakeSession {
  const geometryRef = asGeometryRef("geo_route_a");
  const routeId = asRouteCandidateId("route_a");
  const candidate: RouteCandidate = {
    id: routeId,
    provider: { providerId: "fixture", profile: "motorcycle_fastest" },
    geometryRef,
    distanceMeters: 400,
    durationSeconds: 60,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: unscoredScore(),
    warnings: [],
    fingerprint: "fp_a",
    ...(instructions === undefined ? {} : { instructions }),
  };
  const bundle: RouteBundle | null = committed
    ? {
        rideId: newRideId(),
        rideRevision: revision,
        planningGeneration: 0,
        policyVersion: "VNEXT_STUB_0",
        graphVersion: "unknown",
        evidenceVersion: "unknown",
        candidates: [candidate],
        selectedRouteId: routeId,
        selectionSource: "automatic",
        roles: emptyRouteRoles(),
        createdAt: FIXED,
      }
    : null;
  const rideId = newRideId();
  const snapshot: PlanningSessionSnapshot = {
    identity: { rideId, rideRevision: revision, planningGeneration: 0 },
    phase: committed ? "ready" : "idle",
    lastGoodBundle: bundle,
    committedBundle: bundle,
    selectionSource: "automatic",
    selectedRouteId: committed ? routeId : null,
    error: null,
    diagnostics: [],
    startedAt: FIXED,
    settledAt: committed ? FIXED : null,
  };
  const state: PlanningSessionState = {
    snapshot,
    geometry: committed
      ? { [geometryRef]: { kind: "line", coordinates: [...ROUTE_LINE] } }
      : {},
    begin: async (): Promise<void> => undefined,
    cancel: (): void => undefined,
    selectRoute: (): void => undefined,
  };
  return {
    store: {
      getState: (): PlanningSessionState => state,
      getInitialState: (): PlanningSessionState => state,
      subscribe: (): (() => void) => (): void => undefined,
    },
    routeId,
  };
}

function mockMapViewport(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      void this;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: MAP_SIZE,
        bottom: MAP_SIZE,
        width: MAP_SIZE,
        height: MAP_SIZE,
        toJSON: (): Record<string, never> => ({}),
      } as DOMRect;
    },
  );
}

interface RenderedWorkspace {
  readonly rideDocumentStore: ReturnType<typeof createRideDocumentStore>;
  readonly plannerUiStore: ReturnType<typeof createPlannerUiStore>;
  readonly geometryStore: GeometryStore;
  readonly mapFactory: StubMapHostFactory;
  readonly session: FakeSession;
  readonly host: () => StubMapHost;
  readonly emit: (intent: MapIntent) => void;
}

async function renderWorkspace(
  committed = true,
  withSpan = false,
  instructions?: RouteCandidate["instructions"],
): Promise<RenderedWorkspace> {
  mockMapViewport();
  const geometryStore = createMemoryGeometryStore();
  const rideDocumentStore = createRideDocumentStore({ now });
  // The route on screen answers a whole ride: one with no start or finish would
  // not show its answer at all (PP-01).
  const seed = rideDocumentStore.getState();
  seed.dispatch(placeStartCommand(seed.document, ROUTE_LINE[0]!));
  const seeded = rideDocumentStore.getState();
  seeded.dispatch(placeFinishCommand(seeded.document, ROUTE_LINE[ROUTE_LINE.length - 1]!));
  if (withSpan) {
    // A persisted span with no resolvable route: the state in which the
    // inspector exists but has nothing to measure against.
    const document = rideDocumentStore.getState().document;
    rideDocumentStore.getState().dispatch({
      commandId: newCommandId(),
      rideId: document.rideId,
      baseRevision: document.revision,
      source: "map",
      label: "Kept this road",
      type: "roadSpan.create",
      span: {
        id: newRoadSpanId(),
        mode: "must",
        direction: "forward",
        geometryRef: asGeometryRef("geo_span_orphan"),
        anchorRefs: [metres(0, 0), metres(400, 0)],
      },
    });
  }
  const session = sessionWith(committed, rideDocumentStore.getState().document.revision, instructions);
  const plannerUiStore = createPlannerUiStore();
  const mapFactory = createStubMapHostFactory();

  render(
    <PlannerWorkspace
      rideDocumentStore={rideDocumentStore}
      planningSessionStore={session.store}
      plannerUiStore={plannerUiStore}
      geometryStore={geometryStore}
      mapHostFactory={mapFactory.factory}
    />,
  );
  // The shaping tools live behind the "Refine route" disclosure.
  fireEvent.click(screen.getByTestId("refine-toggle"));
  await Promise.resolve();
  await Promise.resolve();
  await waitFor(() => expect(mapFactory.hosts).toHaveLength(1));

  const host = (): StubMapHost => {
    const first = mapFactory.hosts[0];
    if (first === undefined) throw new Error("the workspace has no map host");
    return first;
  };

  return {
    rideDocumentStore,
    plannerUiStore,
    geometryStore,
    mapFactory,
    session,
    host,
    emit: (intent: MapIntent): void => {
      // The map's emit is a React state transition: without `act` the re-render
      // (and therefore the scene the host is handed) has not happened yet, and an
      // assertion would read the previous frame.
      act(() => {
        host().emit(intent);
      });
    },
  };
}

function roadSpans(workspace: RenderedWorkspace) {
  return workspace.rideDocumentStore.getState().document.intent.roadSpans;
}

function revisionOf(workspace: RenderedWorkspace): number {
  return workspace.rideDocumentStore.getState().document.revision;
}

function historyLength(workspace: RenderedWorkspace): number {
  return workspace.rideDocumentStore.getState().document.history.entries.length;
}

/** Arms the tool, drags from one vertex to another, and returns when settled. */
function dragSpan(
  workspace: RenderedWorkspace,
  from: Coordinate,
  to: Coordinate,
): void {
  fireEvent.click(screen.getByTestId("select-road-span"));
  workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: from, ref: null });
  workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: to });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("selecting a span", () => {
  it("arms the pointer tool and previews without authoring anything", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("select-road-span"));

    expect(workspace.plannerUiStore.getState().activeTool).toBe("road-span-select");

    const before = revisionOf(workspace);
    workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: ROUTE_LINE[1]!, ref: null });
    workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: ROUTE_LINE[3]! });

    // The span is public (it is what the rider is dragging) and it is *nothing*
    // in the ride: no revision, no history entry, no span.
    const preview = workspace.host().lastScene()?.roadSpanPreview;
    expect(preview?.geometry).toEqual([ROUTE_LINE[1], ROUTE_LINE[2], ROUTE_LINE[3]]);
    expect(preview?.start).toEqual(ROUTE_LINE[1]);
    expect(preview?.end).toEqual(ROUTE_LINE[3]);
    expect(preview?.direction).toBe("forward");
    expect(roadSpans(workspace)).toEqual([]);
    expect(revisionOf(workspace)).toBe(before);
  });

  it("tracks the draft's endpoints as the pointer moves", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[0]!, ROUTE_LINE[2]!);
    expect(workspace.plannerUiStore.getState().roadSpanDraft).toEqual({
      routeId: workspace.session.routeId,
      startIndex: 0,
      endIndex: 2,
    });
    workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: ROUTE_LINE[4]! });
    expect(workspace.plannerUiStore.getState().roadSpanDraft).toEqual({
      routeId: workspace.session.routeId,
      startIndex: 0,
      endIndex: 4,
    });
  });

  it("Escape cancels the draft and disarms the tool", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[1]!, ROUTE_LINE[3]!);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(workspace.plannerUiStore.getState().roadSpanDraft).toBeNull(),
    );
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");
    expect(workspace.host().lastScene()?.roadSpanPreview).toBeNull();
  });
});

describe("committing a span", () => {
  it("authors exactly one command, one undo unit, with a resolvable line", async () => {
    const workspace = await renderWorkspace();
    const revisions = revisionOf(workspace);
    const entries = historyLength(workspace);
    dragSpan(workspace, ROUTE_LINE[1]!, ROUTE_LINE[3]!);
    fireEvent.click(screen.getByTestId("commit-keep"));

    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    expect(revisionOf(workspace) - revisions).toBe(1);
    expect(historyLength(workspace) - entries).toBe(1);
    const entry = workspace.rideDocumentStore.getState().document.history.entries.at(-1);
    expect(entry?.label).toBe("Kept this road");

    const span = roadSpans(workspace)[0];
    expect(span?.mode).toBe("must");
    expect(span?.direction).toBe("forward");
    expect(span?.anchorRefs).toEqual([ROUTE_LINE[1], ROUTE_LINE[3]]);

    // The document's handle resolves in the store the workspace wrote to.
    const record = await workspace.geometryStore.get(span!.geometryRef);
    expect(record?.kind).toBe("road-span");
    expect(record?.payload).toEqual({
      kind: "line",
      coordinates: [ROUTE_LINE[1], ROUTE_LINE[2], ROUTE_LINE[3]],
    });

    // The tool is one shot, the preview is retired, and the new span is selected.
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");
    expect(workspace.plannerUiStore.getState().roadSpanDraft).toBeNull();
    expect(workspace.host().lastScene()?.roadSpanPreview).toBeNull();
    expect(workspace.plannerUiStore.getState().selectedObject).toEqual({
      kind: "road-span",
      roadSpanId: span!.id,
    });
    await waitFor(() => expect(workspace.host().lastScene()?.roadSpans).toHaveLength(1));
  });

  it("commits each of the three modes as its own labelled action", async () => {
    for (const action of [
      { testId: "commit-prefer", mode: "prefer", label: "Preferred this road" },
      { testId: "commit-avoid", mode: "avoid", label: "Avoided this road" },
    ] as const) {
      const workspace = await renderWorkspace();
      dragSpan(workspace, ROUTE_LINE[0]!, ROUTE_LINE[2]!);
      fireEvent.click(screen.getByTestId(action.testId));
      await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
      expect(roadSpans(workspace)[0]?.mode).toBe(action.mode);
      expect(
        workspace.rideDocumentStore.getState().document.history.entries.at(-1)?.label,
      ).toBe(action.label);
      cleanup();
    }
  });

  it("declares reverse only when the rider drags against the route's order", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[3]!, ROUTE_LINE[1]!);
    // The draft runs end→start, so its own line is reversed; the route walks the
    // anchors the other way, which is exactly what `reverse` declares.
    expect(workspace.host().lastScene()?.roadSpanPreview?.direction).toBe("reverse");
    fireEvent.click(screen.getByTestId("commit-prefer"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    expect(roadSpans(workspace)[0]?.direction).toBe("reverse");
    expect(roadSpans(workspace)[0]?.anchorRefs).toEqual([ROUTE_LINE[3], ROUTE_LINE[1]]);
  });

  it("authors the whole route from the keyboard path", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("select-whole-route"));
    fireEvent.click(screen.getByTestId("commit-keep"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    expect(roadSpans(workspace)[0]?.anchorRefs).toEqual([
      ROUTE_LINE[0],
      ROUTE_LINE[4],
    ]);
  });

  it("shows no span surface before a route exists", async () => {
    // The inspector appears once there is a segment to constrain (or a span
    // already authored): before that, an empty list would be an affordance
    // pointing at nothing — and it must not resize the pre-route composition.
    await renderWorkspace(false);
    expect(screen.queryByTestId("road-spans-panel")).toBeNull();
  });

  it("refuses the keyboard path when there is no route to select", async () => {
    const workspace = await renderWorkspace(false, true);
    fireEvent.click(screen.getByTestId("select-whole-route"));
    expect(screen.getByTestId("span-error")).toHaveTextContent(
      "Plan a route first",
    );
    expect(roadSpans(workspace)).toHaveLength(1);
  });
});

describe("editing a span", () => {
  it("flips Keep to Prefer and back, one command each", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[1]!, ROUTE_LINE[3]!);
    fireEvent.click(screen.getByTestId("commit-keep"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));

    const flips: number[] = [];
    flips.push(revisionOf(workspace));
    fireEvent.click(screen.getByTestId("flip-road-span-1"));
    await waitFor(() => expect(roadSpans(workspace)[0]?.mode).toBe("prefer"));
    flips.push(revisionOf(workspace));
    fireEvent.click(screen.getByTestId("flip-road-span-1"));
    await waitFor(() => expect(roadSpans(workspace)[0]?.mode).toBe("must"));
    flips.push(revisionOf(workspace));

    expect(flips[1]! - flips[0]!).toBe(1);
    expect(flips[2]! - flips[1]!).toBe(1);
  });

  it("removes a span, and undo brings it back", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[1]!, ROUTE_LINE[3]!);
    fireEvent.click(screen.getByTestId("commit-keep"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    const spanId: RoadSpanId = roadSpans(workspace)[0]!.id;

    fireEvent.click(screen.getByTestId("remove-road-span-1"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(0));

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    expect(roadSpans(workspace)[0]?.id).toBe(spanId);
  });

  it("shows the measured verdict for the committed span", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[1]!, ROUTE_LINE[3]!);
    fireEvent.click(screen.getByTestId("commit-keep"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));

    // The span came from the route that is on screen, so the route satisfies it —
    // and the row says so from the measurement, not from the request.
    await waitFor(() =>
      expect(screen.getByTestId("span-status-0")).toHaveTextContent("Satisfied"),
    );
    expect(screen.getByTestId("road-span-row-0")).toHaveAttribute("data-warning", "false");
  });
});

/** A geometry payload read back for a span, so a test can assert the bytes. */
async function spanPayload(
  store: GeometryStore,
  ref: GeometryRef,
): Promise<GeometryPayload> {
  const record = await store.get(ref);
  if (record === null) throw new Error(`no geometry for ${ref}`);
  return record.payload;
}

describe("the stored span", () => {
  it("keeps the reviewer's own anchors, and its line is the drafted one", async () => {
    const workspace = await renderWorkspace();
    dragSpan(workspace, ROUTE_LINE[2]!, ROUTE_LINE[4]!);
    fireEvent.click(screen.getByTestId("commit-avoid"));
    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    const span = roadSpans(workspace)[0]!;
    expect(span.anchorRefs).toEqual([ROUTE_LINE[2], ROUTE_LINE[4]]);
    expect(await spanPayload(workspace.geometryStore, span.geometryRef)).toEqual({
      kind: "line",
      coordinates: [ROUTE_LINE[2], ROUTE_LINE[3], ROUTE_LINE[4]],
    });
  });
});

describe("avoid this road from one tap (NV-14)", () => {
  const STEPS: RouteCandidate["instructions"] = [
    { text: "Head east on Main St", distanceMeters: 100, durationSeconds: 15, type: "depart", roadName: "Main St", geometryIndex: 0 },
    { text: "Continue onto Pine Rd", distanceMeters: 200, durationSeconds: 30, type: "continue", roadName: "Pine Rd", geometryIndex: 1 },
    { text: "Continue onto Mill Rd", distanceMeters: 100, durationSeconds: 15, type: "continue", roadName: "Mill Rd", geometryIndex: 3 },
  ];

  function tapRoute(workspace: RenderedWorkspace, at: Coordinate): void {
    workspace.emit({
      type: "object-click",
      ref: { kind: "route", routeId: workspace.session.routeId },
      coordinate: at,
    });
  }

  it("names the road under the tap and avoids all of it in one undo unit", async () => {
    const workspace = await renderWorkspace(true, false, STEPS);
    const entries = historyLength(workspace);
    tapRoute(workspace, metres(160, 0));

    expect(screen.getByTestId("road-tap-name").textContent).toBe("Pine Rd");
    fireEvent.click(screen.getByTestId("road-tap-avoid"));

    await waitFor(() => expect(roadSpans(workspace)).toHaveLength(1));
    expect(historyLength(workspace) - entries).toBe(1);
    const span = roadSpans(workspace)[0];
    expect(span?.mode).toBe("avoid");
    expect(span?.anchorRefs).toEqual([ROUTE_LINE[1], ROUTE_LINE[3]]);
    expect(screen.queryByTestId("road-tap")).toBeNull();
  });

  it("offers the stretch around the tap when the road has no name", async () => {
    const workspace = await renderWorkspace();
    tapRoute(workspace, ROUTE_LINE[2]!);
    expect(screen.getByTestId("road-tap-name").textContent).toBe("This stretch of road");
    expect(screen.getByTestId("road-tap-avoid").textContent).toBe("Avoid this stretch");
  });

  it("offers the road after the rider picks a ride from an overlapping tap", async () => {
    const workspace = await renderWorkspace(true, false, STEPS);
    const ref = { kind: "route" as const, routeId: workspace.session.routeId };
    workspace.emit({ type: "overlap-click", candidates: [ref, ref], coordinate: metres(160, 0) });
    expect(screen.queryByTestId("road-tap")).toBeNull();
    fireEvent.click(screen.getByTestId("overlap-choice-0"));
    expect(screen.getByTestId("road-tap-name").textContent).toBe("Pine Rd");
  });

  it("Not now and a tap elsewhere both put the offer away without authoring", async () => {
    const workspace = await renderWorkspace(true, false, STEPS);
    const before = revisionOf(workspace);
    tapRoute(workspace, metres(160, 0));
    fireEvent.click(screen.getByTestId("road-tap-dismiss"));
    expect(screen.queryByTestId("road-tap")).toBeNull();

    tapRoute(workspace, metres(160, 0));
    workspace.emit({ type: "map-click", coordinate: metres(160, 500) });
    expect(screen.queryByTestId("road-tap")).toBeNull();
    expect(revisionOf(workspace)).toBe(before);
  });
});
