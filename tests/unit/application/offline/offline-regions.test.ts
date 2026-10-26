import { describe, expect, it } from "vitest";

import {
  downloadFailureMessage,
  downloadPercent,
  downloadProgressLabel,
  formatBytes,
  offlineRegionRows,
  type OfflineRegionOffer,
} from "@/application/offline/offline-regions";

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
  it("offers roads plus map as one size", () => {
    expect(offlineRegionRows([offer()], [])).toEqual([
      expect.objectContaining({
        state: "available",
        onDevice: false,
        sizeBytes: 1_466_000_000,
        sizeLabel: "1.5 GB",
        downloadBytes: 1_466_000_000,
        updatedLabel: null,
      }),
    ]);
  });

  it("reads as saved only with the current roads and the map on the device", () => {
    const ready = offlineRegionRows([offer()], [installed()])[0];
    expect(ready?.state).toBe("ready");
    expect(ready?.onDevice).toBe(true);
    expect(ready?.downloadBytes).toBe(0);
    expect(ready?.updatedLabel).toBe("Updated Sep 26, 2026");
    expect(offlineRegionRows([offer()], [installed({ mapOnDevice: false })])[0]?.state).toBe("update");
    expect(offlineRegionRows([offer({ version: "v3" })], [installed()])[0]?.state).toBe("update");
    expect(offlineRegionRows([offer({ basemapBytes: undefined })], [installed({ mapOnDevice: false })])[0]?.state).toBe("ready");
  });

  it("shows what an update would download without losing the size already on the device", () => {
    const row = offlineRegionRows([offer({ version: "v3", tileByteTotal: 900_000_000 })], [installed()])[0];
    expect(row?.sizeLabel).toBe("1.5 GB");
    expect(row?.downloadBytes).toBe(1_469_000_000);
  });

  it("keeps a downloaded area visible with no signal, or after the server stops offering it", () => {
    expect(offlineRegionRows(null, [installed()])[0]?.state).toBe("ready");
    expect(offlineRegionRows([], [installed()])[0]?.state).toBe("offline-only");
    expect(offlineRegionRows([], [installed()])[0]?.onDevice).toBe(true);
  });

  it("never borrows a date it cannot read", () => {
    expect(offlineRegionRows([offer()], [installed({ downloadedAt: "not a date" })])[0]?.updatedLabel).toBeNull();
    expect(offlineRegionRows([offer()], [installed({ downloadedAt: "" })])[0]?.updatedLabel).toBeNull();
  });

  it("formats sizes plainly", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(262_715)).toBe("263 KB");
    expect(formatBytes(569_000_000)).toBe("569 MB");
    expect(formatBytes(1_466_000_000)).toBe("1.5 GB");
  });
});

describe("download progress in words", () => {
  it("reads as a size done out of the size announced", () => {
    expect(downloadProgressLabel({ completedBytes: 540_000_000, totalBytes: 1_466_000_000 }, 1_466_000_000))
      .toBe("540 MB of 1.5 GB");
    expect(downloadPercent({ completedBytes: 540_000_000, totalBytes: 1_466_000_000 }, 1_466_000_000)).toBe(36);
  });

  it("falls back to the announced size before the first progress report", () => {
    expect(downloadProgressLabel({ completedBytes: 0, totalBytes: 0 }, 2_000_000)).toBe("0 KB of 2 MB");
    expect(downloadPercent({ completedBytes: 0, totalBytes: 0 }, 2_000_000)).toBe(0);
  });

  it("stops at 100 and says nothing it does not know", () => {
    expect(downloadPercent({ completedBytes: 3_000_000, totalBytes: 2_000_000 }, 2_000_000)).toBe(100);
    expect(downloadPercent({ completedBytes: 0, totalBytes: 0 }, 0)).toBe(0);
    expect(downloadProgressLabel({ completedBytes: 0, totalBytes: 0 }, 0)).toBe("Starting…");
  });
});

describe("downloadFailureMessage", () => {
  it("tells the rider to free up space when the device ran out", () => {
    expect(downloadFailureMessage("Pennsylvania", new Error("There is not enough storage on this device for this area.")))
      .toBe("Pennsylvania does not fit on this device. Free up space, then try again.");
  });

  it("keeps HTTP status codes and inner names out of the sentence", () => {
    expect(downloadFailureMessage("Pennsylvania", new Error("Part of the area failed to download (404).")))
      .toBe("Pennsylvania did not finish. Check your signal and try again.");
    expect(downloadFailureMessage("Pennsylvania", "boom"))
      .toBe("Pennsylvania did not finish. Check your signal and try again.");
  });
});
