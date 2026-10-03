import { describe, expect, it, vi } from "vitest";
import { parsePadUs, publicLandProvider } from "@/server/map-layers/public-land";
const ring = [[-76, 40], [-75, 40], [-75, 41], [-76, 40]];
describe("PAD-US polygons", () => {
  it("preserves holes and splits multipolygons while retaining source/access semantics", () => {
    const features = parsePadUs({ type: "FeatureCollection", features: [{ id: 1, properties: { Unit_Nm: "State Forest", Pub_Access: "OA", MngNm_Desc: "State", Category: "Fee" }, geometry: { type: "MultiPolygon", coordinates: [[ring, ring], [ring]] } }] });
    expect(features).toHaveLength(2);
    expect(features[0]?.geometry).toMatchObject({ type: "Polygon", coordinates: [ring, ring] });
    expect(features[0]?.detail).toContain("not motorized access");
    expect(features[0]?.detail).toContain("USGS PAD-US");
  });
  it("rejects upstream errors and truncated collections", () => {
    expect(() => parsePadUs({ error: { code: 500 } })).toThrow();
    expect(() => parsePadUs({ features: [], exceededTransferLimit: true })).toThrow();
  });
  it("identifies OSM fallback and leaves PAD-US unavailable", async () => {
    const result = await publicLandProvider.snapshot!({ west: -76, south: 40, east: -75, north: 41 }, ["public-land"], {
      env: {}, fetch: async (input) => String(input).includes("arcgis") ? new Response("{}", { status: 503 }) : Response.json({ elements: [] }),
    });
    expect(result.unavailable).toBe(true);
    expect(result.freshness?.[0]?.source).toContain("OpenStreetMap");
  });
  it("finishes bounded ArcGIS pagination before presenting primary boundaries", async () => {
    const feature = { id: 1, properties: { Unit_Nm: "Forest", Pub_Access: "OA" }, geometry: { type: "Polygon", coordinates: [ring] } };
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const offset = new URL(String(input)).searchParams.get("resultOffset");
      return Response.json(offset === "0" ? { features: [feature], properties: { exceededTransferLimit: true } } : { features: [{ ...feature, id: 2 }] });
    });
    const snapshot = await publicLandProvider.snapshot!({ west: -76, south: 40, east: -75, north: 41 }, ["public-land"], { fetch: fetcher, env: {} });
    expect(snapshot.unavailable).not.toBe(true);
    expect(snapshot.features).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

});
