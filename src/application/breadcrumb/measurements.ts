import type { ElevationProfile } from "@/application/elevation/profile";
import { lineDistance, toblerSeconds } from "@/domain/breadcrumb/route";
import type { BreadcrumbRoute } from "@/domain/breadcrumb/types";

/** A leg steeper than this is flagged on the map and in the card. */
export const STEEP_LEG_PERCENT = 30;
/** Past this the card says "Very steep". */
export const VERY_STEEP_PERCENT = 45;
/**
 * A grade is measured across at least this much horizontal distance. A DEM's
 * vertical error over a 30 m run reads as a wall on a rocky ridge, so a shorter
 * window would report noise as steepness. A leg shorter than the window has no
 * sustained stretch to find: it reports its own average grade instead.
 */
export const GRADE_WINDOW_METERS = 100;

type ProfilePoints = ElevationProfile["points"];

export function breadcrumbLine(route: BreadcrumbRoute) {
  return route.legs.flatMap((leg, index) => index === 0 ? [...leg.geometry] : leg.geometry.slice(1));
}

/** The elevation at an along-line distance, interpolated between profile samples. */
function heightAt(points: ProfilePoints, distance: number): number {
  const upper = points.findIndex((point) => point.distanceMeters >= distance);
  // Past the last sample the profile stops; it never wraps back to the start.
  if (upper < 0) return points[points.length - 1]!.elevationMeters;
  if (upper === 0) return points[0]!.elevationMeters;
  const before = points[upper - 1]!;
  const after = points[upper]!;
  const run = after.distanceMeters - before.distanceMeters;
  if (run <= 0) return after.elevationMeters;
  const fraction = (distance - before.distanceMeters) / run;
  return before.elevationMeters + (after.elevationMeters - before.elevationMeters) * fraction;
}

/** One measured grade, and the stretch of line it was measured over. */
interface WindowGrade {
  readonly from: number;
  readonly to: number;
  readonly percent: number;
}

/**
 * Grades over a sliding `GRADE_WINDOW_METERS` window, one per profile sample.
 *
 * The window ends on a sample and starts exactly one window earlier, with the
 * start elevation interpolated between samples: the same stretch of ground is
 * measured at every step, so a sawtooth DEM cannot swing the answer with the
 * sample spacing. Windows that would start before the line are skipped.
 */
function windowGrades(points: ProfilePoints): WindowGrade[] {
  const grades: WindowGrade[] = [];
  for (const to of points) {
    const from = to.distanceMeters - GRADE_WINDOW_METERS;
    if (from < 0) continue;
    grades.push({
      from,
      to: to.distanceMeters,
      percent: ((to.elevationMeters - heightAt(points, from)) / GRADE_WINDOW_METERS) * 100,
    });
  }
  return grades;
}

/**
 * The steepest sustained grade on one leg.
 *
 * A leg at least as long as the window takes the steepest window that sits
 * inside it. A shorter leg cannot hold a window, so it reports its average
 * grade end to end: one noisy step must not turn a short link into a wall.
 */
function legMaxGrade(
  distanceMeters: number,
  start: number,
  end: number,
  grades: readonly WindowGrade[],
  points: ProfilePoints,
): number | null {
  if (!(distanceMeters > 0) || end <= start) return null;
  const average = Math.abs((heightAt(points, end) - heightAt(points, start)) / distanceMeters) * 100;
  if (distanceMeters < GRADE_WINDOW_METERS || grades.length === 0) return average;
  const midpoint = (grade: WindowGrade): number => (grade.from + grade.to) / 2;
  const inside = grades.filter((grade) => midpoint(grade) >= start && midpoint(grade) <= end);
  const considered = inside.length > 0
    ? inside
    : grades.filter((grade) => Math.min(grade.to, end) > Math.max(grade.from, start));
  if (considered.length === 0) return average;
  return considered.reduce((steepest, grade) => Math.max(steepest, Math.abs(grade.percent)), 0);
}

export function breadcrumbMeasurements(route: BreadcrumbRoute, profile: ElevationProfile | null) {
  const lengths = route.legs.map((leg) => lineDistance(leg.geometry));
  const boundaries = lengths.reduce<number[]>((values, length) => [...values, values[values.length - 1]! + length], [0]);
  const legs = lengths.map((distanceMeters) => ({ distanceMeters, maxGradePercent: null as number | null, timeSeconds: null as number | null }));
  if (profile !== null && profile.points.length >= 2) {
    const points = profile.points;
    const grades = windowGrades(points);
    for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
      const leg = legs[legIndex]!;
      leg.maxGradePercent = legMaxGrade(leg.distanceMeters, boundaries[legIndex]!, boundaries[legIndex + 1]!, grades, points);
    }
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const run = to.distanceMeters - from.distanceMeters;
      if (run <= 0) continue;
      // Time keeps the local grade: Tobler's function is about the slope under
      // the foot, and a window would flatten a short rise into the descent after it.
      const midpoint = (from.distanceMeters + to.distanceMeters) / 2;
      const gradeStart = Math.max(0, midpoint - 15);
      const gradeEnd = Math.min(profile.totalMeters, midpoint + 15);
      const span = gradeEnd - gradeStart;
      if (span <= 0) continue;
      const localGrade = (heightAt(points, gradeEnd) - heightAt(points, gradeStart)) / span;
      for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
        const overlap = Math.max(0, Math.min(to.distanceMeters, boundaries[legIndex + 1]!) - Math.max(from.distanceMeters, boundaries[legIndex]!));
        if (overlap <= 0) continue;
        const leg = legs[legIndex]!;
        const seconds = toblerSeconds(overlap, localGrade);
        if (seconds !== null) leg.timeSeconds = (leg.timeSeconds ?? 0) + seconds;
      }
    }
  }
  return { totalMeters: boundaries.at(-1) ?? 0, legs, maxGradePercent: profile === null || legs.every((leg) => leg.maxGradePercent === null) ? null : Math.max(...legs.map((leg) => leg.maxGradePercent ?? 0)), timeSeconds: profile === null || legs.some((leg) => leg.timeSeconds === null) ? null : legs.reduce((sum, leg) => sum + leg.timeSeconds!, 0) };
}
