import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { breadcrumbMeasurements } from "@/application/breadcrumb/measurements";
import { buildElevationProfile } from "@/application/elevation/profile";
import { straightBreadcrumb } from "@/domain/breadcrumb/route";
import { createRideDocument } from "@/domain/ride/create";
import { BreadcrumbSummary } from "@/ui/planner/BreadcrumbSummary";

const METERS_PER_DEGREE = 111_194.9;

function routeOf(meters: number) {
  return straightBreadcrumb([
    { id: "a", coordinate: { lat: 40, lon: -75 } },
    { id: "b", coordinate: { lat: 40 + meters / METERS_PER_DEGREE, lon: -75 } },
  ]);
}

function profileOf(meters: number, elevationAt: (distance: number, index: number) => number) {
  const distances: number[] = [];
  for (let distance = 0; distance <= meters; distance += 10) distances.push(distance);
  const profile = buildElevationProfile(
    distances.map((distanceMeters) => ({ distanceMeters, coordinate: { lat: 40, lon: -75 } })),
    distances.map(elevationAt),
  );
  if (profile === null) throw new Error("test profile could not be built");
  return profile;
}

function renderSummary(meters: number, elevationAt: (distance: number, index: number) => number) {
  const route = routeOf(meters);
  const profile = profileOf(meters, elevationAt);
  render(
    <BreadcrumbSummary
      route={route}
      document={createRideDocument()}
      libraryService={undefined}
      elevation={{ status: "ready", profile }}
      measurements={breadcrumbMeasurements(route, profile)}
      onToggleSnap={() => undefined}
      snapping={null}
      snapError={null}
      onClear={() => undefined}
      editing
    />,
  );
}

afterEach(cleanup);

describe("breadcrumb summary grade copy", () => {
  it("describes a jagged DEM as an approximate, modest grade", () => {
    // A 2% climb with ±8 m of DEM wobble: per 30 m this reads as a wall.
    renderSummary(1000, (distance, index) => 0.02 * distance + (index % 2 === 0 ? 8 : -8));

    expect(screen.getByText("Max grade about 2%")).toBeTruthy();
    expect(screen.queryByTestId("breadcrumb-steep")).toBeNull();
    expect(screen.queryByText(/Very steep/)).toBeNull();
  });

  it("keeps a sustained steep pitch and words it as approximate", () => {
    renderSummary(1000, (distance) => 0.5 * Math.min(distance, 400));

    const warning = screen.getByTestId("breadcrumb-steep");
    expect(warning.textContent).toContain("Very steep: about 50% max grade.");
    expect(warning.textContent).not.toMatch(/Very steep: 50%/);
  });
});
