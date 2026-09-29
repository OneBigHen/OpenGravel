/**
 * Injected GPS acquisition pipeline (08 §3–§4).
 *
 * Browser geolocation is an adapter concern. This module owns the permission
 * and watch lifecycle, normalizes reported values, smooths nearby coordinates,
 * derives heading only from measured movement, derives speed from successive
 * credible fixes when the device reports none (RIDE-INSTRUMENT-STRIP §6.1),
 * and emits ordinary PositionFix values for the RideSession controller. Freshness and quality deliberately do
 * not live here; deriveSessionNavigation remains their sole authority.
 */

import { haversine } from "@/domain/geometry/analysis";
import { deriveSpeedMps, pruneSpeedHistory, type SpeedFix } from "@/domain/recording/telemetry";
import type { Coordinate } from "@/domain/ride/types";
import type { PositionFix } from "@/domain/ride-session/types";

export type PositionPermission = "unknown" | "prompt" | "granted" | "denied";
export type PositionPipelineStatus =
  | "idle"
  | "acquiring"
  | "tracking"
  | "recovered"
  | "denied"
  | "lost"
  | "stopped";
export type PositionSourceErrorCode =
  | "permission-denied"
  | "position-unavailable"
  | "timeout";

export interface RawPosition {
  readonly coordinate: Coordinate;
  readonly observedAt: string;
  readonly accuracyMeters: number | null;
  readonly headingDegrees: number | null;
  readonly speedMps: number | null;
  /** Altitude in metres when the source reports one; absent or `null` otherwise. */
  readonly altitudeMeters?: number | null;
  readonly altitudeAccuracyMeters?: number | null;
}

export interface PositionSourceError {
  readonly code: PositionSourceErrorCode;
}

export interface PositionSourceObserver {
  position(position: RawPosition): void;
  error(error: PositionSourceError): void;
  /**
   * Optional route-deviation fact from a navigation source that already owns
   * route matching (for example Ferrostar). Plain GPS sources leave this
   * undefined and the navigation engine derives deviation from the route line.
   */
  routeDeviation?(offRoute: boolean): void;
}

export interface PositionWatch {
  stop(): void;
}

/** Port implemented by a browser/native shell adapter, never by this logic. */
export interface PositionSource {
  permission(): Promise<Exclude<PositionPermission, "unknown">>;
  watch(observer: PositionSourceObserver): PositionWatch;
}

export interface PositionPipelineState {
  readonly permission: PositionPermission;
  readonly status: PositionPipelineStatus;
  readonly lastFix: PositionFix | null;
  readonly lastError: PositionSourceErrorCode | null;
}

export interface PositionPipelineOptions {
  readonly source: PositionSource;
  readonly onFix: (fix: PositionFix) => Promise<unknown> | unknown;
  /** Receives an authoritative route-deviation fact when the source has one. */
  readonly onRouteDeviation?: (offRoute: boolean) => Promise<unknown> | unknown;
}

export interface PositionPipeline {
  snapshot(): PositionPipelineState;
  subscribe(listener: (state: PositionPipelineState) => void): () => void;
  start(): Promise<void>;
  retry(): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/** A reported ground speed: finite and not negative (a negative speed means "unknown"). */
function reportedSpeed(value: number | null): number | null {
  const finite = finiteOrNull(value);
  return finite === null || finite < 0 ? null : finite;
}

function nonNegativeOrNull(value: number | null | undefined): number | null {
  const finite = finiteOrNull(value ?? null);
  return finite === null || finite < 0 ? null : finite;
}

function normalizeHeading(value: number | null): number | null {
  const finite = finiteOrNull(value);
  return finite === null ? null : ((finite % 360) + 360) % 360;
}

function validCoordinate(coordinate: Coordinate): boolean {
  return (
    Number.isFinite(coordinate.lon) &&
    Number.isFinite(coordinate.lat) &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180 &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90
  );
}

function bearing(start: Coordinate, finish: Coordinate): number {
  const startLatitude = (start.lat * Math.PI) / 180;
  const finishLatitude = (finish.lat * Math.PI) / 180;
  const longitudeDelta = ((finish.lon - start.lon) * Math.PI) / 180;
  const y = Math.sin(longitudeDelta) * Math.cos(finishLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(finishLatitude) -
    Math.sin(startLatitude) * Math.cos(finishLatitude) * Math.cos(longitudeDelta);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function smoothCoordinate(
  previous: Coordinate | null,
  next: Coordinate,
  accuracyMeters: number | null,
): Coordinate {
  if (previous === null) return { ...next };
  const movement = haversine(previous, next);
  const accuracy = accuracyMeters ?? 30;
  // A large move is not jitter. Keeping it unsmoothed lets a recovered watch
  // catch up instead of dragging stale history behind the rider.
  if (movement > Math.max(100, accuracy * 4)) return { ...next };
  const alpha = Math.max(0.2, Math.min(0.8, 20 / (accuracy + 20)));
  return {
    lon: previous.lon + (next.lon - previous.lon) * alpha,
    lat: previous.lat + (next.lat - previous.lat) * alpha,
  };
}

export function createPositionPipeline(options: PositionPipelineOptions): PositionPipeline {
  let state: PositionPipelineState = {
    permission: "unknown",
    status: "idle",
    lastFix: null,
    lastError: null,
  };
  let watch: PositionWatch | null = null;
  let lastRawCoordinate: Coordinate | null = null;
  // Recent raw fixes, the baseline for a derived speed.
  let speedHistory: SpeedFix[] = [];
  let recoveryPending = false;
  let chain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(state: PositionPipelineState) => void>();

  function publish(patch: Partial<PositionPipelineState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  function stopWatch(): void {
    if (watch === null) return;
    watch.stop();
    watch = null;
  }

  function receive(position: RawPosition): void {
    if (!validCoordinate(position.coordinate) || Number.isNaN(Date.parse(position.observedAt))) {
      publish({ status: "lost", lastError: "position-unavailable" });
      return;
    }
    const accuracyMeters = finiteOrNull(position.accuracyMeters);
    const atMs = Date.parse(position.observedAt);
    const speedFix: SpeedFix = { coordinate: { ...position.coordinate }, atMs, accuracyMeters };
    const deviceSpeed = reportedSpeed(position.speedMps);
    // A device speed is kept as reported; only a missing one is derived.
    const derivedSpeed = deviceSpeed === null ? deriveSpeedMps(speedHistory, speedFix) : null;
    const speedMps = deviceSpeed ?? derivedSpeed;
    const altitudeMeters = finiteOrNull(position.altitudeMeters ?? null);
    const movement =
      lastRawCoordinate === null ? 0 : haversine(lastRawCoordinate, position.coordinate);
    const derivationThreshold = Math.max(5, Math.min(15, accuracyMeters ?? 15));
    const reportedHeading = normalizeHeading(position.headingDegrees);
    const headingDegrees =
      reportedHeading ??
      (lastRawCoordinate !== null && movement >= derivationThreshold
        ? bearing(lastRawCoordinate, position.coordinate)
        : null);
    const fix: PositionFix = {
      coordinate: smoothCoordinate(state.lastFix?.coordinate ?? null, position.coordinate, accuracyMeters),
      observedAt: position.observedAt,
      accuracyMeters,
      headingDegrees,
      speedMps,
      ...(derivedSpeed === null ? {} : { speedDerived: true }),
      ...(altitudeMeters === null
        ? {}
        : { altitudeMeters, altitudeAccuracyMeters: nonNegativeOrNull(position.altitudeAccuracyMeters) }),
    };
    lastRawCoordinate = { ...position.coordinate };
    speedHistory = [...pruneSpeedHistory(speedHistory, atMs), speedFix];
    const nextStatus: PositionPipelineStatus = recoveryPending ? "recovered" : "tracking";
    recoveryPending = false;
    publish({
      permission: "granted",
      status: nextStatus,
      lastFix: fix,
      lastError: null,
    });
    const run = chain.then(() => options.onFix(fix));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
  }

  function receiveRouteDeviation(offRoute: boolean): void {
    const onRouteDeviation = options.onRouteDeviation;
    if (onRouteDeviation === undefined) return;
    const run = chain.then(() => onRouteDeviation(offRoute));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
  }

  function fail(error: PositionSourceError): void {
    if (error.code === "permission-denied") {
      recoveryPending = true;
      stopWatch();
      publish({ permission: "denied", status: "denied", lastError: error.code });
      return;
    }
    recoveryPending = true;
    publish({ status: "lost", lastError: error.code });
  }

  async function acquire(): Promise<void> {
    if (
      state.status === "denied" ||
      state.status === "lost" ||
      (state.status === "stopped" && state.lastFix !== null)
    ) {
      recoveryPending = true;
    }
    stopWatch();
    let permission: Exclude<PositionPermission, "unknown">;
    try {
      permission = await options.source.permission();
    } catch {
      recoveryPending = true;
      publish({ status: "lost", lastError: "position-unavailable" });
      return;
    }
    if (permission === "denied") {
      publish({ permission: "denied", status: "denied", lastError: "permission-denied" });
      return;
    }
    publish({ permission, status: "acquiring", lastError: null });
    try {
      watch = options.source.watch({
        position: receive,
        error: fail,
        routeDeviation: receiveRouteDeviation,
      });
    } catch {
      publish({ status: "lost", lastError: "position-unavailable" });
    }
  }

  return {
    snapshot(): PositionPipelineState {
      return state;
    },

    subscribe(listener: (state: PositionPipelineState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(): Promise<void> {
      if (watch !== null || state.status === "acquiring" || state.status === "tracking") return;
      await acquire();
    },

    async retry(): Promise<void> {
      await acquire();
    },

    async stop(): Promise<void> {
      stopWatch();
      publish({ status: "stopped" });
      await chain;
    },

    async flush(): Promise<void> {
      await chain;
    },
  };
}
