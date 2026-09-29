/** Browser geolocation adapter for the RideSession position pipeline (08 §3–§4). */

import type {
  PositionPermission,
  PositionSource,
  PositionSourceErrorCode,
} from "@/application/ride-session/position-pipeline";

export interface BrowserPositionSourceOptions {
  readonly browser?: {
    readonly geolocation?: Geolocation | undefined;
    readonly permissions?: Permissions | undefined;
  };
}

function browserOf(options: BrowserPositionSourceOptions): NonNullable<BrowserPositionSourceOptions["browser"]> {
  if (options.browser !== undefined) return options.browser;
  if (typeof navigator === "undefined") return {};
  return navigator;
}

/**
 * Some engines report `timestamp` in microseconds (a WebKit WPE build did:
 * 1,000x `Date.now()`), which made a 15-minute ride record 254 hours. A stamp
 * far in the future is read as microseconds when that lands near the clock,
 * and as "observed now" otherwise. Past stamps pass through: the pipeline
 * already judges a stale fix by its age.
 */
const DAY_MS = 86_400_000;
function plausibleTimestamp(timestamp: number, now: number = Date.now()): number {
  if (!Number.isFinite(timestamp)) return now;
  if (timestamp <= now + DAY_MS) return timestamp;
  const milliseconds = timestamp / 1000;
  return Math.abs(milliseconds - now) <= DAY_MS ? milliseconds : now;
}

/** Altitude only when the device reported one (RIDE-INSTRUMENT-STRIP §6.4). */
function altitudeOf(
  coords: Pick<GeolocationCoordinates, "altitude" | "altitudeAccuracy">,
): { altitudeMeters?: number; altitudeAccuracyMeters?: number | null } {
  const altitude = coords.altitude;
  if (typeof altitude !== "number" || !Number.isFinite(altitude)) return {};
  const accuracy = coords.altitudeAccuracy;
  return {
    altitudeMeters: altitude,
    altitudeAccuracyMeters: typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
  };
}

function errorCode(error: GeolocationPositionError): PositionSourceErrorCode {
  if (error.code === error.PERMISSION_DENIED) return "permission-denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "position-unavailable";
}

export function createBrowserPositionSource(
  options: BrowserPositionSourceOptions = {},
): PositionSource {
  const browser = browserOf(options);
  return {
    async permission(): Promise<Exclude<PositionPermission, "unknown">> {
      if (browser.geolocation === undefined) return "prompt";
      if (browser.permissions === undefined) return "prompt";
      try {
        const status = await browser.permissions.query({ name: "geolocation" });
        return status.state === "granted" || status.state === "denied" ? status.state : "prompt";
      } catch {
        // Safari may expose geolocation without implementing the Permissions API.
        // watchPosition itself owns the prompt, so the pipeline remains usable.
        return "prompt";
      }
    },

    watch(observer) {
      const geolocation = browser.geolocation;
      if (geolocation === undefined) throw new Error("Geolocation is unavailable.");
      const id = geolocation.watchPosition(
        (position) => {
          observer.position({
            coordinate: {
              lon: position.coords.longitude,
              lat: position.coords.latitude,
            },
            observedAt: new Date(plausibleTimestamp(position.timestamp)).toISOString(),
            accuracyMeters: position.coords.accuracy,
            headingDegrees: position.coords.heading,
            speedMps: position.coords.speed,
            // Many desktop browsers report no altitude: then the fix carries none.
            ...altitudeOf(position.coords),
          });
        },
        (error) => observer.error({ code: errorCode(error) }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
      return { stop: (): void => geolocation.clearWatch(id) };
    },
  };
}
