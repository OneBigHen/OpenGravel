/**
 * Failed-update recovery, through the real workspace (04-PLANNER-AND-WORKSPACE-UX
 * §9, §20, §21; 05-MAP-INTERACTION-AND-CARTOGRAPHY §11, §12).
 *
 * The selector, the guard and the span computation are unit-tested on their own; what
 * only the composition can prove is the *workflow*: an edit whose replan fails leaves
 * the previous ride on the map in the previous treatment, names the change, offers the
 * three actions, and each of those actions reaches the authority it claims — Retry
 * spends a new attempt, Edit selects the object the change touched, and Discard
 * returns the whole ride to what it was.
 *
 * The fetch is a scripted fake speaking the real `/api/route-plan` contract, so a
 * failure is the same 422 `no-route` body the wire defines and the answer that
 * follows it is a materially different line — nothing here depends on a network or a
 * renderer.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClientPlanningService } from "@/application/planner/client-planning-service";
import type {
  RoutePlanCandidate,
  RoutePlanIdentityWire,
} from "@/application/planner/ports/route-plan-contract";
import type { MapIntent } from "@/application/map/types";
import type { Coordinate } from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { RouteScoreComponents } from "@/domain/route/types";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";

import { createStubMapHostFactory, type StubMapHostFactory } from "../support/stub-map-host";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const MAP_SIZE = 1000;
const ORIGIN = { lon: -75.2, lat: 39.95 };

/** The answer on screen: four points, so a moved middle is a *section*. */
const ROUTE: readonly Coordinate[] = [
  { lon: -75.2, lat: 39.95 },
  { lon: -75.12, lat: 39.99 },
  { lon: -74.95, lat: 40.06 },
  { lon: -74.8, lat: 40.2 },
];
/** The update's answer: the two middle vertices really move (~1 km west each). */
const MOVED_ROUTE: readonly Coordinate[] = [
  { lon: -75.2, lat: 39.95 },
  { lon: -75.13, lat: 39.99 },
  { lon: -75.03, lat: 40.08 },
  { lon: -74.8, lat: 40.2 },
];

const BASE_DURATION_SECONDS = 1_500;
const BASE_DISTANCE_METERS = 20_000;
/** +3 min and +1.8 mi: the delta copy the chip must state. */
const ADDED_DURATION_SECONDS = 180;
const ADDED_DISTANCE_METERS = 2_897;

type Answer = "success" | "moved" | "no-route";

interface Harness {
  readonly rideDocumentStore: ReturnType<typeof createRideDocumentStore>;
  readonly plannerUiStore: ReturnType<typeof createPlannerUiStore>;
  readonly mapFactory: StubMapHostFactory;
  readonly answer: { mode: Answer };
}

let current: Harness | null = null;

function unscoredComponents(): RouteScoreComponents {
  const component = (key: string): RouteScoreComponents["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `unscored.${key}`,
    evidenceStatus: "unknown",
  });
  return {
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
  };
}

function wireCandidate(
  id: string,
  geometry: readonly Coordinate[],
  durationSeconds: number,
  distanceMeters: number,
): RoutePlanCandidate {
  return {
    id: asRouteCandidateId(id),
    provider: { providerId: "graphhopper", profile: "motorcycle_adventure" },
    geometry,
    distanceMeters,
    durationSeconds,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: { policyVersion: "VNEXT_STUB_0", total: 0, components: unscoredComponents() },
    warnings: [],
    fingerprint: `fp_${id}_${durationSeconds}`,
  };
}

function successBody(identity: RoutePlanIdentityWire, moved: boolean): unknown {
  const geometry = moved ? MOVED_ROUTE : ROUTE;
  const duration = BASE_DURATION_SECONDS + (moved ? ADDED_DURATION_SECONDS : 0);
  const distance = BASE_DISTANCE_METERS + (moved ? ADDED_DISTANCE_METERS : 0);
  const best = asRouteCandidateId("route_best");
  return {
    identity,
    bundle: {
      policyVersion: "VNEXT_STUB_0",
      graphVersion: "unknown",
      evidenceVersion: "unknown",
      candidates: [
        wireCandidate("route_best", geometry, duration, distance),
        wireCandidate("route_other", geometry, duration + 300, distance + 1_000),
      ],
      roles: {
        "best-ride": best,
        fastest: null,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      selectedRouteId: best,
      selectionSource: "automatic",
    },
    diagnostics: { optionalProvidersUnavailable: [] },
  };
}

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

function response(body: unknown, status = 200): Response {
  const fake: FakeResponse = { ok: status < 400, status, json: async (): Promise<unknown> => body };
  return fake as unknown as Response;
}

/** The scripted seam: the planner's answer changes when the test says so. */
function scriptedFetcher(harness: { mode: Answer }): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const identity = (JSON.parse(String(init?.body)) as { identity: RoutePlanIdentityWire })
      .identity;
    if (harness.mode === "no-route") {
      return response(
        {
          error: {
            code: "no-route",
            message: "No legal route to this destination — try another point.",
            recoverable: false,
          },
        },
        422,
      );
    }
    return response(successBody(identity, harness.mode === "moved"));
  }) as typeof fetch;
}

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

function coordinateAt(x: number, y: number): Coordinate {
  return {
    lon: ORIGIN.lon + (x / MAP_SIZE) * 0.4,
    lat: ORIGIN.lat + (y / MAP_SIZE) * 0.25,
  };
}

function tapMap(x: number, y: number): void {
  const host = current?.mapFactory.hosts[0];
  if (host === undefined) throw new Error("the workspace has no map host");
  const intent: MapIntent = { type: "map-click", coordinate: coordinateAt(x, y) };
  act(() => {
    host.emit(intent);
  });
}

async function renderWorkspace(): Promise<Harness> {
  const answer = { mode: "success" as Answer };
  const rideDocumentStore = createRideDocumentStore({ now });
  const planningSessionStore = createPlanningSessionStore({
    service: createClientPlanningService({ fetcher: scriptedFetcher(answer), now }),
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
  // The shaping tools live behind the "Refine route" disclosure.
  fireEvent.click(screen.getByTestId("refine-toggle"));
  await Promise.resolve();
  await Promise.resolve();
  const harness: Harness = { rideDocumentStore, plannerUiStore, mapFactory, answer };
  current = harness;
  return harness;
}

async function planFixtureRide(): Promise<void> {
  tapMap(100, 100);
  await waitFor(() =>
    expect(screen.getByTestId("start-value")).not.toHaveTextContent("No start yet"),
  );
  tapMap(900, 900);
  await waitFor(() =>
    expect(screen.getByTestId("finish-value")).not.toHaveTextContent("No destination yet"),
  );
  fireEvent.click(screen.getByTestId("compose-create"));
  await waitFor(() => expect(screen.getByTestId("status-line")).toHaveTextContent("Ride ready."));
}

/** Adds a stop, which is an edit, and lets its replan fail. */
async function failAnEdit(): Promise<void> {
  const harness = current;
  if (harness === null) throw new Error("the workspace is not rendered");
  harness.answer.mode = "no-route";
  fireEvent.click(screen.getByTestId("add-stop"));
  tapMap(500, 500);
  await waitFor(() =>
    expect(screen.getByTestId("status-line")).toHaveTextContent(
      "Planning failed — your previous ride is still shown.",
    ),
  );
}

function drawnRoutes(): readonly { readonly state: string }[] {
  const scene = current?.mapFactory.hosts[0]?.lastScene() ?? null;
  return scene === null ? [] : scene.routes;
}

beforeEach(() => {
  mockMapViewport();
});

afterEach(() => {
  current = null;
  cleanup();
  vi.restoreAllMocks();
});

describe("a failed update keeps the ride and names the change (04 §9, §21)", () => {
  it("draws the previous answer dimmed, shows the banner, and offers the three actions", async () => {
    const harness = await renderWorkspace();
    await planFixtureRide();
    expect(drawnRoutes().every((route) => route.state === "selected" || route.state === "alternative")).toBe(true);

    await failAnEdit();

    // 05 §11: the answer that no longer answers this revision is the *previous* one.
    expect(drawnRoutes().map((route) => route.state)).toEqual(["previous", "previous"]);
    // Nothing is broken: the banner names the change and states the failure once.
    const banner = screen.getByTestId("update-failure-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("update-failure-label")).toHaveTextContent("Add stop");
    expect(screen.getByTestId("update-failure-message")).toHaveTextContent(
      "No legal route to this destination — try another point.",
    );
    expect(screen.getByTestId("update-retry")).toBeEnabled();
    expect(screen.getByTestId("update-edit")).toBeEnabled();
    expect(screen.getByTestId("update-discard")).toBeEnabled();
    // The failure is not a success state: no route card claims to be the answer.
    expect(harness.rideDocumentStore.getState().document.intent.stops).toHaveLength(1);
    expect(screen.queryByTestId("route-delta-chip")).toBeNull();
    expect(current?.mapFactory.hosts[0]?.lastScene()?.changedSpan ?? null).toBeNull();
  });

  it("opens the editor of the object the change touched", async () => {
    const harness = await renderWorkspace();
    await planFixtureRide();
    await failAnEdit();

    // The rider collapsed the sheet; Edit must open the editor it points at.
    harness.plannerUiStore.getState().setSheetDetent("peek");
    fireEvent.click(screen.getByTestId("update-edit"));

    const stopId = harness.rideDocumentStore.getState().document.intent.stops[0]?.id;
    expect(harness.plannerUiStore.getState().selectedObject).toEqual({
      kind: "stop",
      stopId,
    });
    expect(harness.plannerUiStore.getState().sheetDetent).toBe("expanded");
  });
});

describe("Retry, and the answer that lands (04 §21, 05 §12)", () => {
  it("asks again, highlights the changed section and states the delta", async () => {
    await renderWorkspace();
    await planFixtureRide();
    await failAnEdit();
    const answer = current?.answer;
    if (answer === undefined) throw new Error("the workspace is not rendered");

    answer.mode = "moved";
    fireEvent.click(screen.getByTestId("update-retry"));

    await waitFor(() => expect(screen.getByTestId("status-line")).toHaveTextContent("Ride ready."));
    // The failed change is gone with the answer it was waiting for.
    expect(screen.queryByTestId("update-failure-banner")).toBeNull();
    // The new answer is the rider's route again (05 §11)…
    expect(drawnRoutes().map((route) => route.state)).toEqual(["selected", "alternative"]);
    // …the changed section is emphasised (05 §12)…
    const span = current?.mapFactory.hosts[0]?.lastScene()?.changedSpan ?? null;
    expect(span).not.toBeNull();
    expect((span?.coordinates ?? []).length).toBeGreaterThanOrEqual(2);
    expect(span?.untilIso).toBeDefined();
    // …and the chip states what the update cost, measured against the old answer.
    expect(screen.getByTestId("route-delta-chip")).toHaveTextContent(
      "+3 min · +1.8 mi vs previous",
    );
  });

  it("ends the emphasis on the rider's next interaction (05 §12)", async () => {
    await renderWorkspace();
    await planFixtureRide();
    await failAnEdit();
    const answer = current?.answer;
    if (answer === undefined) throw new Error("the workspace is not rendered");
    answer.mode = "moved";
    fireEvent.click(screen.getByTestId("update-retry"));
    await waitFor(() => expect(screen.getByTestId("status-line")).toHaveTextContent("Ride ready."));
    expect(current?.mapFactory.hosts[0]?.lastScene()?.changedSpan ?? null).not.toBeNull();

    // One tap on the map is enough: the emphasis is bounded by the rider's action,
    // not only by its timer.
    tapMap(200, 200);

    expect(current?.mapFactory.hosts[0]?.lastScene()?.changedSpan ?? null).toBeNull();
    expect(screen.queryByTestId("route-delta-chip")).toBeNull();
  });
});

describe("Discard change is one whole-ride undo (04 §20, §21)", () => {
  it("returns the ride to what it was and clears the failure", async () => {
    const harness = await renderWorkspace();
    await planFixtureRide();
    await failAnEdit();
    expect(harness.rideDocumentStore.getState().document.intent.stops).toHaveLength(1);
    const failedRevision = harness.rideDocumentStore.getState().document.revision;

    harness.answer.mode = "success";
    fireEvent.click(screen.getByTestId("update-discard"));

    // The attempted change is gone (04 §20: the prior RideDocument, not just the
    // point), a new revision answers the replan it triggers, and the failure banner
    // goes with it.
    expect(harness.rideDocumentStore.getState().document.intent.stops).toHaveLength(0);
    expect(harness.rideDocumentStore.getState().document.revision).toBeGreaterThan(
      failedRevision,
    );
    await waitFor(() => expect(screen.getByTestId("status-line")).toHaveTextContent("Ride ready."));
    expect(screen.queryByTestId("update-failure-banner")).toBeNull();
    expect(drawnRoutes().map((route) => route.state)).toEqual(["selected", "alternative"]);
  });
});

describe("an edit that leaves the ride incomplete is not a failed update", () => {
  it("does not replan when undo removes the destination", async () => {
    const harness = await renderWorkspace();
    await planFixtureRide();
    // Any request from here on would fail, so a replan would surface as a failure.
    harness.answer.mode = "no-route";

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(screen.getByTestId("finish-value")).toHaveTextContent("No destination yet"),
    );
    await Promise.resolve();

    expect(screen.getByTestId("status-line")).not.toHaveTextContent("Planning failed");
    expect(screen.queryByTestId("update-failure-banner")).toBeNull();
  });
});
