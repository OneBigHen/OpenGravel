import type { ElevationProfile } from "@/application/elevation/profile";
import { lineDistance, toblerSeconds } from "@/domain/breadcrumb/route";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";

export function breadcrumbLine(route: BreadcrumbRoute) {
  return route.legs.flatMap((leg, index) => index === 0 ? [...leg.geometry] : leg.geometry.slice(1));
}

export function breadcrumbMeasurements(route: BreadcrumbRoute, profile: ElevationProfile | null) {
  const lengths = route.legs.map((leg) => lineDistance(leg.geometry));
  const boundaries = lengths.reduce<number[]>((values, length) => [...values, values[values.length - 1]! + length], [0]);
  const legs = lengths.map((distanceMeters) => ({ distanceMeters, maxGradePercent: null as number | null, timeSeconds: null as number | null }));
  if (profile !== null) {
    for (let index = 1; index < profile.points.length; index += 1) {
      const from = profile.points[index - 1]!;
      const to = profile.points[index]!;
      const run = to.distanceMeters - from.distanceMeters;
      if (run <= 0) continue;
      const grade = (to.elevationMeters - from.elevationMeters) / run;
      for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
        const overlap = Math.max(0, Math.min(to.distanceMeters, boundaries[legIndex + 1]!) - Math.max(from.distanceMeters, boundaries[legIndex]!));
        if (overlap <= 0) continue;
        const leg = legs[legIndex]!;
        leg.maxGradePercent = Math.max(leg.maxGradePercent ?? 0, Math.abs(grade) * 100);
        const seconds = toblerSeconds(overlap, grade);
        if (seconds !== null) leg.timeSeconds = (leg.timeSeconds ?? 0) + seconds;
      }
    }
  }
  return { totalMeters: boundaries.at(-1) ?? 0, legs, maxGradePercent: profile === null || legs.every((leg) => leg.maxGradePercent === null) ? null : Math.max(...legs.map((leg) => leg.maxGradePercent ?? 0)), timeSeconds: profile === null || legs.some((leg) => leg.timeSeconds === null) ? null : legs.reduce((sum, leg) => sum + leg.timeSeconds!, 0) };
}
