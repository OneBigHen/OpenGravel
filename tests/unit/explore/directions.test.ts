import { describe, expect, it } from "vitest";

import {
  directionsActionLabel,
  directionsToPlaceUrl,
} from "@/application/explore/directions";

describe("a trail area's way to the trailhead", () => {
  it("names the action by how exact the source's place is", () => {
    expect(directionsActionLabel("start")).toBe("Ride to the trailhead");
    expect(directionsActionLabel("area")).toBe("Directions to the area");
    expect(directionsActionLabel("town")).toBe("Directions to the town");
  });

  it("hands the source's point to the device's maps app", () => {
    expect(directionsToPlaceUrl({ lat: 46.09, lon: -88.31 }, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(
      "https://maps.apple.com/?daddr=46.090000,-88.310000&dirflg=d",
    );
    expect(directionsToPlaceUrl({ lat: 46.09, lon: -88.31 }, "Mozilla/5.0 (X11; Linux x86_64)")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=46.090000,-88.310000",
    );
    expect(directionsToPlaceUrl({ lat: 46.09, lon: -88.31 })).toContain("google.com/maps/dir");
  });
});
