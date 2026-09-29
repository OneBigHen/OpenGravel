import { haversine } from "@/domain/geometry/analysis";
import type { ResolvedNavigationRoute } from "./navigation-engine";

export const NATIVE_NAVIGATION_SCHEMA_VERSION = 1 as const;
export const MAX_NATIVE_NAVIGATION_COORDINATES = 50_000;
export const MAX_NATIVE_NAVIGATION_MANEUVERS = 1_024;

export type NativeNavigationManeuverKind = "turn" | "continue" | "arrive";
export type NativeNavigationTurn =
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "straight"
  | "uturn"
  | null;

export interface NativeNavigationCoordinate {
  readonly lat: number;
  readonly lon: number;
}

export interface NativeNavigationManeuver {
  readonly id: string;
  readonly kind: NativeNavigationManeuverKind;
  readonly maneuver: NativeNavigationTurn;
  readonly roadName: string | null;
  readonly atDistanceMeters: number;
}

export interface NativeNavigationRouteMetadata {
  /** Stable OpenGravel route fingerprint, not a Ferrostar/provider id. */
  readonly fingerprint: string;
  /** Rider-facing geography/title already authored by OpenGravel. */
  readonly title: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** Versioned OpenGravel policy the native reroute adapter must preserve. */
  readonly reroutePolicyVersion: string;
}

export interface NativeNavigationPayloadV1 {
  readonly schema: "native-navigation/v1";
  readonly schemaVersion: typeof NATIVE_NAVIGATION_SCHEMA_VERSION;
  readonly mode: "guided";
  readonly routeId: string;
  readonly planningGeneration: number;
  readonly fingerprint: string;
  readonly title: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly reroutePolicyVersion: string;
  readonly geometry: readonly NativeNavigationCoordinate[];
  readonly maneuvers: readonly NativeNavigationManeuver[];
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
}

function validCoordinate(coordinate: NativeNavigationCoordinate): boolean {
  return (
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lon) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180
  );
}

/**
 * Builds the only route shape allowed to cross from VNext into native
 * navigation. Ferrostar types deliberately stop on the Swift side of this
 * boundary.
 */
export function buildNativeNavigationPayload(
  route: ResolvedNavigationRoute,
  metadata: NativeNavigationRouteMetadata,
): NativeNavigationPayloadV1 {
  if (route.mode !== "guided" || route.binding === null || route.binding === undefined) {
    throw new Error("Native turn-by-turn navigation requires a guided route binding.");
  }
  if (route.geometry.length < 2) {
    throw new Error("Native navigation requires at least two route coordinates.");
  }
  if (route.geometry.length > MAX_NATIVE_NAVIGATION_COORDINATES) {
    throw new Error("Native navigation route geometry exceeds the payload bound.");
  }
  if (route.geometry.some((coordinate) => !validCoordinate(coordinate))) {
    throw new Error("Native navigation route contains an invalid coordinate.");
  }

  const maneuvers = route.maneuvers ?? [];
  if (maneuvers.length > MAX_NATIVE_NAVIGATION_MANEUVERS) {
    throw new Error("Native navigation maneuver count exceeds the payload bound.");
  }

  finiteNonNegative(metadata.distanceMeters, "distanceMeters");
  finiteNonNegative(metadata.durationSeconds, "durationSeconds");
  if (metadata.fingerprint.length === 0) throw new Error("fingerprint is required.");
  if (metadata.reroutePolicyVersion.length === 0) throw new Error("reroutePolicyVersion is required.");

  let previousDistance = -1;
  const normalizedManeuvers = maneuvers.map((maneuver) => {
    finiteNonNegative(maneuver.atDistanceMeters, "maneuver.atDistanceMeters");
    if (maneuver.atDistanceMeters < previousDistance) {
      throw new Error("Native navigation maneuvers must be ordered along the route.");
    }
    if (
      metadata.distanceMeters > 0 &&
      maneuver.atDistanceMeters > metadata.distanceMeters + 25
    ) {
      throw new Error("Native navigation maneuver lies beyond the route distance.");
    }
    previousDistance = maneuver.atDistanceMeters;
    return {
      id: maneuver.instructionId as string,
      kind: maneuver.kind,
      maneuver: maneuver.maneuver,
      roadName: maneuver.roadName,
      atDistanceMeters: maneuver.atDistanceMeters,
    } satisfies NativeNavigationManeuver;
  });

  return {
    schema: "native-navigation/v1",
    schemaVersion: NATIVE_NAVIGATION_SCHEMA_VERSION,
    mode: "guided",
    routeId: route.binding.routeId as string,
    planningGeneration: route.binding.planningGeneration,
    fingerprint: metadata.fingerprint,
    title: metadata.title,
    distanceMeters: metadata.distanceMeters,
    durationSeconds: metadata.durationSeconds,
    reroutePolicyVersion: metadata.reroutePolicyVersion,
    geometry: route.geometry.map(({ lat, lon }) => ({ lat, lon })),
    maneuvers: normalizedManeuvers,
  };
}

/** The reroute policy the native adapter must preserve (F3 wires it). */
export const NATIVE_REROUTE_POLICY_VERSION = "opengravel-keep-route/v1";

/**
 * The payload for the guided route a ride is starting (F2): its identity, the
 * whole line's length and, when the planner recorded it, the route's duration.
 */
export function guidedNativeNavigationPayload(
  route: ResolvedNavigationRoute,
  routeDurationSeconds: number | undefined,
): NativeNavigationPayloadV1 {
  let distanceMeters = 0;
  for (let index = 1; index < route.geometry.length; index += 1) {
    distanceMeters += haversine(route.geometry[index - 1]!, route.geometry[index]!);
  }
  const binding = route.binding;
  return buildNativeNavigationPayload(route, {
    fingerprint: binding === null || binding === undefined
      ? "unbound"
      : `${binding.routeId as string}:${binding.planningGeneration}:${route.geometry.length}`,
    title: "Your destination",
    distanceMeters,
    durationSeconds: routeDurationSeconds ?? 0,
    reroutePolicyVersion: NATIVE_REROUTE_POLICY_VERSION,
  });
}
