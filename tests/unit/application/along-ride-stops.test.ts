import { describe, expect, it } from "vitest";

import {
  alongRideMileLabel,
  alongRideOffRouteLabel,
  alongRideStopRows,
} from "@/application/explore/along-ride-stops";
import { METERS_PER_MILE, type AlongStop } from "@/application/map-layers/along";
import type { MapLayerId } from "@/application/map-layers/catalog";

function stop(
  layerId: MapLayerId,
  id: string,
  name: string,
  mile: number,
  offMiles: number,
  detail: string | null = null,
): AlongStop {
  return {
    feature: {
      id,
      layerId,
      name,
      detail,
      weight: null,
      geometry: { type: "Point", coordinates: [-75.7 + mile / 100, 40.8] },
    },
    alongMeters: mile * METERS_PER_MILE,
    offMeters: offMiles * METERS_PER_MILE,
  };
}

describe("along-ride stops", () => {
  it("keeps the closest few per category, spreads repeats, and orders by route mile", () => {
    const rows = alongRideStopRows([
      stop("fuel", "fuel-far", "Far Fuel", 22, 1.1),
      stop("fuel", "fuel-near", "Sheetz", 14, 0.3, "Main St, Lehighton"),
      // Same category two miles later: one fuel decision, not two.
      stop("fuel", "fuel-dupe", "Second Sheetz", 16, 0.9),
      stop("food", "food", "Diner", 8, 0.4),
      stop("coffee", "coffee", "Café", 3, 0.1),
      stop("viewpoints", "view-far", "Hawk Mountain", 26, 1.2),
      stop("viewpoints", "view-near", "Flagstaff Overlook", 12, 0.6),
    ]);

    expect(rows.map((row) => row.id)).toEqual([
      "coffee",
      "food",
      "view-near",
      "fuel-near",
      "fuel-far",
    ]);
    expect(rows.find((row) => row.id === "fuel-near")).toMatchObject({
      name: "Sheetz",
      detail: "Main St, Lehighton",
      mile: expect.closeTo(14),
      layer: "fuel",
      coordinate: { lon: -75.56, lat: 40.8 },
    });
  });

  it("leaves categories that a provider did not answer empty", () => {
    const rows = alongRideStopRows([stop("fuel", "fuel", "Wawa", 4, 0.2)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.layer).toBe("fuel");
  });

  it("ignores other layers, non-point features and positions it cannot place", () => {
    const camping = stop("camping", "camp", "Campsite", 5, 0.2);
    const line: AlongStop = {
      ...stop("food", "line", "Roadside diner", 6, 0.2),
      feature: {
        ...stop("food", "line", "Roadside diner", 6, 0.2).feature,
        geometry: { type: "LineString", coordinates: [[-75.6, 40.8], [-75.5, 40.8]] },
      },
    };
    const unknown: AlongStop = {
      ...stop("food", "unknown", "Nowhere", 7, 0.2),
      alongMeters: Number.NaN,
    };
    expect(alongRideStopRows([camping, line, unknown])).toEqual([]);
  });

  it("writes route position the way a rider reads it", () => {
    expect(alongRideMileLabel(14.2)).toBe("Mile 14");
    expect(alongRideMileLabel(0.2)).toBe("Start");
    expect(alongRideOffRouteLabel(480)).toBe("0.3 mi off route");
    expect(alongRideOffRouteLabel(60)).toBe("On route");
  });
});
