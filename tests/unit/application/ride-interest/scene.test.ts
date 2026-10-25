import { describe, expect, it } from "vitest";

import { buildRideInterestScene, rideMapInterestPoints } from "@/application/ride-interest/scene";
import type { AheadRideInterestPoint } from "@/application/ride-interest/ahead-of-rider";
import type { RideInterestKind, RideInterestPoint } from "@/application/ride-interest/types";

function ahead(id: string, aheadMiles: number, name = id, kind: RideInterestKind = "waterfall"): AheadRideInterestPoint {
  const point: RideInterestPoint = {
    id,
    filter: kind === "fuel" ? "food" : "scenic",
    kind,
    name,
    coordinate: { lon: -75.3, lat: 40 },
    summary: null,
    photoUrl: null,
    detailUrl: null,
    attribution: "Test",
  };
  return { point, aheadMiles, offRouteMiles: 0.2 };
}

function point(id: string, kind: RideInterestKind): RideInterestPoint {
  return ahead(id, 1, id, kind).point;
}

describe("buildRideInterestScene", () => {
  it("draws a very-close point as live and a distant one as quiet", () => {
    const scene = buildRideInterestScene([ahead("close", 0.3), ahead("mid", 2), ahead("far", 8)]);
    expect(scene.find((s) => s.id === "close")?.tone).toBe("live");
    expect(scene.find((s) => s.id === "mid")?.tone).toBe("soon");
    expect(scene.find((s) => s.id === "far")?.tone).toBe("quiet");
  });

  it("puts the point's name and mileage in the pill", () => {
    const [scene] = buildRideInterestScene([ahead("a", 0.83, "Trap Falls")]);
    expect(scene!.pill).toBe("Trap Falls · 0.8 mi");
  });

  it("marks the selected id and boosts its priority above the rest", () => {
    const scene = buildRideInterestScene([ahead("a", 1), ahead("b", 2)], { selectedId: "b" });
    const selected = scene.find((s) => s.id === "b")!;
    const other = scene.find((s) => s.id === "a")!;
    expect(selected.selected).toBe(true);
    expect(other.selected).toBe(false);
    expect(selected.priority).toBeGreaterThan(other.priority);
  });

  it("caps the pin count, keeping the nearest (the input's own order)", () => {
    const scene = buildRideInterestScene([ahead("a", 1), ahead("b", 2), ahead("c", 3)], { maxPins: 2 });
    expect(scene.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("rideMapInterestPoints (what the ride map draws)", () => {
  const all = [
    point("ri:discover:asa-packer", "museum"),
    point("ri:discover:galerie-b", "architecture"),
    point("ri:layer:fuel:shell", "fuel"),
  ];

  it("draws gas and leaves the landmarks to the sheet", () => {
    // The ride a rider reported: a museum and a gallery pinned over the line at
    // 0.9 mi each, on a route they were already following.
    expect(rideMapInterestPoints(all, { filter: "scenic" }).map((p) => p.id)).toEqual([
      "ri:layer:fuel:shell",
    ]);
  });

  it("keeps the point the rider opened on the map, whatever it is", () => {
    expect(
      rideMapInterestPoints(all, { filter: "scenic", selectedId: "ri:discover:galerie-b" }).map((p) => p.id),
    ).toEqual(["ri:discover:galerie-b", "ri:layer:fuel:shell"]);
  });

  it("draws nothing when the rider turned the along-route pins off", () => {
    expect(rideMapInterestPoints(all, { filter: "off" })).toEqual([]);
    expect(
      rideMapInterestPoints(all, { filter: "off", selectedId: "ri:layer:fuel:shell" }).map((p) => p.id),
    ).toEqual(["ri:layer:fuel:shell"]);
  });
});
