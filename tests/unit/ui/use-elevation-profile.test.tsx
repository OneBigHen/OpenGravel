/**
 * The elevation profile hook's one-request rule.
 *
 * Two surfaces show the same route's profile — the elevation chart in the ride
 * column and the glance strip over the map — and they mount in the same commit.
 * One request has to answer both: the profile is provider data about the line and
 * it is expensive enough that fetching it twice per plan is a defect.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ElevationResult, ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";
import { useElevationProfile } from "@/ui/planner/useElevationProfile";

const LINE: readonly Coordinate[] = [
  { lon: -75.2, lat: 39.95 },
  { lon: -75.0, lat: 40.05 },
  { lon: -74.8, lat: 40.2 },
];

function Probe({
  source,
  routeId,
}: {
  readonly source: ElevationSource;
  readonly routeId: string;
}) {
  const state = useElevationProfile(source, routeId, LINE);
  return <p data-testid={`state-${routeId}`}>{state?.status ?? "none"}</p>;
}

/** A source that answers every point with the same height, and counts its calls. */
function countingSource(): { readonly source: ElevationSource; readonly calls: () => number } {
  let calls = 0;
  const source: ElevationSource = {
    elevations: async (points): Promise<ElevationResult> => {
      calls += 1;
      return { availability: "available", elevationsMeters: points.map(() => 120) };
    },
  };
  return { source, calls: () => calls };
}

afterEach(() => {
  cleanup();
});

describe("useElevationProfile", () => {
  it("answers two surfaces showing the same route with one request", async () => {
    const { source, calls } = countingSource();
    render(
      <>
        <Probe source={source} routeId="route_shared" />
        <Probe source={source} routeId="route_shared" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("state-route_shared").map((node) => node.textContent)).toEqual([
        "ready",
        "ready",
      ]);
    });
    expect(calls()).toBe(1);
  });

  it("asks once per route, and not again for a route it already answered", async () => {
    const { source, calls } = countingSource();
    const { rerender } = render(<Probe source={source} routeId="route_a" />);
    await waitFor(() => {
      expect(screen.getByTestId("state-route_a")).toHaveTextContent("ready");
    });

    rerender(<Probe source={source} routeId="route_b" />);
    await waitFor(() => {
      expect(screen.getByTestId("state-route_b")).toHaveTextContent("ready");
    });
    expect(calls()).toBe(2);

    // Back to a route whose profile is already known: the cache answers it.
    rerender(<Probe source={source} routeId="route_a" />);
    expect(screen.getByTestId("state-route_a")).toHaveTextContent("ready");
    expect(calls()).toBe(2);
  });
});
