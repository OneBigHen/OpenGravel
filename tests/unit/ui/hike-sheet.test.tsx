/**
 * Hike mode's surfaces: the planned hike's summary replaces the ride result,
 * the floating card is slim, and the rider-only controls step aside.
 * Rider mode is untouched (asserted alongside).
 */
import type { PlannerActiveRoute } from "@/ui/planner/hooks/usePlannerActiveRoute";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RouteCandidate } from "@/domain/route/types";
import { createRideDocument } from "@/domain/ride/create";
import { asRouteCandidateId } from "@/domain/route/ids";
import { setActivityMode } from "@/ui/stores/activity-mode";
import { HikeActivityControls } from "@/ui/planner/HikeActivityControls";
import { PlannerResultPanel } from "@/ui/planner/PlannerResultPanel";
import { RouteContext } from "@/ui/planner/RouteContext";
import { MapAdvisorAsk } from "@/ui/planner/RideAdvisor";
import type { HikeSummaryModel } from "@/ui/planner/HikeSummary";

const NOW = "2026-06-21T14:00:00.000Z";

const candidate = {
  routeId: asRouteCandidateId("route_hike_1"),
  provider: { profile: "hike" },
  distanceMeters: 13_500,
  durationSeconds: 10_020,
  hike: { gainMeters: 235.6, lossMeters: 491 },
  warnings: [{ id: "roads", message: "1.9 mi on roads" }, { id: "far", message: "Ends 1.0 mi from the nearest trail." }],
} as unknown as RouteCandidate;

function model(overrides: Partial<HikeSummaryModel> = {}): HikeSummaryModel {
  return { candidate, returnToStart: false, onReturnToStart: vi.fn(), canPlan: true, onPlan: vi.fn(), onDraw: vi.fn(), ...overrides };
}

function renderPanel(hike: HikeSummaryModel | null, start = { refusal: null, starting: false, error: null, onStart: vi.fn() }) {
  const ride = createRideDocument({ now: NOW });
  render(<PlannerResultPanel
    inspector={null}
    hike={hike}
    choices={{ cards: [{ routeId: asRouteCandidateId("route_hike_1"), roleKey: "best-ride", roleLabel: "Best Ride", durationLabel: "2 h 47 min", distanceLabel: "8.4 mi", addedTimeLabel: null, badges: [], unknownSurfaceMi: null, whyKey: "why", isSelected: true }], explanation: null, onSelect: vi.fn() }}
    actions={{ document: ride, libraryService: undefined, shareService: undefined, route: null, start }}
    briefing={{ route: null, ride, bikes: [], providers: undefined, offlineRoute: null, actions: { setBike: vi.fn(), setDeparture: vi.fn(), setArriveBy: vi.fn() }, onRouteTraffic: vi.fn() }}
  />);
  return start;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); act(() => setActivityMode("ride")); });

describe("the hike summary", () => {
  it("replaces the ride result with hike numbers and a Start hike button", () => {
    act(() => setActivityMode("hike"));
    const start = renderPanel(model());
    const summary = screen.getByTestId("hike-route-summary");
    expect(summary).toHaveTextContent("HIKE");
    expect(summary).toHaveTextContent("~2 h 47 min");
    expect(summary).toHaveTextContent("8.4 mi");
    expect(summary).toHaveTextContent("↑ 773 ft");
    expect(summary).toHaveTextContent("↓ 1,611 ft");
    expect(summary).toHaveTextContent("1.9 mi on roads");
    expect(summary).toHaveTextContent("Ends 1.0 mi from the nearest trail.");
    expect(screen.queryByText(/best ride/i)).toBeNull();
    expect(screen.queryByText("Start ride")).toBeNull();
    expect(screen.queryByText("Free Ride")).toBeNull();
    fireEvent.click(screen.getByTestId("start-hike"));
    expect(start.onStart).toHaveBeenCalledOnce();
  });

  it("offers There and back as a switch and re-plan / draw", () => {
    act(() => setActivityMode("hike"));
    const hike = model();
    renderPanel(hike);
    const toggle = screen.getByRole("switch", { name: "There and back" });
    fireEvent.click(toggle);
    expect(hike.onReturnToStart).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("hike-plan"));
    expect(hike.onPlan).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("hike-draw-start"));
    expect(hike.onDraw).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("hike-breadcrumb")).toBeNull();
    expect(screen.queryByText(/roads:/i)).toBeNull();
  });

  it("offers Breadcrumb when the planner has the tool", () => {
    act(() => setActivityMode("hike"));
    const onBreadcrumb = vi.fn();
    renderPanel(model({ onBreadcrumb }));
    fireEvent.click(screen.getByTestId("hike-breadcrumb"));
    expect(onBreadcrumb).toHaveBeenCalledOnce();
  });

  it("is not shown in rider mode even when a hike model is passed", () => {
    renderPanel(model());
    expect(screen.queryByTestId("hike-route-summary")).toBeNull();
  });
});

describe("the hike card", () => {
  const props = (over: Partial<React.ComponentProps<typeof HikeActivityControls>> = {}) => ({
    candidate: null, error: null, canPlan: false, returnToStart: false, onReturnToStart: vi.fn(), onPlan: vi.fn(), drawing: false,
    sketch: { onStartDrawing: vi.fn(), onUndo: vi.fn(), onCancel: vi.fn(), onDone: vi.fn() }, onEnterHike: vi.fn(), ...over,
  });

  it("is absent for riders", () => {
    render(<HikeActivityControls {...props()} />);
    expect(screen.queryByTestId("hike-card")).toBeNull();
  });

  it("idle: a slim strip with the hint and Draw hike", () => {
    act(() => setActivityMode("hike"));
    render(<HikeActivityControls {...props()} />);
    const card = screen.getByTestId("hike-card");
    expect(card).toHaveAttribute("data-state", "idle");
    expect(card).toHaveTextContent("Press and hold the map to set a start and finish");
    expect(screen.getByTestId("hike-draw-start")).toBeInTheDocument();
    expect(screen.getByTestId("hike-exit")).toHaveTextContent("Back to riding");
  });

  it("idle: the how-to tip can be dismissed and stays dismissed", async () => {
    window.localStorage.removeItem("og-hike-tip-dismissed");
    act(() => setActivityMode("hike"));
    const { unmount } = render(<HikeActivityControls {...props()} />);
    fireEvent.click(screen.getByTestId("hike-tip-dismiss"));
    expect(screen.getByTestId("hike-card")).not.toHaveTextContent("Press and hold");
    expect(screen.getByTestId("hike-plan")).toBeInTheDocument();
    unmount();
    render(<HikeActivityControls {...props()} />);
    await waitFor(() => expect(screen.queryByTestId("hike-tip-dismiss")).toBeNull());
    window.localStorage.removeItem("og-hike-tip-dismissed");
  });

  it("idle with both ends set: the tip says to plan", () => {
    act(() => setActivityMode("hike"));
    render(<HikeActivityControls {...props({ canPlan: true })} />);
    expect(screen.getByTestId("hike-card")).toHaveTextContent("Start and finish set");
    expect(screen.getByTestId("hike-plan")).toBeEnabled();
  });

  it("planned: only the title and exit remain; the numbers are in the sheet", () => {
    act(() => setActivityMode("hike"));
    render(<HikeActivityControls {...props({ candidate })} />);
    const card = screen.getByTestId("hike-card");
    expect(card).toHaveAttribute("data-state", "planned");
    expect(screen.queryByTestId("hike-route-summary")).toBeNull();
    expect(screen.queryByTestId("hike-draw-start")).toBeNull();
    expect(screen.queryByTestId("hike-plan")).toBeNull();
  });

  it("steps aside like a planned hike while a breadcrumb owns the sheet", () => {
    act(() => setActivityMode("hike"));
    render(<HikeActivityControls {...props({ breadcrumb: true })} />);
    expect(screen.getByTestId("hike-card")).toHaveAttribute("data-state", "planned");
    expect(screen.queryByTestId("hike-plan")).toBeNull();
  });

  it("keeps an error visible when planned", () => {
    act(() => setActivityMode("hike"));
    render(<HikeActivityControls {...props({ candidate, error: "No trail route between these points." })} />);
    expect(screen.getByTestId("hike-card")).toHaveTextContent("No trail route between these points.");
    expect(screen.getByTestId("hike-card")).toHaveAttribute("data-error", "true");
  });
});

describe("rider-only controls", () => {
  it("hides the Ask chip in hike mode and keeps it for riders", () => {
    const { unmount } = render(<MapAdvisorAsk />);
    expect(screen.queryByTestId("map-ask-open")).not.toBeNull();
    unmount();
    act(() => setActivityMode("hike"));
    render(<MapAdvisorAsk />);
    expect(screen.queryByTestId("map-ask-open")).toBeNull();
  });
});

describe("the route context bar", () => {
  it("steps aside in hike mode", () => {
    act(() => setActivityMode("hike"));
    const ride = createRideDocument({ now: NOW });
    const route = { routeId: asRouteCandidateId("route_hike_1"), geometry: [{ lon: -75.4, lat: 40.1 }, { lon: -75.39, lat: 40.11 }], distanceMeters: 13_500, durationSeconds: 10_020 } as unknown as PlannerActiveRoute;
    const { container } = render(<RouteContext route={route} intent={ride.intent} />);
    expect(container).toBeEmptyDOMElement();
  });
});
