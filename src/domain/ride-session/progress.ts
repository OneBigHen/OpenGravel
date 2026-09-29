/**
 * Pure route-progress matching for the RideSession navigation engine
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §5–§7, §9).
 *
 * A match is a continuity decision, not a nearest-point lookup. Proximity,
 * heading, elapsed movement, prior progress and route order all contribute to
 * the score. This is what keeps a noisy fix from teleporting a ride across a
 * parallel road or to the return side of a hairpin.
 */

import { haversine } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";
import type { StopId } from "../ride/ids";
import type { SessionInstructionId } from "./ids";
import type {
  PositionFix,
  SessionInstruction,
  SessionOffRouteState,
} from "./types";

const EARTH_RADIUS_METERS = 6_371_000;
const MIN_OFF_ROUTE_METERS = 35;
const OFF_ROUTE_FIXES_REQUIRED = 3;
const MANEUVER_PASS_METERS = 20;
const AMBIGUOUS_ROUTE_SEPARATION_METERS = 100;
const AMBIGUOUS_SCORE_MARGIN = 30;
const SPATIAL_CELL_DEGREES = 0.001;
const SPATIAL_MATCH_RADIUS_CELLS = 2;
const MAX_INDEX_CELLS_PER_SEGMENT = 256;
const CONTINUITY_SEGMENT_WINDOW = 160;
/**
 * Past this gap the previous frame says nothing about where the rider is now:
 * a ride paused at the start and resumed halfway round must match where the
 * rider is, not be pulled back toward where they stopped.
 */
const CONTINUITY_MAX_GAP_MS = 120_000;

export type OffRouteState = SessionOffRouteState;

export class InvalidProgressRouteError extends Error {
  constructor() {
    super("the resolved navigation route has no continuous usable geometry");
    this.name = "InvalidProgressRouteError";
  }
}

/** One provider-supplied maneuver placed on the resolved route line. */
export interface RouteManeuver {
  readonly instructionId: SessionInstructionId;
  readonly kind: SessionInstruction["kind"];
  readonly maneuver: SessionInstruction["maneuver"];
  readonly roadName: string | null;
  readonly targetStopId: StopId | null;
  readonly atDistanceMeters: number;
}

/** Resolved route data. Track mode may carry maneuvers, but never emits them. */
export interface ProgressRoute {
  readonly mode: "guided" | "track";
  readonly geometry: readonly Coordinate[];
  readonly maneuvers?: readonly RouteManeuver[];
}

interface ProgressSegment {
  readonly index: number;
  readonly start: Coordinate;
  readonly finish: Coordinate;
  readonly startDistanceMeters: number;
  readonly lengthMeters: number;
  readonly bearingDegrees: number;
}

export interface ProgressModel {
  readonly mode: ProgressRoute["mode"];
  readonly geometry: readonly Coordinate[];
  readonly segments: readonly ProgressSegment[];
  readonly totalDistanceMeters: number;
  readonly maneuvers: readonly RouteManeuver[];
  readonly spatialIndex: ReadonlyMap<string, readonly number[]>;
  readonly unindexedSegmentIndices: readonly number[];
}

export interface ProgressFrame {
  readonly rawPosition: Coordinate;
  readonly onRoutePosition: Coordinate;
  readonly observedAt: string;
  readonly segmentIndex: number;
  readonly segmentFraction: number;
  readonly routeBearingDegrees: number | null;
  readonly distanceFromRouteMeters: number;
  readonly distanceAlongMeters: number;
  readonly distanceRemainingMeters: number;
  readonly routeProgress: number;
  readonly nextManeuver: RouteManeuver | null;
  readonly distanceToManeuverMeters: number | null;
  readonly trackFollowing: boolean;
  readonly offRouteState: OffRouteState;
  readonly deviatingFixCount: number;
  readonly matchAmbiguous: boolean;
}

interface Projection {
  readonly segment: ProgressSegment;
  readonly fraction: number;
  readonly coordinate: Coordinate;
  readonly distanceMeters: number;
  readonly routeDistanceMeters: number;
  readonly score: number;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function degrees(value: number): number {
  return (value * 180) / Math.PI;
}

function bearing(start: Coordinate, finish: Coordinate): number {
  const startLatitude = radians(start.lat);
  const finishLatitude = radians(finish.lat);
  const longitudeDelta = radians(finish.lon - start.lon);
  const y = Math.sin(longitudeDelta) * Math.cos(finishLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(finishLatitude) -
    Math.sin(startLatitude) * Math.cos(finishLatitude) * Math.cos(longitudeDelta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function headingDifference(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
}

function projectOntoSegment(
  location: Coordinate,
  segment: ProgressSegment,
): Omit<Projection, "score"> {
  const latitudeScale = (EARTH_RADIUS_METERS * Math.PI) / 180;
  const longitudeScale = latitudeScale * Math.cos(radians(location.lat));
  const startX = (segment.start.lon - location.lon) * longitudeScale;
  const startY = (segment.start.lat - location.lat) * latitudeScale;
  const finishX = (segment.finish.lon - location.lon) * longitudeScale;
  const finishY = (segment.finish.lat - location.lat) * latitudeScale;
  const segmentX = finishX - startX;
  const segmentY = finishY - startY;
  const lengthSquared = segmentX ** 2 + segmentY ** 2;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, -(startX * segmentX + startY * segmentY) / lengthSquared),
        );
  const projectedX = startX + segmentX * fraction;
  const projectedY = startY + segmentY * fraction;
  return {
    segment,
    fraction,
    coordinate: {
      lon: segment.start.lon + (segment.finish.lon - segment.start.lon) * fraction,
      lat: segment.start.lat + (segment.finish.lat - segment.start.lat) * fraction,
    },
    distanceMeters: Math.hypot(projectedX, projectedY),
    routeDistanceMeters: segment.startDistanceMeters + segment.lengthMeters * fraction,
  };
}

function continuityPenalty(
  routeDistanceMeters: number,
  fix: PositionFix,
  previous: ProgressFrame | undefined,
): number {
  if (previous === undefined) return 0;
  const elapsedMs = Date.parse(fix.observedAt) - Date.parse(previous.observedAt);
  const elapsedSeconds = Number.isFinite(elapsedMs)
    ? Math.max(0.1, Math.min(30, elapsedMs / 1_000))
    : 1;
  const routeDelta = routeDistanceMeters - previous.distanceAlongMeters;
  const expectedTravel = Math.max(0, fix.speedMps ?? 0) * elapsedSeconds;
  const accuracy = fix.accuracyMeters ?? 30;
  const backwardTolerance = Math.max(35, accuracy * 2);
  const forwardTolerance = Math.max(160, expectedTravel * 4 + accuracy * 2);
  let penalty = Math.min(Math.abs(routeDelta - expectedTravel) * 0.08, 120);
  if (routeDelta < -backwardTolerance) {
    penalty += 1_000 + Math.min(Math.abs(routeDelta) * 0.55, 600);
  }
  if (routeDelta > forwardTolerance) {
    penalty += 1_000 + Math.min((routeDelta - forwardTolerance) * 0.35, 600);
  }
  return penalty;
}

function usableCoordinate(coordinate: Coordinate): boolean {
  return (
    Number.isFinite(coordinate.lon) &&
    Number.isFinite(coordinate.lat) &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180 &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90
  );
}

function spatialCell(value: number): number {
  return Math.floor(value / SPATIAL_CELL_DEGREES);
}

function spatialKey(longitudeCell: number, latitudeCell: number): string {
  return `${longitudeCell}:${latitudeCell}`;
}

function buildSpatialIndex(segments: readonly ProgressSegment[]): {
  readonly spatialIndex: ReadonlyMap<string, readonly number[]>;
  readonly unindexedSegmentIndices: readonly number[];
} {
  const index = new Map<string, number[]>();
  const unindexedSegmentIndices: number[] = [];
  for (const segment of segments) {
    const minLongitudeCell = spatialCell(Math.min(segment.start.lon, segment.finish.lon));
    const maxLongitudeCell = spatialCell(Math.max(segment.start.lon, segment.finish.lon));
    const minLatitudeCell = spatialCell(Math.min(segment.start.lat, segment.finish.lat));
    const maxLatitudeCell = spatialCell(Math.max(segment.start.lat, segment.finish.lat));
    const cellCount =
      (maxLongitudeCell - minLongitudeCell + 1) *
      (maxLatitudeCell - minLatitudeCell + 1);
    if (cellCount > MAX_INDEX_CELLS_PER_SEGMENT) {
      unindexedSegmentIndices.push(segment.index);
      continue;
    }
    for (
      let longitudeCell = minLongitudeCell;
      longitudeCell <= maxLongitudeCell;
      longitudeCell += 1
    ) {
      for (
        let latitudeCell = minLatitudeCell;
        latitudeCell <= maxLatitudeCell;
        latitudeCell += 1
      ) {
        const key = spatialKey(longitudeCell, latitudeCell);
        const bucket = index.get(key);
        if (bucket === undefined) index.set(key, [segment.index]);
        else bucket.push(segment.index);
      }
    }
  }
  return { spatialIndex: index, unindexedSegmentIndices };
}

export function buildProgressModel(route: ProgressRoute): ProgressModel {
  // A malformed vertex breaks route continuity. Do not silently remove it,
  // connect points the route never connected, or match the fix to itself.
  if (route.geometry.length < 2 || !route.geometry.every(usableCoordinate)) {
    throw new InvalidProgressRouteError();
  }
  const geometry = route.geometry.map((coordinate) => ({
    lon: coordinate.lon,
    lat: coordinate.lat,
  }));
  const segments: ProgressSegment[] = [];
  let distance = 0;
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const start = geometry[index];
    const finish = geometry[index + 1];
    if (start === undefined || finish === undefined) continue;
    const lengthMeters = haversine(start, finish);
    segments.push({
      index,
      start,
      finish,
      startDistanceMeters: distance,
      lengthMeters,
      bearingDegrees: bearing(start, finish),
    });
    distance += lengthMeters;
  }
  if (segments.length === 0 || !Number.isFinite(distance) || distance <= 0) {
    throw new InvalidProgressRouteError();
  }
  const maneuvers = [...(route.maneuvers ?? [])]
    .filter(
      (maneuver) =>
        Number.isFinite(maneuver.atDistanceMeters) && maneuver.atDistanceMeters >= 0,
    )
    .sort((first, second) => first.atDistanceMeters - second.atDistanceMeters);
  const spatial = buildSpatialIndex(segments);
  return {
    mode: route.mode,
    geometry,
    segments,
    totalDistanceMeters: distance,
    maneuvers,
    spatialIndex: spatial.spatialIndex,
    unindexedSegmentIndices: spatial.unindexedSegmentIndices,
  };
}

function bestProjection(
  model: ProgressModel,
  fix: PositionFix,
  previous: ProgressFrame | undefined,
): { readonly projection: Projection; readonly ambiguous: boolean } {
  if (model.segments.length === 0) throw new InvalidProgressRouteError();
  const heading =
    fix.headingDegrees === null || !Number.isFinite(fix.headingDegrees)
      ? null
      : ((fix.headingDegrees % 360) + 360) % 360;
  const measuredMovement =
    previous === undefined ? 0 : haversine(previous.rawPosition, fix.coordinate);
  const useHeading =
    heading !== null &&
    ((fix.speedMps ?? 0) >= 1.5 || (fix.speedMps === null && measuredMovement >= 5));
  const segmentIndices = new Set(model.unindexedSegmentIndices);
  const longitudeCell = spatialCell(fix.coordinate.lon);
  const latitudeCell = spatialCell(fix.coordinate.lat);
  for (
    let longitudeOffset = -SPATIAL_MATCH_RADIUS_CELLS;
    longitudeOffset <= SPATIAL_MATCH_RADIUS_CELLS;
    longitudeOffset += 1
  ) {
    for (
      let latitudeOffset = -SPATIAL_MATCH_RADIUS_CELLS;
      latitudeOffset <= SPATIAL_MATCH_RADIUS_CELLS;
      latitudeOffset += 1
    ) {
      const indices = model.spatialIndex.get(
        spatialKey(longitudeCell + longitudeOffset, latitudeCell + latitudeOffset),
      );
      for (const index of indices ?? []) segmentIndices.add(index);
    }
  }
  if (previous !== undefined) {
    const start = Math.max(0, previous.segmentIndex - CONTINUITY_SEGMENT_WINDOW);
    const finish = Math.min(
      model.segments.length - 1,
      previous.segmentIndex + CONTINUITY_SEGMENT_WINDOW,
    );
    for (let index = start; index <= finish; index += 1) segmentIndices.add(index);
  }
  const candidates =
    segmentIndices.size === 0
      ? model.segments
      : Array.from(segmentIndices, (index) => model.segments[index]).filter(
          (segment): segment is ProgressSegment => segment !== undefined,
        );
  const projections = candidates
    .map((segment) => {
      const projected = projectOntoSegment(fix.coordinate, segment);
      const headingPenalty = useHeading
        ? headingDifference(heading, segment.bearingDegrees) * 0.55
        : 0;
      return {
        ...projected,
        score:
          projected.distanceMeters +
          headingPenalty +
          continuityPenalty(projected.routeDistanceMeters, fix, previous),
      };
    })
    .sort((first, second) => first.score - second.score);
  const projection = projections[0];
  if (projection === undefined) throw new InvalidProgressRouteError();
  const nearestDistance = Math.min(...projections.map((candidate) => candidate.distanceMeters));
  const accuracy = fix.accuracyMeters ?? 30;
  const distanceWindow = Math.max(45, Math.min(100, accuracy * 1.5));
  const alternative = projections.find(
    (candidate) =>
      candidate !== projection &&
      candidate.distanceMeters <= nearestDistance + distanceWindow &&
      Math.abs(candidate.routeDistanceMeters - projection.routeDistanceMeters) >
        AMBIGUOUS_ROUTE_SEPARATION_METERS,
  );
  const ambiguous =
    alternative !== undefined &&
    projection.distanceMeters <= Math.max(60, accuracy * 2) &&
    alternative.score - projection.score < AMBIGUOUS_SCORE_MARGIN;
  return { projection, ambiguous };
}

function nextManeuver(
  model: ProgressModel,
  distanceAlongMeters: number,
): RouteManeuver | null {
  if (model.mode === "track") return null;
  return (
    model.maneuvers.find(
      (maneuver) => maneuver.atDistanceMeters >= distanceAlongMeters - MANEUVER_PASS_METERS,
    ) ?? null
  );
}

function offRouteState(
  deviating: boolean,
  ambiguous: boolean,
  previous: ProgressFrame | undefined,
  rerouting: boolean,
): { readonly state: OffRouteState; readonly count: number } {
  if (rerouting) {
    return { state: "rerouting", count: previous?.deviatingFixCount ?? 0 };
  }
  if (deviating) {
    const count = (previous?.deviatingFixCount ?? 0) + 1;
    return {
      state: count >= OFF_ROUTE_FIXES_REQUIRED ? "off-route" : "uncertain",
      count,
    };
  }
  if (previous?.offRouteState === "off-route" || previous?.offRouteState === "rerouting") {
    return { state: "rejoining", count: 0 };
  }
  if (ambiguous) return { state: "uncertain", count: 0 };
  return { state: "on-route", count: 0 };
}

export interface MatchProgressOptions {
  readonly rerouting?: boolean;
}

/** Match one fix without mutating either the model or the previous frame. */
export function matchRouteProgress(
  model: ProgressModel,
  fix: PositionFix,
  previous?: ProgressFrame,
  options: MatchProgressOptions = {},
): ProgressFrame {
  const gapMs = previous === undefined ? 0 : Date.parse(fix.observedAt) - Date.parse(previous.observedAt);
  const continuity = previous !== undefined && Number.isFinite(gapMs) && gapMs > CONTINUITY_MAX_GAP_MS
    ? undefined
    : previous;
  const { projection, ambiguous } = bestProjection(model, fix, continuity);
  const total = model.totalDistanceMeters;
  const distanceAlongMeters = Math.max(0, Math.min(total, projection.routeDistanceMeters));
  const accuracy = fix.accuracyMeters ?? 30;
  const deviationThreshold = Math.max(
    MIN_OFF_ROUTE_METERS,
    Math.min(80, Math.max(0, accuracy) * 2.2),
  );
  const deviation = projection.distanceMeters > deviationThreshold;
  const offRoute = offRouteState(
    deviation,
    ambiguous,
    previous,
    options.rerouting ?? false,
  );
  const maneuver = nextManeuver(model, distanceAlongMeters);
  return {
    rawPosition: { ...fix.coordinate },
    onRoutePosition: { ...projection.coordinate },
    observedAt: fix.observedAt,
    segmentIndex: projection.segment.index,
    segmentFraction: projection.fraction,
    routeBearingDegrees: model.segments.length === 0 ? null : projection.segment.bearingDegrees,
    distanceFromRouteMeters: projection.distanceMeters,
    distanceAlongMeters,
    distanceRemainingMeters: Math.max(0, total - distanceAlongMeters),
    routeProgress: total > 0 ? distanceAlongMeters / total : 0,
    nextManeuver: maneuver,
    distanceToManeuverMeters:
      maneuver === null ? null : Math.max(0, maneuver.atDistanceMeters - distanceAlongMeters),
    trackFollowing: model.mode === "track",
    offRouteState: offRoute.state,
    deviatingFixCount: offRoute.count,
    matchAmbiguous: ambiguous,
  };
}
