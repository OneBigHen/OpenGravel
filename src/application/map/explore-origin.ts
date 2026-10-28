import type { Coordinate } from "@/domain/ride/types";
export const HIKE_EXPLORE_ORIGIN_KEY = "opengravel.hike.explore-origin";
export function saveExploreOrigin(point: Coordinate): void {
  try { sessionStorage.setItem(HIKE_EXPLORE_ORIGIN_KEY, JSON.stringify(point)); } catch { /* Storage is optional. */ }
}
export function readExploreOrigin(): Coordinate | null {
  try {
    const point: unknown = JSON.parse(sessionStorage.getItem(HIKE_EXPLORE_ORIGIN_KEY) ?? "null");
    if (!point || typeof point !== "object") return null;
    const { lon, lat } = point as Record<string, unknown>;
    return typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180 && typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 ? { lon, lat } : null;
  } catch { return null; }
}
