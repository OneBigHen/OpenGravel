/**
 * The planner workspace end to end (02-ARCHITECTURE-CONTRACT §8, §17;
 * 04-PLANNER-AND-WORKSPACE-UX §2–§12, §21).
 *
 * This is the Wave-2 acceptance test: two map clicks author a start and a
 * destination through the domain reducer, the plan button becomes truthful, a
 * `/api/route-plan` answer becomes route cards, the recommended route is drawn
 * and marked, selecting another card moves the selection, and cancelling while
 * planning returns to the last committed state.
 *
 * Nothing here reaches a network: the fetch is a fake that speaks the real
 * contract, so failures point at the wiring rather than at a router.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClientPlanningService } from "@/application/planner/client-planning-service";
import type { RoutePlanIdentityWire } from "@/application/planner/ports/route-plan-contract";
import type { RouteScoreComponents } from "@/domain/route/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";

import {
  createStubMapHostFactory,
  type StubMapHostFactory,
} from "../support/stub-map-host";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;

const ORIGIN = { lon: -75.2, lat: 39.95 };
const MIDPOINT = { lon: -75.0, lat: 40.05 };
const DESTINATION = { lon: -74.8, lat: 40.2 };

function unscoredScore(): { policyVersion: string; total: number; components: RouteScoreComponents } {
  const component = (key: string): RouteScoreComponents["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `unscored.${key}`,
    evidenceStatus: "unknown",
  });
  return {
    policyVersion: "VNEXT_STUB_0",
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

function wireCandidate(id: string, durationSeconds: number, fingerprint: string) {
  return {
    id: asRouteCandidateId(id),
    provider: { providerId: "graphhopper", profile: "motorcycle_adventure" },
    geometry: [ORIGIN, MIDPOINT, DESTINATION],
    distanceMeters: 120_000,
    durationSeconds,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: unscoredScore(),
    warnings: [],
    fingerprint,
  };
}

function successBody(identity: RoutePlanIdentityWire) {
  const best = asRouteCandidateId("route_best");
  const fast = asRouteCandidateId("route_fast");
  return {
    identity,
    bundle: {
      policyVersion: "VNEXT_STUB_0",
      graphVersion: "unknown",
      evidenceVersion: "unknown",
      candidates: [wireCandidate(best, 6_480, "fp_best"), wireCandidate(fast, 5_760, "fp_fast")],
      roles: {
        "best-ride": best,
        fastest: fast,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      selectedRouteId: best,
    },
    diagnostics: { optionalProvidersUnavailable: [] },
  };
}

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

function jsonResponse(body: unknown): Response {
  const fake: FakeResponse = { ok: true, status: 200, json: async (): Promise<unknown> => body };
  return fake as unknown as Response;
}

const MAP_SIZE = 1000;

/** JSdom has no layout, so the dock's own rect is mocked as a real viewport. */
function mockMapViewport(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: MAP_SIZE,
    bottom: MAP_SIZE,
    width: MAP_SIZE,
    height: MAP_SIZE,
    toJSON: (): Record<string, never> => ({}),
  } as DOMRect);
}

/** The two coordinates the placement tests author (05 §4, OGV-D-213). */
const START_COORDINATE = { lon: -75.2, lat: 39.95 };

interface RenderedWorkspace {
  readonly rideDocumentStore: ReturnType<typeof createRideDocumentStore>;
  readonly plannerUiStore: ReturnType<typeof createPlannerUiStore>;
  readonly mapFactory: StubMapHostFactory;
  readonly posts: RoutePlanIdentityWire[];
}

/** React commits the map effect, then the async host factory resolves a task later. */
async function flushHostSubscription(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderWorkspace(fetcher: typeof fetch): Promise<RenderedWorkspace> {
  const posts: RoutePlanIdentityWire[] = [];
  const recording = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire };
    posts.push(body.identity);
    return fetcher(input, init);
  }) as typeof fetch;

  const rideDocumentStore = createRideDocumentStore({ now });
  const planningSessionStore = createPlanningSessionStore({
    service: createClientPlanningService({ fetcher: recording, now }),
  });
  const plannerUiStore = createPlannerUiStore();
  const mapFactory = createStubMapHostFactory();

  render(
    <PlannerWorkspace
      rideDocumentStore={rideDocumentStore}
      planningSessionStore={planningSessionStore}
      plannerUiStore={plannerUiStore}
      mapHostFactory={mapFactory.factory}
    />,
  );

  // `clickMap` is the tap helper the tests below use; it needs the host of the
  // workspace under test, and the host only subscribes to intents once the
  // factory promise resolves.
  mapFactoryRef.current = mapFactory;
  await flushHostSubscription();

  return { rideDocumentStore, plannerUiStore, mapFactory, posts };
}

/**
 * A tap on the map, delivered through the host seam.
 *
 * The real host unprojects the release pixel and hit-tests it; the stub emits the
 * geography the tap position means, using the same plain linear reading of the
 * baseline region's extent, so a call site still reads as "a tap over there".
 * Which point a tap *authors* is decided by the workspace, never by the host.
 */
function clickMap(x: number, y: number): void {
  const host = mapFactoryRef.current?.hosts[0];
  if (host === undefined) throw new Error("the workspace has no map host");
  // A host intent is an external event, so the store updates it triggers must be
  // flushed before the test reads the DOM — exactly like `fireEvent` did for the
  // SVG host this replaces.
  act(() => {
    host.emit({
      type: "map-click",
      coordinate: {
        lon: START_COORDINATE.lon + (x / MAP_SIZE) * 0.4,
        lat: START_COORDINATE.lat + (y / MAP_SIZE) * 0.25,
      },
    });
  });
}

/** The factory of the workspace rendered by the most recent `renderWorkspace`. */
const mapFactoryRef: { current: StubMapHostFactory | null } = { current: null };

/** Delivers any host intent to the workspace and flushes what it changes. */
function emitIntent(intent: Parameters<ReturnType<typeof createStubMapHostFactory>["hosts"][number]["emit"]>[0]): void {
  const host = mapFactoryRef.current?.hosts[0];
  if (host === undefined) throw new Error("the workspace has no map host");
  act(() => {
    host.emit(intent);
  });
}

/** A fetcher for the tests that author points but never plan. */
function unfetched(): typeof fetch {
  return (async (): Promise<Response> => {
    throw new Error("this test never plans a ride");
  }) as typeof fetch;
}

async function placeBothPoints(): Promise<void> {
  clickMap(100, 100);
  await waitFor(() => {
    expect(screen.getByTestId("start-value")).not.toHaveTextContent("No start yet");
  });
  clickMap(900, 900);
  await waitFor(() => {
    expect(screen.getByTestId("finish-value")).not.toHaveTextContent("No destination yet");
  });
}

beforeEach(() => {
  mockMapViewport();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlannerWorkspace — the Wave-2 slice", () => {
  it("plans from two map clicks and marks the recommended route", async () => {
    const { rideDocumentStore, posts, mapFactory } = await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        jsonResponse(
          successBody(
            (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire }).identity,
          ),
        )) as typeof fetch,
    );

    // First-open (Task 3.5, OGV-D-213): the map is directly usable and the
    // composer's disabled reason is the single instruction. The overlay hint is
    // absent because it would say the same thing a second time (OGV-D-214).
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Search for a start, or set it on the map.",
    );
    expect(screen.getByRole("button", { name: "Create ride" })).toBeDisabled();

    await placeBothPoints();

    const plan = screen.getByRole("button", { name: "Create ride" });
    expect(plan).toBeEnabled();
    expect(screen.queryByTestId("plan-disabled-reason")).not.toBeInTheDocument();

    fireEvent.click(plan);

    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });

    // The plan was requested for the document revision the rider just authored:
    // once for the first route alone, once for the full set.
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({
      rideId: rideDocumentStore.getState().document.rideId,
      rideRevision: 2,
      planningGeneration: 1,
    });

    const cards = within(screen.getByTestId("route-list")).getAllByRole("button");
    const pressed = cards.filter((card) => card.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent("Best Ride");
    // The other candidate keeps its own earned role instead of a generic label.
    expect(cards.some((card) => card.textContent?.includes("Fastest"))).toBe(true);
    expect(within(screen.getByTestId("route-list")).getByText("+12 min vs Fastest")).toBeInTheDocument();

    // The selected route is drawn with the selected treatment, and the
    // unselected one as a muted alternative — asserted on the scene the renderer
    // received, since the cartography lives in map layers now (05 §11).
    const drawn = mapFactory.hosts[0]?.lastScene();
    const routeStates = drawn?.routes.map((route) => route.state) ?? [];
    expect(routeStates.filter((state) => state === "selected")).toHaveLength(1);
    expect(routeStates.filter((state) => state === "alternative")).toHaveLength(1);
    expect(drawn?.points.map((point) => point.kind)).toEqual(["start", "finish"]);
    expect(screen.getByTestId("status-line")).toHaveTextContent("Ride ready.");
    expect(screen.queryByTestId("planner-error")).not.toBeInTheDocument();
  });

  it("moves the selection and the map highlight when another card is chosen", async () => {
    const { mapFactory } = await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        jsonResponse(
          successBody(
            (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire }).identity,
          ),
        )) as typeof fetch,
    );

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });

    const cards = within(screen.getByTestId("route-list")).getAllByRole("button");
    const alternative = cards.find((card) => card.getAttribute("aria-pressed") === "false");
    if (alternative === undefined) throw new Error("expected an alternative card");
    fireEvent.click(alternative);

    await waitFor(() => {
      const pressed = within(screen.getByTestId("route-list"))
        .getAllByRole("button")
        .filter((card) => card.getAttribute("aria-pressed") === "true");
      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toBe(alternative);
    });
    // A rider's own pick is never relabelled as the recommendation (OGV-D-183),
    // and the recommendation keeps its own label after the rider looks away.
    expect(alternative).not.toHaveTextContent("Best Ride");
    expect(screen.getByText("Best Ride")).toBeInTheDocument();
    // The drawn scene follows the selection: exactly one route is selected, and it
    // is the one the rider picked.
    const drawn = mapFactory.hosts[0]?.lastScene();
    expect(drawn?.routes.filter((route) => route.state === "selected")).toHaveLength(1);
    expect(drawn?.selectedRouteId).not.toBe(asRouteCandidateId("route_unused"));
  });

  it("un-dims the map once the first route is shown while the others are still loading", async () => {
    const pending: Array<(response: Response) => void> = [];
    const { posts, mapFactory } = await renderWorkspace(
      (async (): Promise<Response> =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        })) as typeof fetch,
    );

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId("map-host")).toHaveAttribute("data-dimmed", "true");

    const identity = posts[0];
    if (identity === undefined) throw new Error("expected a plan request");
    await act(async () => {
      pending[0]?.(jsonResponse(successBody(identity)));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("status-line")).toHaveTextContent("Finding other roads…");
    });
    expect(screen.getByTestId("map-host")).toHaveAttribute("data-dimmed", "false");
    expect(mapFactory.hosts[0]?.lastScene()?.routes.length).toBeGreaterThan(0);
  });

  it("cancels a running plan and returns to the last committed state", async () => {
    const hanging = (async (): Promise<Response> =>
      new Promise<Response>(() => {
        // Never answers, and ignores the abort signal on purpose.
      })) as typeof fetch;
    await renderWorkspace(hanging);

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));

    await waitFor(() => {
      expect(screen.getByTestId("status-line")).toHaveTextContent("Finding your ride…");
    });
    // 04 §9: the previous drawing is marked stale rather than blanked, and the
    // cancel control is the visible way out of the wait.
    expect(screen.getByTestId("map-host")).toHaveAttribute("data-dimmed", "true");
    const cancel = screen.getByTestId("cancel-planning");

    fireEvent.click(cancel);

    await waitFor(() => {
      expect(screen.getByTestId("status-line")).toHaveTextContent("Planning cancelled.");
    });
    expect(screen.getByTestId("map-host")).toHaveAttribute("data-dimmed", "false");
    expect(screen.queryByTestId("planner-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cancel-planning")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create ride" })).toBeEnabled();
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
  });

  it("places a start on the first idle tap and the destination on the next", async () => {
    const { plannerUiStore } = await renderWorkspace(unfetched());

    // First-open arms no tool: the empty map is directly usable, and the
    // composer reason is the single instruction (OGV-D-213/214).
    expect(plannerUiStore.getState().placementTool).toBe("idle");
    // 05 §4's pointer tool is the neutral one: nothing is armed to draw.
    expect(plannerUiStore.getState().activeTool).toBe("pan");
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("start-chip")).toHaveAttribute("data-armed", "false");

    clickMap(100, 100);
    expect(screen.getByTestId("start-value")).not.toHaveTextContent("No start yet");
    // The workspace is in finish placement now, and says so exactly once.
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Search for a destination, or choose it on the map.",
    );
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();

    clickMap(900, 900);
    expect(screen.getByTestId("finish-value")).not.toHaveTextContent(
      "No destination yet",
    );
    expect(screen.getByRole("button", { name: "Create ride" })).toBeEnabled();
    // Both points exist: an idle tap is a selection click again, and there is
    // nothing left to instruct.
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-disabled-reason")).not.toBeInTheDocument();
  });

  it("arms a placement tool from a chip and instructs only then", async () => {
    const { plannerUiStore } = await renderWorkspace(unfetched());

    clickMap(100, 100);
    clickMap(900, 900);
    fireEvent.click(screen.getByTestId("start-chip"));

    // The chip arms the tool (visibly, on the control) and the map states what
    // the next tap does. Nothing blocks planning, so nothing else instructs.
    expect(plannerUiStore.getState().placementTool).toBe("place-start");
    expect(screen.getByTestId("start-chip")).toHaveAttribute("data-armed", "true");
    const hint = screen.getByTestId("map-hint");
    expect(hint).toHaveTextContent("Tap the map to set your start.");
    expect(hint).toHaveRole("note");
    expect(hint.tagName).not.toBe("BUTTON");
    expect(screen.queryByTestId("plan-disabled-reason")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("finish-chip"));
    expect(plannerUiStore.getState().placementTool).toBe("place-finish");
    expect(screen.getByTestId("finish-chip")).toHaveAttribute("data-armed", "true");
    expect(screen.getByTestId("map-hint")).toHaveTextContent(
      "Tap the map to set your destination.",
    );
  });

  it("suppresses the overlay hint when the disabled reason already says it", async () => {
    await renderWorkspace(unfetched());

    // Arming the tool for the very point that blocks planning must not repeat
    // the composer's reason on the map (OGV-D-214, one instruction at a time).
    fireEvent.click(screen.getByTestId("start-chip"));

    expect(screen.getByTestId("start-chip")).toHaveAttribute("data-armed", "true");
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Search for a start, or set it on the map.",
    );
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
  });

  it("clears the selection on an unarmed click once both points exist", async () => {
    const { plannerUiStore } = await renderWorkspace(unfetched());

    clickMap(100, 100);
    clickMap(900, 900);
    const authoredStart = screen.getByTestId("start-value").textContent;

    plannerUiStore
      .getState()
      .selectObject({ kind: "route", routeId: asRouteCandidateId("route_other") });
    expect(plannerUiStore.getState().selectedObject).not.toBeNull();

    // 05 §4: with nothing left to place, a click on the map is a selection
    // click — it clears the selection and authors nothing.
    clickMap(500, 500);

    expect(plannerUiStore.getState().selectedObject).toBeNull();
    expect(screen.getByTestId("start-value")).toHaveTextContent(authoredStart ?? "");
    expect(screen.getByTestId("finish-value")).not.toHaveTextContent(
      "No destination yet",
    );
  });

  it("keeps the status line inside the compact sheet, above the composer", async () => {
    await renderWorkspace(unfetched());

    const dock = screen.getByTestId("planner-dock");
    const sheet = screen.getByTestId("planner-sheet");
    const status = screen.getByTestId("status-line");
    expect(sheet).toHaveClass("og-planner__sheet");
    expect(dock).toContainElement(sheet);
    // The status is part of the sheet, not a chip floating over the map (owner
    // review 2026-09-17): the map surface keeps its single job. Document order is
    // the order the sheet stacks them in.
    expect(sheet).toContainElement(status);
    // Status first, then the composer rows, inside the one sheet surface.
    expect(sheet.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      status.compareDocumentPosition(screen.getByTestId("compose-create")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("raises the sheet to its expanded detent when the ride choices appear", async () => {
    const { plannerUiStore } = await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        jsonResponse(
          successBody(
            (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire }).identity,
          ),
        )) as typeof fetch,
    );

    // 04 §2: the default is the peek detent — the composer, and nothing else.
    expect(plannerUiStore.getState().sheetDetent).toBe("peek");
    expect(screen.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "peek");

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });

    // A route result settles the sheet at the ride detent (UX rework 2, #8):
    // the chosen route and Start ride, with the map keeping the screen.
    expect(plannerUiStore.getState().sheetDetent).toBe("ride");
    expect(screen.getByTestId("planner-sheet")).toHaveAttribute("data-detent", "ride");
    expect(screen.getByTestId("sheet-handle")).toHaveAttribute("aria-expanded", "false");

    // The handle opens every choice, and closing it returns to the ride.
    fireEvent.click(screen.getByTestId("sheet-handle"));
    expect(plannerUiStore.getState().sheetDetent).toBe("expanded");
    expect(screen.getByTestId("sheet-handle")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByTestId("sheet-handle"));
    expect(plannerUiStore.getState().sheetDetent).toBe("ride");
    // The visible label is the surface's name; the action the next press takes is
    // carried by `aria-expanded` and the screen-reader prefix, and the badge
    // counts the choices behind it (owner review 2026-09-17).
    expect(screen.getByTestId("sheet-handle-label")).toHaveTextContent("Compare rides");
    expect(screen.getByTestId("sheet-handle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("sheet-handle")).toHaveAccessibleName(/show ride choices/i);
    expect(screen.getByTestId("ride-choices-count")).toHaveTextContent("2");
  });

  it("suspends the camera fit once the rider takes control and restores it on demand", async () => {
    const { mapFactory } = await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        jsonResponse(
          successBody(
            (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire }).identity,
          ),
        )) as typeof fetch,
    );

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });

    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");
    const fitsAfterCommit = host.fits.length;
    expect(fitsAfterCommit).toBeGreaterThan(1);

    // 05 §8: a rider pan/zoom suspends automatic fit — a later plan must not move
    // the camera out from under them.
    emitIntent({ type: "camera-changed" });
    expect(screen.getByTestId("show-whole-ride")).toBeInTheDocument();
    host.reset();

    fireEvent.click(screen.getByTestId("finish-chip"));
    clickMap(500, 500);
    fireEvent.click(screen.getByRole("button", { name: "Update ride" }));
    await waitFor(() => {
      expect(screen.getByTestId("status-line")).toHaveTextContent("Updating ride…");
    });
    expect(host.fits).toHaveLength(0);

    // The explicit hand-back clears the suspension and frames the ride again.
    fireEvent.click(screen.getByTestId("show-whole-ride"));
    expect(host.fits.length).toBeGreaterThan(0);
  });

  it("holds the camera still while the pen is armed, even when a snapped preview arrives (OGV-D-285)", async () => {
    let calls = 0;
    const { mapFactory, plannerUiStore, posts } = await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls += 1;
        const body = successBody(
          (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire }).identity,
        );
        // Every answer draws a different line, so a camera keyed on the drawn
        // routes would re-frame for each one.
        const shift = calls * 0.01;
        const candidates = body.bundle.candidates.map((candidate) => ({
          ...candidate,
          geometry: candidate.geometry.map((point) => ({ lon: point.lon + shift, lat: point.lat })),
        }));
        return jsonResponse({ ...body, bundle: { ...body.bundle, candidates } });
      }) as typeof fetch,
    );

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");

    act(() => plannerUiStore.getState().setSketchTool(true));
    host.reset();
    const at = (x: number, y: number) => ({
      lon: START_COORDINATE.lon + (x / MAP_SIZE) * 0.4,
      lat: START_COORDINATE.lat + (y / MAP_SIZE) * 0.25,
    });
    emitIntent({ type: "pointer-down", pointerId: 1, coordinate: at(100, 100), ref: null });
    emitIntent({ type: "pointer-move", pointerId: 1, coordinate: at(400, 300) });
    emitIntent({ type: "pointer-up", pointerId: 1, coordinate: at(700, 500) });

    // The rest after the lift plans the draft; its answer draws a new line.
    await waitFor(() => expect(posts).toHaveLength(2), { timeout: 3_000 });
    await waitFor(() => expect(plannerUiStore.getState().sketchPreviewGenerations).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(host.fits).toHaveLength(0);
  });

  it("records overlapping route candidates and lets the rider resolve them", async () => {
    const { plannerUiStore } = await renderWorkspace(unfetched());
    // Unarmed: both points are authored, so the tap is a *selection* decision and
    // the overlap is the rider's to make (05 §6).
    await placeBothPoints();

    const candidates = [
      { kind: "route" as const, routeId: asRouteCandidateId("route_a") },
      { kind: "route" as const, routeId: asRouteCandidateId("route_b") },
    ];
    emitIntent({
      type: "overlap-click",
      candidates,
      coordinate: START_COORDINATE,
    });
    // 05 §6: pixel order is not a selection policy, so the tap opens a chooser
    // and leaves the selection alone.
    expect(plannerUiStore.getState().overlapCandidates).toEqual(candidates);
    expect(plannerUiStore.getState().selectedObject).toBeNull();
    const chooser = screen.getByTestId("overlap-chooser");
    expect(chooser).toBeInTheDocument();
    expect(within(chooser).getAllByRole("button")).toHaveLength(3);

    // Resolving the chooser is one transition: the pick becomes the selection and
    // the candidate list closes with it.
    fireEvent.click(screen.getByTestId("overlap-choice-1"));
    expect(plannerUiStore.getState().selectedObject).toEqual(candidates[1]);
    expect(plannerUiStore.getState().overlapCandidates).toEqual([]);
    expect(screen.queryByTestId("overlap-chooser")).not.toBeInTheDocument();
  });

  it("closes the overlap chooser without inventing a selection", async () => {
    const { plannerUiStore } = await renderWorkspace(unfetched());
    await placeBothPoints();
    emitIntent({
      type: "overlap-click",
      candidates: [
        { kind: "route", routeId: asRouteCandidateId("route_a") },
        { kind: "route", routeId: asRouteCandidateId("route_b") },
      ],
      coordinate: START_COORDINATE,
    });

    fireEvent.click(screen.getByTestId("overlap-dismiss"));

    expect(screen.queryByTestId("overlap-chooser")).not.toBeInTheDocument();
    expect(plannerUiStore.getState().overlapCandidates).toEqual([]);
    expect(plannerUiStore.getState().selectedObject).toBeNull();
  });

  it("lets an armed placement own a tap that lands on overlapping routes", async () => {
    const { plannerUiStore, rideDocumentStore } = await renderWorkspace(unfetched());
    clickMap(100, 100);
    await waitFor(() => {
      expect(screen.getByTestId("start-value")).not.toHaveTextContent("No start yet");
    });
    // The composer asks the rider for the destination; the tap below lands on a
    // corridor two routes share.
    fireEvent.click(screen.getByTestId("finish-chip"));
    emitIntent({
      type: "overlap-click",
      candidates: [
        { kind: "route", routeId: asRouteCandidateId("route_a") },
        { kind: "route", routeId: asRouteCandidateId("route_b") },
      ],
      coordinate: { lon: START_COORDINATE.lon + 0.05, lat: START_COORDINATE.lat + 0.05 },
    });

    // 05 §4 + §6: placement owns the tap. Storing candidates instead would swallow
    // the destination the rider just aimed, and leave them with a chooser where
    // they meant to place a point.
    expect(rideDocumentStore.getState().document.intent.finish).not.toBeNull();
    expect(plannerUiStore.getState().overlapCandidates).toEqual([]);
    expect(plannerUiStore.getState().placementTool).toBe("idle");
    expect(screen.queryByTestId("overlap-chooser")).not.toBeInTheDocument();
  });

  it("clears an armed placement on Escape, and the next tap does not place", async () => {
    const { plannerUiStore, rideDocumentStore, mapFactory } = await renderWorkspace(unfetched());
    await placeBothPoints();
    const authoredStart = rideDocumentStore.getState().document.intent.start;

    // An edit tool armed on a complete ride: this is the state where Escape used
    // to leave the map still owning the next tap (4.0 review finding 5).
    fireEvent.click(screen.getByTestId("start-chip"));
    expect(plannerUiStore.getState().placementTool).toBe("place-start");
    expect(screen.getByTestId("map-hint")).toHaveTextContent("Tap the map to set your start.");

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // The UI state machine is the authority: placement cleared, tool neutral, no
    // instruction left on the surface.
    expect(plannerUiStore.getState().placementTool).toBe("idle");
    expect(plannerUiStore.getState().activeTool).toBe("pan");
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
    // And the interaction machine heard it too, so an in-flight gesture is gone.
    expect(mapFactory.hosts[0]?.events).toContainEqual({ type: "escape" });

    // The next tap is a selection tap again: the armed start placement is gone, so
    // nothing was re-placed.
    clickMap(500, 500);
    expect(rideDocumentStore.getState().document.intent.start).toEqual(authoredStart);
    expect(plannerUiStore.getState().selectedObject).toBeNull();
  });

  it("passes the store's pointer tool to the map, as the one authoritative value", async () => {
    const { plannerUiStore, mapFactory } = await renderWorkspace(unfetched());
    const host = mapFactory.hosts[0];
    expect(host?.events).toContainEqual({ type: "tool-change", tool: "pan" });

    // 05 §4: the pointer tool is presentation state, and whatever it holds is what
    // the renderer arms its gestures with — not a component-local default.
    act(() => {
      plannerUiStore.getState().setActiveTool("sketch");
    });

    expect(host?.events).toContainEqual({ type: "tool-change", tool: "sketch" });
  });

  it("reports a renderer failure as a bounded notice in the sheet", async () => {
    const { mapFactory } = await renderWorkspace(unfetched());
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");

    // The host reports exactly what the MapLibre adapter reports when a source
    // cannot be added: the machine-readable attribute on the surface *and* the
    // bounded notice in the sheet (05 §22, 4.0 review finding 1).
    act(() => {
      host.failWith({ kind: "source", detail: "ogv-routes" });
    });

    expect(screen.getByTestId("planner-map")).toHaveAttribute("data-map-error", "source");
    const notice = screen.getByTestId("map-error-notice");
    expect(screen.getByTestId("planner-sheet")).toContainElement(notice);
    expect(notice).toHaveTextContent(/some map layers couldn't be drawn/i);
    // Quiet and honest: what is missing, and the reassurance the ride is intact.
    expect(notice).toHaveTextContent(/your ride is safe/i);
    expect(notice).toHaveAttribute("data-map-error-kind", "source");
    // The planner keeps working: the composer is still there and still usable.
    expect(screen.getByTestId("compose-create")).toBeInTheDocument();
  });

  it("says the same thing for a renderer that never started", async () => {
    const { mapFactory } = await renderWorkspace(unfetched());
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");

    act(() => {
      host.failWith({ kind: "webgl-unavailable", detail: null });
    });

    // 05 §22: the map may be undrawable, and the planner must still say so calmly
    // rather than failing the whole screen.
    expect(screen.getByTestId("map-error-notice")).toHaveTextContent(/can't draw the map/i);
    expect(screen.getByTestId("map-error-notice")).toHaveTextContent(/your ride is safe/i);
    expect(screen.getByTestId("compose-create")).toBeInTheDocument();
  });

  it("clears the whole route in one step and offers its undo (OW-01)", async () => {
    const { rideDocumentStore, plannerUiStore } = await renderWorkspace(unfetched());
    expect(screen.queryByTestId("clear-ride")).not.toBeInTheDocument();

    await placeBothPoints();
    act(() => plannerUiStore.getState().setSheetDetent("ride"));
    fireEvent.click(screen.getByRole("button", { name: "Clear route" }));

    const intent = rideDocumentStore.getState().document.intent;
    expect(intent.start).toBeNull();
    expect(intent.finish).toBeNull();
    expect(plannerUiStore.getState().sheetDetent).toBe("peek");
    expect(screen.queryByTestId("clear-ride")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("undo-clear"));
    expect(rideDocumentStore.getState().document.intent.start).not.toBeNull();
    expect(rideDocumentStore.getState().document.intent.finish).not.toBeNull();
    expect(screen.queryByTestId("undo-clear")).not.toBeInTheDocument();
    expect(screen.getByTestId("clear-ride")).toBeInTheDocument();
  });

  it("refuses to plan without a destination and says why", async () => {
    await renderWorkspace(
      (async (): Promise<Response> => jsonResponse(successBody({
        rideId: "ride_unused",
        rideRevision: 1,
        planningGeneration: 1,
      }))) as typeof fetch,
    );

    clickMap(100, 100);
    await waitFor(() => {
      expect(screen.getByTestId("start-value")).not.toHaveTextContent("No start yet");
    });

    expect(screen.getByRole("button", { name: "Create ride" })).toBeDisabled();
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Search for a destination, or choose it on the map.",
    );
    // The reason is the only instruction: the overlay hint would duplicate it.
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
  });
});

/**
 * The coordinate the composer records for a point (`lat, lon`, 4 decimals).
 *
 * Read from the value cell's `data-coordinate`, which is the machine-readable
 * copy of the secondary coordinate line: the cell's own text is the point's name
 * ("Dropped pin") followed by that number, so parsing the visible text would
 * only work while the name happened to be absent (defect: raw coordinates shown
 * as the place value).
 */
function composerCoordinate(testId: string): { readonly lon: number; readonly lat: number } {
  const text = screen.getByTestId(testId).getAttribute("data-coordinate") ?? "";
  const [lat, lon] = text.split(",").map((part) => Number.parseFloat(part.trim()));
  if (lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error(`"${text}" is not a rendered coordinate`);
  }
  return { lat, lon };
}

/**
 * The owner review's planning-failure requirements (04 §21, §29) and the
 * workspace's own replanning rule.
 *
 * A failed plan is the state where a workspace most easily lies: the markers can
 * disappear with the route, the camera can keep showing a region the rider no
 * longer cares about, and the primary button can keep reading like a success.
 * These tests pin the honest version of each.
 */
describe("PlannerWorkspace — a failed plan (owner review 2026-09-17)", () => {
  /** A 422 the API's own error contract produces, mapped by the session. */
  function noRouteResponse(): Response {
    const fake: FakeResponse = {
      ok: false,
      status: 422,
      json: async (): Promise<unknown> => ({
        error: {
          code: "no-route",
          message: "no provider produced a usable route",
          recoverable: false,
        },
      }),
    };
    return fake as unknown as Response;
  }

  it("keeps both markers, frames them and offers recovery", async () => {
    const { mapFactory } = await renderWorkspace(
      (async (): Promise<Response> => noRouteResponse()) as typeof fetch,
    );

    await placeBothPoints();
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");
    // Everything up to here is placement: the camera has never been asked to frame
    // a ride. The failure framing below is the only fit after this point.
    host.reset();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));

    await waitFor(() => {
      expect(screen.getByTestId("planner-error")).toHaveTextContent(
        "No legal route to this destination — try another point.",
      );
    });

    // The markers are authored state: no route answer can remove them.
    const scene = host.lastScene();
    expect(scene?.points.map((point) => point.kind)).toEqual(["start", "finish"]);
    expect(scene?.routes).toHaveLength(0);

    // The attempt framed what is left — the two authored points — so both markers
    // are on screen with no route line at all (owner review 2026-09-17). It is the
    // *failure* that asks for this fit, not the placement that preceded it.
    expect(host.fits).toHaveLength(1);
    const fit = host.fits[0];
    if (fit === undefined) throw new Error("expected an automatic camera fit");
    const endpoints = [composerCoordinate("start-value"), composerCoordinate("finish-value")];
    for (const coordinate of endpoints) {
      expect(fit.extent.minLon).toBeLessThanOrEqual(coordinate.lon);
      expect(fit.extent.maxLon).toBeGreaterThanOrEqual(coordinate.lon);
      expect(fit.extent.minLat).toBeLessThanOrEqual(coordinate.lat);
      expect(fit.extent.maxLat).toBeGreaterThanOrEqual(coordinate.lat);
    }

    // Quiet, honest copy inside the sheet, and a primary action that does not
    // claim the update succeeded.
    expect(screen.getByTestId("planner-sheet")).toContainElement(
      screen.getByTestId("planner-error"),
    );
    expect(screen.getByTestId("planner-error")).toHaveAttribute("role", "alert");
    const plan = screen.getByTestId("compose-create");
    expect(plan).toHaveTextContent("Plan again");
    expect(plan).toBeEnabled();

    // The recovery action is the way out, and it arms the tool it names.
    fireEvent.click(screen.getByTestId("plan-recovery"));
    expect(screen.getByTestId("map-hint")).toHaveTextContent(
      "Tap the map to set your destination.",
    );
  });

  it("keeps the previous route visible while a failed update is answered", async () => {
    let calls = 0;
    const { mapFactory } = await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls += 1;
        return calls === 1
          ? jsonResponse(
              successBody(
                (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire })
                  .identity,
              ),
            )
          : noRouteResponse();
      }) as typeof fetch,
    );

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");

    // An edit starts the update on its own (04 §21), and its failure must not blank
    // the drawing the rider still has.
    fireEvent.click(screen.getByTestId("finish-chip"));
    clickMap(500, 500);

    await waitFor(() => {
      expect(screen.getByTestId("planner-error")).toBeInTheDocument();
    });
    expect(host.lastScene()?.routes.filter((route) => route.geometry.length >= 2)).toHaveLength(2);
    expect(host.lastScene()?.points).toHaveLength(2);
    expect(screen.getByTestId("status-line")).toHaveTextContent("previous ride");
    expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
  });
});

describe("PlannerWorkspace — replanning an edit (04 §21)", () => {
  it("asks again by itself when an edit moves past the answer on screen", async () => {
    const pending: Array<(response: Response) => void> = [];
    const { posts, mapFactory } = await renderWorkspace(
      (async (): Promise<Response> =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        })) as typeof fetch,
    );

    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    const firstIdentity = posts[0];
    if (firstIdentity === undefined) throw new Error("expected a plan request");
    // The first-route answer lands first; only then does the full request go out.
    await act(async () => {
      pending[0]?.(jsonResponse(successBody(firstIdentity)));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await act(async () => {
      pending[1]?.(jsonResponse(successBody(firstIdentity)));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });

    // One command moves the revision past the answer on screen. Nothing presses
    // the commitment button: the edit itself asks again, and the previous drawing
    // stays visible while the answer is computed (04 §9).
    fireEvent.click(screen.getByTestId("finish-chip"));
    clickMap(500, 500);

    await waitFor(() => {
      expect(pending).toHaveLength(3);
    });
    expect(screen.getByTestId("status-line")).toHaveTextContent("Updating ride…");
    expect(mapFactory.hosts[0]?.lastScene()?.routes).toHaveLength(2);

    const secondIdentity = posts[2];
    if (secondIdentity === undefined) throw new Error("expected a second plan request");
    await act(async () => {
      pending[2]?.(jsonResponse(successBody(secondIdentity)));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    await act(async () => {
      pending[3]?.(jsonResponse(successBody(secondIdentity)));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("status-line")).toHaveTextContent("Ride ready.");
    });
  });
});

/**
 * The map's own failure surface (4.0s).
 *
 * The host publishes its load health (`data-map-load`) and rebuilds its renderer
 * once by itself; what the workspace owes the rider is the other half: when the
 * map is not coming back on its own, say so in one quiet line, offer the one
 * action that can help, and stop offering placement affordances the map cannot
 * serve. A blank canvas with no explanation is the failure this pins down.
 */
describe("PlannerWorkspace — an unloadable map (4.0s)", () => {
  async function failedMap(): Promise<RenderedWorkspace> {
    const rendered = await renderWorkspace(unfetched());
    const host = rendered.mapFactory.hosts[0];
    if (host === undefined) throw new Error("the workspace has no map host");
    act(() => {
      host.reportStatus({ state: "failed", reason: "tile" });
    });
    return rendered;
  }

  it("shows one quiet notice with the retry action when the map failed", async () => {
    const { mapFactory } = await renderWorkspace(unfetched());
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("the workspace has no map host");
    // The real order of events: the renderer reports what broke, and the load
    // ends `failed`. Both channels carry the same failure, so the sheet must
    // still say it once.
    act(() => {
      host.reportStatus({ state: "failed", reason: "tile" });
      host.failWith({ kind: "tile", detail: "tiles.openfreemap.org" });
    });

    const notice = screen.getByTestId("map-load-notice");
    expect(notice).toHaveTextContent("The map didn't load");
    expect(notice).toHaveAttribute("data-map-load-reason", "tile");
    expect(within(notice).getByTestId("map-retry")).toHaveTextContent("Retry map");
    // The bounded 05 §22 notice yields to it rather than repeating it.
    expect(screen.queryByTestId("map-error-notice")).not.toBeInTheDocument();
    // 05 §22: the rest of the planner is untouched — the sheet, the composer and
    // the ride are all still there.
    expect(screen.getByTestId("planner-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("compose-create")).toBeInTheDocument();
  });

  it("asks the map for exactly one retry per press, and never stacks a second map", async () => {
    const { mapFactory } = await failedMap();
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("the workspace has no map host");

    fireEvent.click(screen.getByTestId("map-retry"));

    expect(host.retries).toBe(1);
    // One press, one attempt: the host publishes `retrying` while it rebuilds and
    // the workspace shows a chip in place of the notice — never a second surface.
    expect(screen.getByTestId("map-retry-chip")).toHaveTextContent("Retrying");
    expect(screen.queryByTestId("map-load-notice")).not.toBeInTheDocument();
    expect(mapFactory.hosts).toHaveLength(1);
    expect(screen.getAllByTestId("planner-map")).toHaveLength(1);

    // The rebuild lands: the chip and the failure both go, and the map is honest
    // about being usable again.
    act(() => {
      host.reportStatus({ state: "ready", reason: null });
    });
    expect(screen.queryByTestId("map-retry-chip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-load-notice")).not.toBeInTheDocument();
  });

  it("disables the placement affordances the map cannot serve, with a reason", async () => {
    await failedMap();

    expect(screen.getByTestId("start-chip")).toBeDisabled();
    expect(screen.getByTestId("finish-chip")).toBeDisabled();
    // The reason is stated, not implied: the composer's own missing-point copy
    // would otherwise tell the rider to do something the map cannot do.
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent("map");
    expect(screen.getByTestId("plan-disabled-reason")).not.toHaveTextContent(
      "Set a start point on the map",
    );
  });

  it("keeps planning available for a ride that is already complete", async () => {
    const { mapFactory } = await renderWorkspace(unfetched());
    await placeBothPoints();
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("the workspace has no map host");
    act(() => {
      host.reportStatus({ state: "failed", reason: "tile" });
    });

    // Planning itself does not need the canvas: only placement does.
    expect(screen.getByTestId("compose-create")).toBeEnabled();
    expect(screen.queryByTestId("plan-disabled-reason")).not.toBeInTheDocument();
    // The chips still say why they cannot take a tap.
    expect(screen.getByTestId("map-required-reason")).toHaveTextContent("map");
  });

  it("does not replace the map's runtime notice with the load notice", async () => {
    const { mapFactory } = await renderWorkspace(unfetched());
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("the workspace has no map host");
    act(() => {
      host.reportStatus({ state: "ready", reason: null });
      host.failWith({ kind: "tile", detail: "tiles.openfreemap.org" });
    });

    // The map is up and drawing; a few missing tiles are the bounded 05 §22
    // notice, not the "map didn't load" surface.
    expect(screen.getByTestId("map-error-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("map-load-notice")).not.toBeInTheDocument();
  });
});

describe("PlannerWorkspace — Why this ride? (04 §13)", () => {
  it("explains the selected route deterministically and keeps it keyboard-reachable", async () => {
    await renderWorkspace(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        jsonResponse(
          successBody(
            (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire }).identity,
          ),
        )) as typeof fetch,
    );
    await placeBothPoints();
    fireEvent.click(screen.getByRole("button", { name: "Create ride" }));
    await waitFor(() => {
      expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(2);
    });

    // Only the route on screen is explained: an alternative's explanation is a
    // different ride (04 §13), so it carries no control.
    const toggles = screen.getAllByTestId("route-why-toggle");
    expect(toggles).toHaveLength(1);
    const toggle = toggles[0];
    if (toggle === undefined) throw new Error("expected the selected card's control");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Why this ride?");
    toggle.focus();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);

    const panel = screen.getByTestId("route-why-panel");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The fixture's two candidates differ by 2 minutes and nothing else
    // measured, so the headline says the cost and claims no benefit.
    expect(within(panel).getByTestId("route-why-headline")).toHaveTextContent(
      "Adds 12 minutes over the fastest option.",
    );
    const bulletText = within(panel)
      .getAllByTestId("route-why-bullet")
      .map((bullet) => bullet.textContent ?? "")
      .join(" | ");
    expect(bulletText).toContain("No road-metric evidence is available for this route yet.");
    expect(bulletText).toContain("Surface is unverified on 75 mi of this route.");
    expect(bulletText).toContain("Traffic is unknown for this route, so no delay is claimed.");
    expect(bulletText).not.toMatch(/graphhopper|valhalla|tomtom/i);

    // And the surface itself is never claimed as known.
    expect(screen.getByTestId("route-unknowns-note")).toHaveTextContent(/surface/);
  });
});
