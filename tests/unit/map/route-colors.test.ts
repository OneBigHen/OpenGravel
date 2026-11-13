import { describe, expect, it } from "vitest";
import { ALTERNATIVE_COLORS, alternativeColorIndex, alternativeRouteColor, alternativeTintMatch } from "@/application/map/route-colors";
import { routeTagText } from "@/application/map/build-map-scene";

describe("Compare speaks one language (PF-8)", () => {
  it("maps tint to the same colour slot the map expression paints", () => {
    expect([1, 2, 3, 4, 5, 6].map(alternativeColorIndex)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(alternativeRouteColor(1)).toBe(ALTERNATIVE_COLORS[0]);
    expect(alternativeRouteColor(undefined)).toBe(ALTERNATIVE_COLORS[0]);
    expect(alternativeTintMatch(["a", "b", "c"])).toEqual(["match", ["%", ["coalesce", ["get", "tint"], 1], 3], 1, "a", 2, "b", "c"]);
  });
  it("tags say the sheet's name and the difference", () => {
    expect(routeTagText("Twistiest", 39 * 60, null)).toBe("Twistiest · 39 min");
    expect(routeTagText("Option 2", 49 * 60, 39 * 60)).toBe("Option 2 · +10 min");
  });
});
