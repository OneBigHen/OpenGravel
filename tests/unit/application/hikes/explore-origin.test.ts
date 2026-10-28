import { afterEach, describe, expect, it } from "vitest";
import { readExploreOrigin, saveExploreOrigin } from "@/application/map/explore-origin";

describe("hike map origin", () => {
  afterEach(() => sessionStorage.clear());
  it("restores the last map center and rejects malformed positions", () => {
    saveExploreOrigin({ lat: 40.86, lon: -75.74 });
    expect(readExploreOrigin()).toEqual({ lat: 40.86, lon: -75.74 });
    sessionStorage.setItem("opengravel.hike.explore-origin", JSON.stringify({ lat: 100, lon: -75 }));
    expect(readExploreOrigin()).toBeNull();
  });
});
