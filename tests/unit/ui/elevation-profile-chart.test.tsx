/**
 * The elevation chart's readable density (UX rework: elevation profile as a
 * chart): two densities on one component, the expanded axes, the authored-point
 * notches, the steepest-grade badge, and the keyboard scrub that moves the same
 * marker the pointer does.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { appCss } from "../../helpers/app-css";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildElevationProfile, sampleLine, type ElevationProfile } from "@/application/elevation/profile";
import type { ElevationWaypoint } from "@/application/elevation/waypoints";
import type { SurfaceRun } from "@/application/roads/engine-road-evidence";
import { ElevationProfileChart } from "@/ui/planner/ElevationProfileChart";
import type { ElevationProfileState } from "@/ui/planner/useElevationProfile";
import { setRouteScrub, useRouteScrub } from "@/ui/stores/route-scrub-store";

/** A straight west→east ride whose slope peaks in its middle third. */
const LINE = [
  { lon: -75.7, lat: 40.8 },
  { lon: -75.5, lat: 40.8 },
];

const ELEVATIONS = [200, 300, 400, 500, 600, 700, 600, 500, 400, 300, 200];

function profile(): ElevationProfile {
  const built = buildElevationProfile(sampleLine(LINE, ELEVATIONS.length), ELEVATIONS);
  if (built === null) throw new Error("fixture profile is unreadable");
  return built;
}

const WAYPOINTS: readonly ElevationWaypoint[] = [
  { coordinate: LINE[0]!, label: "Start" },
  { coordinate: { lon: -75.6, lat: 40.8 }, label: "Stop 1" },
  { coordinate: LINE[1]!, label: "Finish" },
];

const SURFACE: readonly SurfaceRun[] = [
  { kind: "gravel", from: 0, to: 0.6 },
  { kind: "unknown", from: 0.6, to: 1 },
];

function ready(): ElevationProfileState {
  return { status: "ready", profile: profile() };
}

/** Reads the presentation store the map's scrub marker follows. */
function ScrubProbe() {
  const scrub = useRouteScrub();
  return <span data-testid="scrub">{scrub === null ? "none" : `${scrub.lon.toFixed(5)},${scrub.lat.toFixed(5)}`}</span>;
}

function renderChart(): { chart: HTMLElement; svg: HTMLElement } {
  render(
    <>
      <ElevationProfileChart state={ready()} surface={SURFACE} waypoints={WAYPOINTS} line={LINE} />
      <ScrubProbe />
    </>,
  );
  return {
    chart: screen.getByTestId("elevation-profile"),
    svg: screen.getByRole("application"),
  };
}

function expand(chart: HTMLElement): void {
  const toggle = screen.getByTestId("elevation-expand");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(chart).toHaveAttribute("data-density", "expanded");
}

afterEach(() => {
  cleanup();
  setRouteScrub(null);
});

describe("ElevationProfileChart", () => {
  it("starts compact and opens the chart's axes, notches and grade badge on request", () => {
    const { chart } = renderChart();
    expect(chart).toHaveAttribute("data-density", "compact");
    expect(screen.queryAllByTestId("elevation-gridline")).toHaveLength(0);
    expect(screen.queryAllByTestId("elevation-waypoint")).toHaveLength(0);
    expect(screen.queryByTestId("elevation-grade-pin")).toBeNull();
    // The compact chart keeps its two-end ticks and its axis edge labels.
    expect(chart.querySelectorAll(".og-elevation__ticks span")).toHaveLength(2);

    expand(chart);

    // Three quartile gridlines, five y readings, five distance ticks.
    expect(screen.getAllByTestId("elevation-gridline")).toHaveLength(3);
    expect(chart.querySelectorAll(".og-elevation__ylabel")).toHaveLength(5);
    expect(chart.querySelectorAll(".og-elevation__ticks--expanded span")).toHaveLength(5);
    // One numbered notch per authored point, in ride order.
    const notches = screen.getAllByTestId("elevation-waypoint");
    expect(notches).toHaveLength(WAYPOINTS.length);
    expect(notches.map((notch) => notch.getAttribute("data-position"))).toEqual(["1", "2", "3"]);
    // The steepest sustained grade is annotated where it happens.
    const pin = screen.getByTestId("elevation-grade-pin");
    expect(pin).toHaveTextContent(/^max \d+%$/);
    // The chart hands the stylesheet a share, and the stylesheet clamps the tag
    // inside the drawing so it cannot be clipped at a phone's right edge.
    const share = Number.parseFloat(pin.style.getPropertyValue("--og-elevation-pin-share"));
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(100);
    const css = appCss();
    expect(css).toMatch(/\.og-elevation__grade-pin \{[^}]*left: clamp\(/);
    // The feet get their own gutter, and the drawing starts after it.
    expect(css).toMatch(/\.og-elevation__plot \{[^}]*padding-inline-start: var\(--og-elevation-gutter\)/);
  });

  it("keeps the axis labels out of the drawing box so they cannot be cut off", () => {
    const { chart } = renderChart();
    expand(chart);
    const plot = chart.querySelector(".og-elevation__plot");
    const frame = plot?.querySelector(".og-elevation__frame");
    const yaxis = plot?.querySelector(".og-elevation__yaxis");
    expect(plot).not.toBeNull();
    expect(frame).not.toBeNull();
    expect(yaxis).not.toBeNull();
    // The feet live in the plot's reserved gutter; the line, the notches and the
    // grade tag share the drawing box, so a percentage means one thing there.
    expect(frame).not.toContainElement(yaxis as HTMLElement);
    expect(frame).toContainElement(screen.getByRole("application"));
    expect(frame).toContainElement(screen.getByTestId("elevation-waypoints"));
    expect(frame).toContainElement(screen.getByTestId("elevation-grade-pin"));
  });

  it("collapses back to the compact density", () => {
    const { chart } = renderChart();
    expand(chart);
    fireEvent.click(screen.getByTestId("elevation-expand"));
    expect(chart).toHaveAttribute("data-density", "compact");
    expect(screen.queryAllByTestId("elevation-gridline")).toHaveLength(0);
  });

  it("keeps the pointer scrub driving the same map marker", () => {
    const { svg } = renderChart();
    const ride = profile();
    svg.getBoundingClientRect = (): DOMRect => ({ left: 0, width: 320 }) as DOMRect;
    fireEvent(svg, new MouseEvent("pointerdown", { clientX: 160, bubbles: true }));
    const middle = ride.points[Math.round(0.5 * (ride.points.length - 1))]!;
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${middle.coordinate.lon.toFixed(5)},${middle.coordinate.lat.toFixed(5)}`,
    );
    expect(screen.getByTestId("elevation-readout")).toBeInTheDocument();
    fireEvent(svg, new MouseEvent("pointercancel", { bubbles: true }));
    expect(screen.getByTestId("scrub")).toHaveTextContent("none");
  });

  it("opens expanded when the sheet is already expanded", () => {
    render(<ElevationProfileChart state={ready()} expandedBySheet />);
    expect(screen.getByTestId("elevation-profile")).toHaveAttribute("data-density", "expanded");
    expect(screen.getByTestId("elevation-expand")).toHaveAttribute("aria-expanded", "true");
  });

  it("steps the readout and the map scrub marker from the keyboard", () => {
    const { svg } = renderChart();
    const ride = profile();
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(svg.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(svg.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(/arrow keys/i);

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByTestId("elevation-readout")).toBeInTheDocument();
    const first = screen.getByTestId("elevation-readout").textContent;
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${ride.points[0]!.coordinate.lon.toFixed(5)},${ride.points[0]!.coordinate.lat.toFixed(5)}`,
    );

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByTestId("elevation-readout").textContent).not.toBe(first);
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${ride.points[1]!.coordinate.lon.toFixed(5)},${ride.points[1]!.coordinate.lat.toFixed(5)}`,
    );

    // Home and End jump to the ends; Shift steps ten samples.
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${ride.points[ride.points.length - 1]!.coordinate.lon.toFixed(5)},${ride.points[ride.points.length - 1]!.coordinate.lat.toFixed(5)}`,
    );
    fireEvent.keyDown(svg, { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${ride.points[0]!.coordinate.lon.toFixed(5)},${ride.points[0]!.coordinate.lat.toFixed(5)}`,
    );
    fireEvent.keyDown(svg, { key: "Home" });
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${ride.points[0]!.coordinate.lon.toFixed(5)},${ride.points[0]!.coordinate.lat.toFixed(5)}`,
    );

    // Keys the chart does not own are left to the page.
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(screen.getByTestId("scrub")).toHaveTextContent(
      `${ride.points[0]!.coordinate.lon.toFixed(5)},${ride.points[0]!.coordinate.lat.toFixed(5)}`,
    );
  });

  it("mirrors the keyboard readout into a polite live region, throttled", () => {
    vi.useFakeTimers();
    try {
      const { svg } = renderChart();
      fireEvent.keyDown(svg, { key: "ArrowRight" });
      fireEvent.keyDown(svg, { key: "ArrowRight" });
      const live = screen.getByTestId("elevation-announcement");
      expect(live).toHaveAttribute("aria-live", "polite");
      // Nothing is announced on every sample: the throttle holds the first tick.
      expect(live.textContent).toBe("");
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(live.textContent).toMatch(/mi · .*ft/);
      expect(live.textContent).toBe(screen.getByTestId("elevation-readout").textContent);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the surface strip's unknown stretch hatched and the legend in place", () => {
    renderChart();
    const strip = screen.getByTestId("elevation-surface");
    expect(strip.querySelector('[data-surface="unknown"]')).not.toBeNull();
    expect(strip.querySelectorAll("[data-surface]")).toHaveLength(SURFACE.length);
    // Unknown is named as unknown in the strip's own accessible summary.
    expect(strip.getAttribute("aria-label")).toContain("unknown");
    // The hatch itself is the stylesheet's: unknown is never drawn as a known surface.
    const css = appCss();
    expect(css).toMatch(/\.og-elevation__surface > \[data-surface="unknown"\] \{[^}]*repeating-linear-gradient/);
  });

  it("keeps the loading skeleton and the unavailable reason unchanged", () => {
    const { rerender } = render(<ElevationProfileChart state={{ status: "loading" }} />);
    expect(screen.getByTestId("elevation-profile")).toHaveAttribute("aria-busy", "true");
    rerender(<ElevationProfileChart state={{ status: "unavailable", reason: "Elevation data is not available right now." }} />);
    expect(screen.getByTestId("elevation-status")).toHaveTextContent("Elevation data is not available right now.");
  });
});
