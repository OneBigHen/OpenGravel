import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { BreadcrumbRoute, BreadcrumbWaypoint } from "./types";

/** A locally constructed route. No graph or network is consulted. */
export function straightBreadcrumb(waypoints: readonly BreadcrumbWaypoint[]): BreadcrumbRoute {
  return {
    waypoints: waypoints.map((point) => ({ ...point, coordinate: { ...point.coordinate } })),
    legs: waypoints.slice(1).map((point, index) => ({
      kind: "straight",
      geometry: [{ ...waypoints[index]!.coordinate }, { ...point.coordinate }],
    })),
  };
}

export function reverseBreadcrumb(route: BreadcrumbRoute): BreadcrumbRoute {
  return {
    waypoints: [...route.waypoints].reverse(),
    legs: [...route.legs].reverse().map((leg) => ({ ...leg, geometry: [...leg.geometry].reverse() })),
  };
}

export function lineDistance(line: readonly Coordinate[]): number {
  return line.slice(1).reduce((sum, point, index) => sum + haversine(line[index]!, point), 0);
}

/** Tobler's walking function, km/h, with signed rise / horizontal run. */
export function toblerSeconds(distanceMeters: number, grade: number): number | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(grade)) return null;
  const speed = 6 * Math.exp(-3.5 * Math.abs(grade + 0.05));
  return speed > 0 ? distanceMeters / (speed * 1000 / 3600) : null;
}

export interface LegMeasurement {
  readonly distanceMeters: number;
  readonly gradePercent: number | null;
  readonly steep: boolean | null;
  readonly timeSeconds: number | null;
}

/** Missing elevation is unknown, including the grade, steep flag and time. */
export function measureLeg(line: readonly Coordinate[], startElevation: number | null, endElevation: number | null): LegMeasurement {
  const distanceMeters = lineDistance(line);
  if (startElevation === null || endElevation === null || !Number.isFinite(startElevation) || !Number.isFinite(endElevation) || distanceMeters <= 0) {
    return { distanceMeters, gradePercent: null, steep: null, timeSeconds: null };
  }
  const grade = (endElevation - startElevation) / distanceMeters;
  return { distanceMeters, gradePercent: grade * 100, steep: Math.abs(grade) > 0.3, timeSeconds: toblerSeconds(distanceMeters, grade) };
}

/** Initial compass bearing in degrees clockwise from north. */
export function bearingTo(from: Coordinate, to: Coordinate): number {
  const radians = Math.PI / 180;
  const a = from.lat * radians;
  const b = to.lat * radians;
  const delta = (to.lon - from.lon) * radians;
  return (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / radians + 360) % 360;
}

/** Check persisted and command data before accepting it as a route. */
export function breadcrumbIssues(route: BreadcrumbRoute): string[] {
  const issues: string[] = [];
  if (!Array.isArray(route.waypoints) || !Array.isArray(route.legs)) return ["Breadcrumb needs waypoints and legs."];
  if (route.legs.length !== Math.max(0, route.waypoints.length - 1)) issues.push("Each pair of waypoints needs one leg.");
  const ids = new Set<string>();
  const validCoordinate = (point: Coordinate | undefined): boolean => point != null && typeof point === "object" && Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
  route.waypoints.forEach((point) => {
    if (!point || typeof point.id !== "string" || point.id.trim() === "" || ids.has(point.id)) issues.push("Waypoint IDs must be unique and non-empty.");
    else ids.add(point.id);
    if (!point || !validCoordinate(point.coordinate)) issues.push("Waypoint coordinates are invalid.");
    if (point?.name !== undefined && typeof point.name !== "string") issues.push("Waypoint names must be text.");
  });
  route.legs.forEach((leg, index) => {
    if (!leg || (leg.kind !== "straight" && leg.kind !== "snapped" && leg.kind !== "recorded") || !Array.isArray(leg.geometry) || leg.geometry.length < 2 || !leg.geometry.every(validCoordinate)) {
      issues.push("Leg geometry is invalid.");
      return;
    }
    const first = leg.geometry[0]!;
    const last = leg.geometry[leg.geometry.length - 1]!;
    const start = route.waypoints[index]?.coordinate;
    const end = route.waypoints[index + 1]?.coordinate;
    if (!start || !end || first.lat !== start.lat || first.lon !== start.lon || last.lat !== end.lat || last.lon !== end.lon) issues.push("Leg endpoints must match their waypoints.");
    if (leg.kind === "straight" && leg.geometry.length !== 2) issues.push("Straight legs have exactly two points.");
  });
  return issues;
}
