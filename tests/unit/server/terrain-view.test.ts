import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMapLayersCache, handleMapLayersRequest } from "@/server/map-layers/handler";
import { terrainProvider } from "@/server/map-layers/terrain";

vi.mock("@/infrastructure/elevation/terrarium-source", () => ({
  createTerrariumElevationSource: () => ({
    elevations: async (points: readonly { lon: number; lat: number }[]) => ({
      availability: "available", elevationsMeters: points.map((p) => 100 + (p.lon + 76) * 1000),
    }),
  }),
}));

beforeEach(clearMapLayersCache);
describe("terrain for the visible view", () => {
  it("returns a grid at desktop zoom 13 even when cache cells expand the view past 0.12 degrees", async () => {
    const answer = await handleMapLayersRequest(new URL("http://localhost/api/map-layers?layers=contours,slope&bbox=-76.01,40.61,-75.9,40.7"), { providers: [terrainProvider], env: {} });
    expect(answer.body).toMatchObject({ unavailable: [], terrainGrid: { size: 65 } });
  });
  it("bounds a regional view with a grid rather than silently refusing terrain", async () => {
    const answer = await handleMapLayersRequest(new URL("http://localhost/api/map-layers?layers=contours,slope&bbox=-76.5,40,-75,41"), { providers: [terrainProvider], env: {} });
    expect(answer.body).toMatchObject({ unavailable: [], terrainGrid: { size: 65 } });
  });
});
