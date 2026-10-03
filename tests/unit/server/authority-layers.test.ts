import { describe, expect, it } from "vitest";
import type { SourceOutcome } from "@/application/route-intelligence/coordinator";
import { projectAuthority, authorityProvider } from "@/server/map-layers/authority";
const now = "2026-10-03T18:00:00.000Z";
const outcome: SourceOutcome = {
  info: { id: "usfs-mvum", label: "USFS MVUM", family: "road-authority", facet: "access", authority: "authoritative-regulatory", coverage: [], precedence: 0 },
  snapshot: { status: "stale", fetchedAt: "2026-10-01T18:00:00.000Z", reason: "refresh failed", covered: [], records: [{ sourceId: "usfs-mvum", sourceRecordId: "a", kind: "motor-vehicle-designation", geometry: { type: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -75.1, lat: 40.1 }] }, roadName: "Forest Road 12", description: "MVUM road", validFrom: null, validUntil: null, motorcycleAccess: { status: "open", seasons: [] } }] },
};
describe("canonical authority map projection", () => {
  it("preserves normalized geometry, identity, unknown seasonal dates and stale retrieval", () => {
    const [feature] = projectAuthority([outcome], ["mvum"], now);
    expect(feature?.id).toBe("authority:usfs-mvum:a");
    expect(feature?.detail).toContain("season dates unknown");
    expect(feature?.detail).toContain("stale");
    expect(feature?.weight).toBe(0.5);
    expect(feature?.geometry).toMatchObject({ type: "LineString", coordinates: [[-75, 40], [-75.1, 40.1]] });
  });
  it("filters expired WZDx and does not reinterpret work zones as closures", () => {
    const records = [
      { ...outcome.snapshot.records[0]!, kind: "work-zone" as const, validUntil: "2026-10-01T00:00:00Z" },
      { ...outcome.snapshot.records[0]!, sourceRecordId: "b", kind: "work-zone" as const, motorcycleAccess: undefined },
    ];
    const source = { ...outcome, info: { ...outcome.info, facet: "closures" as const }, snapshot: { ...outcome.snapshot, records } };
    const features = projectAuthority([source], ["work-zones"], now);
    expect(features).toHaveLength(1);
    expect(features[0]?.name).toContain("Work zone");
  });
  it("fails unavailable when the canonical routing authority is disabled", async () => {
    await expect(authorityProvider.snapshot!({ west: -76, south: 40, east: -75, north: 41 }, ["mvum"], { env: {}, fetch })).rejects.toThrow();
  });
});
it("clips canonical line projections to the served map view including crossing segments", () => {
  const view = { west: -75.05, south: 40.02, east: -75.02, north: 40.05 };
  const features = projectAuthority([outcome], ["mvum"], now, view);
  expect(features).toHaveLength(1);
  const geometry = features[0]?.geometry;
  if (geometry?.type !== "LineString") throw new Error("expected clipped line");
  for (const [lon, lat] of geometry.coordinates) {
    expect(lon).toBeGreaterThanOrEqual(view.west);
    expect(lon).toBeLessThanOrEqual(view.east);
    expect(lat).toBeGreaterThanOrEqual(view.south);
    expect(lat).toBeLessThanOrEqual(view.north);
  }
});
