import type { HikeRecord } from "../../../infra/trails/lib/types";
import type { Coordinate } from "@/domain/ride/types";
import type { ElevationProfile } from "@/application/elevation/profile";
import { haversine } from "@/domain/geometry/analysis";
import { toblerSeconds } from "@/domain/breadcrumb/route";

/** Hide short fragments and choose the longest nearby piece of each named trail. */
export function rankHikes(hikes: readonly HikeRecord[], origin: Coordinate): HikeRecord[] {
  const selected: HikeRecord[] = [];
  const named = new Map<string, HikeRecord[]>();
  for (const hike of [...hikes].filter((h) => h.lengthMeters >= 804.672).sort((a, b) => b.lengthMeters - a.lengthMeters)) {
    const key = hike.name?.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    if (key) {
      const group = named.get(key) ?? [];
      const nearby = group.some((other) => [other.start, other.end].some((a) => [hike.start, hike.end].some((b) => haversine(a, b) < 2000)));
      group.push(hike);
      named.set(key, group);
      if (nearby) continue;
    }
    selected.push(hike);
  }
  const score = (hike: HikeRecord) => haversine(origin, hike.start) / 1000 + 3 / Math.min(5, hike.lengthMeters / 1609.344);
  return selected.sort((a, b) => score(a) - score(b));
}

/** Tobler's function integrated over each signed grade in the sampled profile. */
export function profileTimeSeconds(profile: ElevationProfile): number {
  return profile.points.slice(1).reduce((total, point, index) => {
    const previous = profile.points[index]!;
    const distance = point.distanceMeters - previous.distanceMeters;
    return total + (distance > 0 ? (toblerSeconds(distance, (point.elevationMeters - previous.elevationMeters) / distance) ?? 0) : 0);
  }, 0);
}

export type HikeFilters = { readonly length: string; readonly gain: string; readonly time: string; readonly shape?: string; readonly waterfall?: boolean; readonly views?: boolean; readonly dogs: boolean; readonly kids: boolean };

/**
 * Whether a hike meets the filters: true, false, or "unknown" while its gain
 * or time still waits on a measured profile. Catalog facts decide first, so a
 * page of results is never spent on hikes the catalog already rules out.
 */
export function matchHikeFilters(hike: HikeRecord, filters: HikeFilters, profile?: ElevationProfile): boolean | "unknown" {
  if (filters.waterfall && !hike.featureKinds?.includes("waterfall")) return false;
  if (filters.views && !hike.featureKinds?.includes("viewpoint") && !hike.featureKinds?.includes("fire-tower") && !hike.featureKinds?.includes("observation-tower")) return false;
  if (filters.shape && hike.shape !== filters.shape) return false;
  if (filters.length && hike.lengthMeters > Number(filters.length) * 1609.344) return false;
  if (filters.dogs && hike.dog !== "yes" && hike.dog !== "leashed") return false;
  if (filters.kids && (hike.lengthMeters > 4828 || hike.sacScale !== "hiking")) return false;
  const gain = hike.elevationGainMeters ?? profile?.climbMeters ?? null;
  const seconds = hike.toblerMinutes != null ? hike.toblerMinutes * 60 : profile ? profileTimeSeconds(profile) : null;
  const gainLimit = filters.gain ? Number(filters.gain) / 3.28084 : filters.kids ? 152.4 : null;
  const timeLimit = filters.time ? Number(filters.time) * 3600 : null;
  if (gainLimit !== null && gain !== null && gain > gainLimit) return false;
  if (timeLimit !== null && seconds !== null && seconds > timeLimit) return false;
  if ((gainLimit !== null && gain === null) || (timeLimit !== null && seconds === null)) return "unknown";
  return true;
}
