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

/** One area as a rider sees it: either saved on this device or offered. */
export interface OfflineRegionRow {
  readonly regionId: string;
  readonly name: string;
  readonly state: OfflineRegionRowState;
  /** True once this device holds a complete, verified copy of the area. */
  readonly onDevice: boolean;
  /** The size the rider reads: what it takes on the device once saved, else the download. */
  readonly sizeBytes: number;
  /** "1.5 GB" — `sizeBytes` in words. */
  readonly sizeLabel: string;
  /** What the next download fetches; 0 when the saved copy is current. */
  readonly downloadBytes: number;
  /** "Updated Oct 1, 2026" from the saved copy; null when there is none or its date is unreadable. */
  readonly updatedLabel: string | null;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * When this device last saved the area. An unreadable timestamp stays null
 * rather than borrowing today's date, which would read as fresher than it is.
 */
function updatedLabel(downloadedAt: string | undefined): string | null {
  if (downloadedAt === undefined) return null;
  const date = new Date(downloadedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Updated ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

function offerBytes(offer: OfflineRegionOffer): number {
  return offer.tileByteTotal + (offer.basemapBytes ?? 0);
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
    const current = local !== undefined && local.version === offer.version && !mapMissing;
    rows.push({
      regionId: offer.regionId,
      name: offer.regionName,
      state: local === undefined ? "available" : current ? "ready" : "update",
      onDevice: local !== undefined,
      sizeBytes: local === undefined ? offerBytes(offer) : local.byteSize,
      sizeLabel: formatBytes(local === undefined ? offerBytes(offer) : local.byteSize),
      downloadBytes: current ? 0 : offerBytes(offer),
      updatedLabel: updatedLabel(local?.downloadedAt),
    });
  }
  for (const local of byId.values()) {
    rows.push({
      regionId: local.regionId,
      name: local.regionName,
      state: offers === null ? "ready" : "offline-only",
      onDevice: true,
      sizeBytes: local.byteSize,
      sizeLabel: formatBytes(local.byteSize),
      downloadBytes: 0,
      updatedLabel: updatedLabel(local.downloadedAt),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function totalBytesFor(progress: OfflineDownloadProgress, expectedBytes: number): number {
  return progress.totalBytes > 0 ? progress.totalBytes : expectedBytes;
}

/** "540 MB of 1.5 GB" — how much of the area is on the device already. */
export function downloadProgressLabel(progress: OfflineDownloadProgress, expectedBytes: number): string {
  const total = totalBytesFor(progress, expectedBytes);
  if (total <= 0) return "Starting…";
  const done = Math.max(0, Math.min(progress.completedBytes, total));
  return `${formatBytes(done)} of ${formatBytes(total)}`;
}

/** Whole percent, clamped: a bar never reads over 100 before the download ends. */
export function downloadPercent(progress: OfflineDownloadProgress, expectedBytes: number): number {
  const total = totalBytesFor(progress, expectedBytes);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((progress.completedBytes / total) * 100)));
}

/**
 * What the rider reads when a download stops short. The stores' own messages
 * are honest but can carry HTTP status codes and inner names, so the section
 * asks for a plain sentence instead. Running out of room is the one case where
 * "try again" is the wrong advice.
 */
export function downloadFailureMessage(name: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/storage|quota|space/i.test(detail)) {
    return `${name} does not fit on this device. Free up space, then try again.`;
  }
  return `${name} did not finish. Check your signal and try again.`;
}
