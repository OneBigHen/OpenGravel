import { describe, expect, it } from "vitest";
import { terrainContourInterval, terrainFeatures } from "@/application/map-layers/terrain";
import { terrainProvider } from "@/server/map-layers/terrain";

const bounds = { west: 0, south: 0, east: 0.001, north: 0.001 };
describe("DEM derivatives", () => {
  it("interpolates 20 m contours and measures gradient on a planar grid", () => {
    const features = terrainFeatures({ bounds, size: 2, heights: [0, 40, 0, 40] }, ["contours", "slope"]);
    const contour = features.find((feature) => feature.name === "20 m contour");
    expect(contour?.geometry).toMatchObject({ type: "LineString" });
    if (contour?.geometry.type !== "LineString") throw new Error("missing contour");
    expect(contour.geometry.coordinates.every((point) => point[0] === 0.0005)).toBe(true);
    expect(features.find((feature) => feature.layerId === "slope")?.weight).toBeCloseTo(35.97, 1);
  });
  it("rejects incomplete or nonfinite elevation rather than drawing flat land", () => {
    expect(() => terrainFeatures({ bounds, size: 2, heights: [0, NaN, 0, 0] }, ["slope"])).toThrow();
    expect(() => terrainFeatures({ bounds, size: 2, heights: [] }, ["contours"])).toThrow();
  });
  it("refuses a broad view before fetching an unbounded number of tiles", async () => {
    await expect(terrainProvider.snapshot!({ ...bounds, east: 2 }, ["contours"], { fetch, env: {} })).rejects.toThrow("Zoom in");
  });
});

it("uses legible contour intervals for the regional grid and 20 m for close views", () => {
  expect(terrainContourInterval({ bounds, size: 65, heights: [] })).toBe(20);
  expect(terrainContourInterval({ bounds: { west: -76.5, south: 40, east: -75, north: 41 }, size: 65, heights: [] })).toBe(160);
});
