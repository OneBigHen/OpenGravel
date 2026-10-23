/**
 * The glance strip: the live ride summary over the map.
 *
 * The pill answers "how big is this ride?" without the sheet, so what it claims
 * matters: it states the selected route's own labels, omits a climb nobody
 * measured, and never rounds an unknown surface up to a known one (CLAUDE.md).
 * It is one button, so assistive tech hears one sentence.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { asRouteCandidateId } from "@/domain/route/ids";
import {
  GLANCE_ANNOUNCE_DELAY_MS,
  MapRideGlance,
  rideGlanceSummary,
  type MapRideGlanceProps,
} from "@/ui/planner/MapRideGlance";

const BEST_ID = asRouteCandidateId("route_best");

function card(overrides: Partial<RouteCardVm> = {}): RouteCardVm {
  return {
    routeId: BEST_ID,
    roleKey: "best-ride",
    roleLabel: "Best Ride",
    durationLabel: "1 h 57 min",
    distanceLabel: "84 mi",
    addedTimeLabel: null,
    badges: [],
    confidenceLabel: "Surface confirmed",
    unknownSurfaceMi: 0,
    whyKey: `why-${BEST_ID}`,
    isSelected: true,
    tint: 0,
    surfaceStrip: { paved: 0.88, gravel: 0.12, dirt: 0, unknown: 0 },
    ...overrides,
  };
}

/** 3,200 ft, the spec's example climb. */
const CLIMB_METERS = 975.36;

function glance(overrides: Partial<MapRideGlanceProps> = {}) {
  return (
    <MapRideGlance
      summary={rideGlanceSummary(card(), CLIMB_METERS)}
      planning={false}
      failed={false}
      onOpenRide={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MapRideGlance", () => {
  it("is not rendered when there is no route and nothing is being planned", () => {
    const { container } = render(
      glance({ summary: null, planning: false, failed: false }),
    );

    expect(screen.queryByTestId("ride-glance-map")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("states the ride in one sentence and shows the same numbers", () => {
    render(glance());

    // One complete statement, spelled out, instead of four loose fragments.
    screen.getByRole("button", {
      name: "Ride summary: 1 h 57 min, 84 miles, 3,200 feet of climbing, 12% gravel. Show ride details.",
    });
    expect(screen.getByTestId("ride-glance-duration")).toHaveTextContent("1 h 57 min");
    expect(screen.getByTestId("ride-glance-distance")).toHaveTextContent("84 mi");
    expect(screen.getByTestId("ride-glance-climb")).toHaveTextContent("3,200 ft");
    expect(screen.getByTestId("ride-glance-surface")).toHaveTextContent("12% gravel");
    expect(screen.getByTestId("ride-glance-surface")).toHaveAttribute("data-known", "true");
  });

  it("omits a climb nobody measured and says it is not known", () => {
    render(glance({ summary: rideGlanceSummary(card(), null) }));

    expect(screen.queryByTestId("ride-glance-climb")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Ride summary/ });
    expect(button).toHaveAccessibleName(/climb not known/);
    expect(button).not.toHaveAccessibleName(/0 ft/);
  });

  it("says surface unknown rather than claiming a surface it has no evidence for", () => {
    render(
      glance({
        summary: rideGlanceSummary(
          card({ surfaceStrip: undefined, confidenceLabel: "Unknown", unknownSurfaceMi: 84 }),
          CLIMB_METERS,
        ),
      }),
    );

    const surface = screen.getByTestId("ride-glance-surface");
    expect(surface).toHaveTextContent("surface unknown");
    expect(surface).toHaveAttribute("data-known", "false");
    expect(surface).not.toHaveTextContent(/%/);
    expect(screen.getByRole("button", { name: /Ride summary/ })).toHaveAccessibleName(
      /surface unknown/,
    );
  });

  it("treats a strip that is entirely unknown as no usable surface", () => {
    render(
      glance({
        summary: rideGlanceSummary(
          card({ surfaceStrip: { paved: 0, gravel: 0, dirt: 0, unknown: 1 } }),
          CLIMB_METERS,
        ),
      }),
    );

    expect(screen.getByTestId("ride-glance-surface")).toHaveTextContent("surface unknown");
  });

  it("opens the ride details when the pill is tapped", () => {
    const onOpenRide = vi.fn();
    render(glance({ onOpenRide }));

    fireEvent.click(screen.getByRole("button", { name: /Ride summary/ }));

    expect(onOpenRide).toHaveBeenCalledTimes(1);
  });

  it("measures instead of claiming numbers while a plan is in flight", () => {
    render(glance({ summary: null, planning: true }));

    const container = screen.getByTestId("ride-glance-map");
    expect(container).toHaveAttribute("data-state", "planning");
    expect(screen.queryByTestId("ride-glance-duration")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ride-glance-distance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ride-glance-climb")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /planning your ride/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("offers Retry inside the pill when a plan failed with no route to show", () => {
    const onRetry = vi.fn();
    render(glance({ summary: null, planning: false, failed: true, onRetry }));

    const container = screen.getByTestId("ride-glance-map");
    expect(container).toHaveAttribute("data-state", "failed");
    expect(container).toHaveTextContent("No route yet");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("re-states a changed ride once, after the edits stop", () => {
    vi.useFakeTimers();
    const { rerender } = render(glance());
    const status = screen.getByTestId("ride-glance-map-status");
    // Arriving at a ride is not a change to announce.
    expect(status.textContent).toBe("");

    rerender(glance({ summary: rideGlanceSummary(card({ distanceLabel: "90 mi" }), null) }));
    // ...and neither is a value that has not settled yet.
    expect(status.textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(GLANCE_ANNOUNCE_DELAY_MS);
    });
    expect(status).toHaveTextContent("90 miles");
  });

  it("keeps the summary visible over the map and in the sheet's column", () => {
    const { rerender } = render(glance());
    expect(screen.getByTestId("ride-glance-map")).toHaveAttribute("data-placement", "map");

    rerender(glance({ placement: "dock" }));
    expect(screen.getByTestId("ride-glance-dock")).toHaveAttribute("data-placement", "dock");
    expect(screen.queryByTestId("ride-glance-map")).not.toBeInTheDocument();
  });
});
