/**
 * Route detail fuel advice uses the rider's active garage bike (EX-02, RS-01),
 * not the catalog author's bike or a generic default.
 */

import { describe, expect, it } from "vitest";

import type { CatalogEntry } from "@/application/explore/catalog";
import { enrichRoutePreparationForLongTrip } from "@/application/explore/long-trip";
import type { RoutePreparation } from "@/application/preparation/prepare-route";

const YORK = {
  distanceKm: 155 * 1.609344,
  estimatedTimeMinutes: null,
  geometry: [{ lon: -76.7, lat: 39.96 }],
  sourceDocument: undefined,
} as unknown as CatalogEntry;
const EMPTY = { items: [] } as unknown as RoutePreparation;

function fuelLine(bike?: { fuelRangeMiles: number; reserveMiles: number } | null): string | undefined {
  return enrichRoutePreparationForLongTrip(YORK, EMPTY, bike).considerations?.find((item) => item.kind === "fuel")?.whyLine;
}

describe("route detail fuel advice (EX-02, RS-01)", () => {
  it("measures the route against the active bike's usable range", () => {
    expect(fuelLine({ fuelRangeMiles: 150, reserveMiles: 30 })).toContain("120 mi usable range (150 mi range − 30 mi reserve)");
    expect(fuelLine({ fuelRangeMiles: 100, reserveMiles: 20 })).toContain("80 mi usable range");
  });

  it("says it is a default only when there is no bike to use", () => {
    expect(fuelLine(null)).toMatch(/conservative default/);
  });
});
