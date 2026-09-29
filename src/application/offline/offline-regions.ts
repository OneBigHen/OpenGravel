/**
 * Offline areas (WORK-ORDER §2.3, Lane A1/A4): the regions a rider can
 * download so rides can be planned with no signal, and how each one reads in
 * Settings. The store behind the port lives in infrastructure; the UI sees
 * only this.
 */

import type { OfflineBounds } from "@/domain/offline/graph-tile";

/** A region the server offers. */
export interface OfflineRegionOffer {
  readonly regionId: string;
  readonly regionName: string;
  readonly version: string;
  readonly bounds: OfflineBounds;
  readonly tileCount: number;
  readonly tileByteTotal: number;
  readonly sourceDataDate: string;
  /** Size of the region's own map archive, when it has one. */
  readonly basemapBytes?: number;
}

/** A region stored on this device, fully verified. */
export interface InstalledOfflineRegion {
  readonly regionId: string;
  readonly regionName: string;
  readonly version: string;
  readonly bounds: OfflineBounds;
  readonly byteSize: number;
  readonly sourceDataDate: string;
  readonly downloadedAt: string;
  /** True when the region's map archive is on the device too, not just its roads. */
  readonly mapOnDevice?: boolean;
}

export interface OfflineDownloadProgress {
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface OfflineRegionsPort {
  /** What the server offers; rejects when it cannot be reached. */
  offers(): Promise<OfflineRegionOffer[]>;
  installed(): Promise<InstalledOfflineRegion[]>;
  /** Downloads, resumes or updates one region; abort to pause. */
  download(regionId: string, onProgress: (progress: OfflineDownloadProgress) => void, signal: AbortSignal): Promise<InstalledOfflineRegion>;
  remove(regionId: string): Promise<void>;
  storedBytes(): Promise<number>;
}

export type OfflineRegionRowState = "available" | "ready" | "update" | "offline-only";

export interface OfflineRegionRow {
  readonly regionId: string;
  readonly name: string;
  readonly state: OfflineRegionRowState;
  /** "212 MB" — the download size, or the size on the device once installed. */
  readonly sizeLabel: string;
  /** "OSM data from Jul 13, 2026". */
  readonly dataLabel: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function dataLabel(sourceDataDate: string): string {
  const date = new Date(sourceDataDate);
  if (Number.isNaN(date.getTime())) return "OSM data, date unknown";
  return `OSM data from ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

/**
 * One row per region, offered or installed. A region the server no longer
 * offers (or that could not be checked) stays listed as installed, so the
 * rider can still see and remove it.
 */
export function offlineRegionRows(
  offers: readonly OfflineRegionOffer[] | null,
  installed: readonly InstalledOfflineRegion[],
): OfflineRegionRow[] {
  const byId = new Map(installed.map((region) => [region.regionId, region]));
  const rows: OfflineRegionRow[] = [];
  for (const offer of offers ?? []) {
    const local = byId.get(offer.regionId);
    byId.delete(offer.regionId);
    const mapMissing = offer.basemapBytes !== undefined && local?.mapOnDevice !== true;
    rows.push({
      regionId: offer.regionId,
      name: offer.regionName,
      state: local === undefined ? "available" : local.version === offer.version && !mapMissing ? "ready" : "update",
      sizeLabel: formatBytes(local === undefined ? offer.tileByteTotal + (offer.basemapBytes ?? 0) : local.byteSize),
      dataLabel: dataLabel((local ?? offer).sourceDataDate),
    });
  }
  for (const local of byId.values()) {
    rows.push({
      regionId: local.regionId,
      name: local.regionName,
      state: offers === null ? "ready" : "offline-only",
      sizeLabel: formatBytes(local.byteSize),
      dataLabel: dataLabel(local.sourceDataDate),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
