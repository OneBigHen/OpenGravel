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
