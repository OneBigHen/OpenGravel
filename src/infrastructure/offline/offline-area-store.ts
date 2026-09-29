/**
 * An offline area is two downloads: the region's road graph (IndexedDB, for
 * planning with no signal) and its map archive (OPFS, for drawing it). This
 * store presents them as one area to Settings.
 */

import type {
  InstalledOfflineRegion,
  OfflineDownloadProgress,
  OfflineRegionOffer,
  OfflineRegionsPort,
} from "@/application/offline/offline-regions";

import { BasemapArchiveStore } from "./basemap-archive-store";
import { RegionDownloadStore } from "./region-download-store";

export class OfflineAreaStore implements OfflineRegionsPort {
  private lastOffers = new Map<string, OfflineRegionOffer>();

  constructor(
    private readonly graphs = new RegionDownloadStore(),
    private readonly maps: BasemapArchiveStore | null = BasemapArchiveStore.supported() ? new BasemapArchiveStore() : null,
  ) {}

  async offers(): Promise<OfflineRegionOffer[]> {
    const offers = await this.graphs.offers();
    this.lastOffers = new Map(offers.map((offer) => [offer.regionId, offer]));
    // A device that cannot store a map archive is offered the roads alone.
    if (this.maps !== null) return offers;
    return offers.map((offer) => {
      const roadsOnly: { -readonly [K in keyof OfflineRegionOffer]?: OfflineRegionOffer[K] } = { ...offer };
      delete roadsOnly.basemapBytes;
      return roadsOnly as OfflineRegionOffer;
    });
  }

  async installed(): Promise<InstalledOfflineRegion[]> {
    const [graphs, maps] = await Promise.all([this.graphs.installed(), this.maps?.installed() ?? []]);
    const mapBytes = new Map(maps.map((archive) => [archive.regionId, archive.file.size]));
    return graphs.map((region) => {
      const bytes = mapBytes.get(region.regionId);
      return bytes === undefined
        ? { ...region, mapOnDevice: false }
        : { ...region, byteSize: region.byteSize + bytes, mapOnDevice: true };
    });
  }

  async download(
    regionId: string,
    onProgress: (progress: OfflineDownloadProgress) => void,
    signal: AbortSignal,
  ): Promise<InstalledOfflineRegion> {
    const mapBytes = this.maps === null ? 0 : (this.lastOffers.get(regionId)?.basemapBytes ?? 0);
    let graphTotal = 0;
    const graph = await this.graphs.download(
      regionId,
      (progress) => {
        graphTotal = progress.totalBytes;
        onProgress({ completedBytes: progress.completedBytes, totalBytes: progress.totalBytes + mapBytes });
      },
      signal,
    );
    if (this.maps !== null && mapBytes > 0) {
      await this.maps.download(
        regionId,
        (progress) => onProgress({ completedBytes: graphTotal + progress.completedBytes, totalBytes: graphTotal + progress.totalBytes }),
        signal,
      );
      return { ...graph, byteSize: graph.byteSize + mapBytes, mapOnDevice: true };
    }
    return { ...graph, mapOnDevice: false };
  }

  async remove(regionId: string): Promise<void> {
    await Promise.all([this.graphs.remove(regionId), this.maps?.remove(regionId)]);
  }

  async storedBytes(): Promise<number> {
    const [graphs, maps] = await Promise.all([this.graphs.storedBytes(), this.maps?.storedBytes() ?? 0]);
    return graphs + maps;
  }

  close(): void {
    this.graphs.close();
  }
}
