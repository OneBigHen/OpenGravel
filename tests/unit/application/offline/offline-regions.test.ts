import { describe, expect, it } from "vitest";

import { formatBytes, offlineRegionRows, type OfflineRegionOffer } from "@/application/offline/offline-regions";

const BOUNDS = { minLon: -80, minLat: 39, maxLon: -74, maxLat: 42 };
const offer = (extra: Partial<OfflineRegionOffer> = {}): OfflineRegionOffer => ({
  regionId: "pennsylvania",
  regionName: "Pennsylvania",
  version: "v2",
  bounds: BOUNDS,
  tileCount: 258,
  tileByteTotal: 897_000_000,
  sourceDataDate: "2026-07-13T00:00:00Z",
  basemapBytes: 569_000_000,
  ...extra,
});
const installed = (extra = {}) => ({
  regionId: "pennsylvania",
  regionName: "Pennsylvania",
  version: "v2",
  bounds: BOUNDS,
  byteSize: 1_466_000_000,
  sourceDataDate: "2026-07-13T00:00:00Z",
  downloadedAt: "2026-09-26T00:00:00Z",
  mapOnDevice: true,
  ...extra,
});

describe("offlineRegionRows", () => {
  it("offers roads plus map as one download size", () => {
    expect(offlineRegionRows([offer()], [])).toEqual([
      expect.objectContaining({ state: "available", sizeLabel: "1.5 GB", dataLabel: "OSM data from Jul 13, 2026" }),
    ]);
  });

  it("is ready only with the current roads and the map on the device", () => {
    expect(offlineRegionRows([offer()], [installed()])[0]?.state).toBe("ready");
    expect(offlineRegionRows([offer()], [installed({ mapOnDevice: false })])[0]?.state).toBe("update");
    expect(offlineRegionRows([offer({ version: "v3" })], [installed()])[0]?.state).toBe("update");
    expect(offlineRegionRows([offer({ basemapBytes: undefined })], [installed({ mapOnDevice: false })])[0]?.state).toBe("ready");
  });

  it("keeps a downloaded area visible with no signal, or after the server stops offering it", () => {
    expect(offlineRegionRows(null, [installed()])[0]?.state).toBe("ready");
    expect(offlineRegionRows([], [installed()])[0]?.state).toBe("offline-only");
  });

  it("formats sizes plainly", () => {
    expect(formatBytes(262_715)).toBe("263 KB");
    expect(formatBytes(569_000_000)).toBe("569 MB");
  });
});
