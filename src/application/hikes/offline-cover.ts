import type { OfflineBounds } from "@/domain/offline/graph-tile";

/** True when `outer` contains the whole trail box `[minLon, minLat, maxLon, maxLat]`. */
export function coversTrail(outer: OfflineBounds, bbox: readonly [number, number, number, number]): boolean {
  return outer.minLon <= bbox[0] && outer.minLat <= bbox[1] && outer.maxLon >= bbox[2] && outer.maxLat >= bbox[3];
}

/** The first region (installed or offered) whose map covers the trail, smallest first. */
export function coveringRegion<T extends { readonly bounds: OfflineBounds }>(regions: readonly T[], bbox: readonly [number, number, number, number]): T | null {
  const area = (b: OfflineBounds) => (b.maxLon - b.minLon) * (b.maxLat - b.minLat);
  return [...regions].filter((region) => coversTrail(region.bounds, bbox)).sort((a, b) => area(a.bounds) - area(b.bounds))[0] ?? null;
}
