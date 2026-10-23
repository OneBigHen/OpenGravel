import { describe, expect, it, vi } from "vitest";

import type {
  InstalledOfflineRegion,
  OfflineDownloadProgress,
} from "@/application/offline/offline-regions";
import { OfflineAreaStore } from "@/infrastructure/offline/offline-area-store";
import type { BasemapArchiveStore } from "@/infrastructure/offline/basemap-archive-store";
import type { RegionDownloadStore } from "@/infrastructure/offline/region-download-store";

const OFFER = {
  regionId: "pennsylvania",
  regionName: "Pennsylvania",
  version: "v1",
  bounds: { minLon: -80, minLat: 39, maxLon: -74, maxLat: 42 },
  tileCount: 258,
  tileByteTotal: 897_000_000,
  sourceDataDate: "2026-07-13T00:00:00Z",
  basemapBytes: 569_000_000,
};

const INSTALLED = {
  regionId: "pennsylvania",
  regionName: "Pennsylvania",
  version: "v1",
  bounds: OFFER.bounds,
  byteSize: 897_000_000,
  sourceDataDate: OFFER.sourceDataDate,
  downloadedAt: "2026-09-26T00:00:00Z",
};

function doubles() {
  const graphs = {
    offers: vi.fn(async () => [OFFER]),
    download: vi.fn<(
      regionId: string,
      onProgress: (progress: OfflineDownloadProgress) => void,
      signal?: AbortSignal,
      extraRequiredBytes?: number,
    ) => Promise<InstalledOfflineRegion>>(async () => INSTALLED),
    installed: vi.fn(async () => []),
    storedBytes: vi.fn(async () => 0),
    remove: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const maps = {
    download: vi.fn(async () => undefined),
    installed: vi.fn(async () => []),
    storedBytes: vi.fn(async () => 0),
    remove: vi.fn(async () => undefined),
  };
  return { graphs, maps };
}

describe("OfflineAreaStore — one area, one storage budget", () => {
  it("tells the graph half to reserve room for the area's map archive too", async () => {
    const { graphs, maps } = doubles();
    const area = new OfflineAreaStore(
      graphs as unknown as RegionDownloadStore,
      maps as unknown as BasemapArchiveStore,
    );
    await area.offers();

    await area.download("pennsylvania", () => undefined, new AbortController().signal);

    // The archive is the larger half of an area; a quota check that counts only
    // the road tiles is a download that will fail after the rider waits.
    expect(graphs.download.mock.calls[0]?.[3]).toBe(OFFER.basemapBytes);
    expect(maps.download).toHaveBeenCalledTimes(1);
  });
});
