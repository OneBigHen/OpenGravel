/**
 * Live ride sharing ("Follow my ride"): the facts one rider broadcasts to one
 * loved one, and nothing else.
 *
 * A rider starts a live ride from the ride screen and sends the follower a link
 * with a random token. The follower page reads those facts and draws them; it
 * never sees the rider's ride document, their saved rides, or the owner secret
 * that authorises writing points. The owner secret is a write capability, so it
 * is deliberately absent from every type in this module.
 *
 * `unknown` stays unknown here as everywhere else in OpenGravel: a fix that did
 * not report a speed has `speed: null`, and the follower page says nothing about
 * it rather than printing `0 mph`. The status is the rider's own claim
 * (`riding`, `paused`, `finished`) or the rider's own alert, never something the
 * server inferred.
 */

/** What the rider's screen says the ride is doing. */
export type LiveRideStatus = "riding" | "paused" | "finished" | "alert";

/**
 * Why an alert was raised, as the rider's screen named it. `possible-crash` is
 * the screen's own detection (never a server diagnosis), `sos` is the rider
 * asking for help, and `rider-cancelled` says the rider ended the ride on
 * purpose — which reads very differently to a follower and must not be dressed
 * up as an emergency.
 */
export type LiveAlertReason = "possible-crash" | "rider-cancelled" | "sos";

/** A planned-route position. A coordinate is a position, not an address. */
export interface LiveCoordinate {
  readonly lon: number;
  readonly lat: number;
}

/**
 * The planned route's line, split where the rider's plan has a break (a ferry,
 * a gap between segments). Empty segments are never stored.
 */
export interface LiveRouteGeometry {
  readonly segments: readonly (readonly LiveCoordinate[])[];
}

/** One position report, as the rider's device measured it. */
export interface LivePoint {
  /** Epoch milliseconds, from the rider's device clock. */
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  /** Metres per second, or `null` when the fix did not report one. */
  readonly speed: number | null;
  /** Degrees clockwise from north, or `null` when the fix did not report one. */
  readonly heading: number | null;
  /** Horizontal accuracy in metres, or `null` when the fix did not report one. */
  readonly accuracy: number | null;
  /** Device battery as a share of full (`0..1`), or `null` when unknown. */
  readonly battery: number | null;
}

/** One point of the drawn trail. The trail needs where and when, and its speed. */
export interface LiveTrailPoint {
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  readonly speed: number | null;
}

/** The alert a follower is shown, with the moment the rider's screen raised it. */
export interface LiveAlert {
  readonly reason: LiveAlertReason;
  /** Epoch milliseconds. */
  readonly at: number;
}

/**
 * Everything the public follower endpoint may disclose about one live ride.
 *
 * This is the whole public surface: there is no owner id, no owner secret, no
 * ride document, and no history beyond the trail (which is itself thinned and
 * expires with the ride).
 */
export interface LiveFollowSnapshot {
  readonly riderName: string;
  readonly status: LiveRideStatus;
  readonly alert: LiveAlert | null;
  /** When the ride row last changed, in epoch milliseconds. */
  readonly updatedAt: number;
  /** The newest point, or `null` while the rider has not reported one yet. */
  readonly last: LivePoint | null;
  /** The ridden breadcrumb, oldest first, thinned for the wire. */
  readonly trail: readonly LiveTrailPoint[];
  /** The rider's planned route, or `null` when they shared none. */
  readonly route: LiveRouteGeometry | null;
}

/** True for a status the rider's screen may report. */
export function isLiveRideStatus(value: unknown): value is LiveRideStatus {
  return value === "riding" || value === "paused" || value === "finished" || value === "alert";
}

/**
 * How long a live ride may go without a point before the follower is told the
 * signal may be lost.
 *
 * Three minutes is the same freshness bound the ride screen applies to its own
 * position (08 §4): a follower's map must not present a three-minute-old dot as
 * the rider's current place, and a follower's card must not stay silent about it
 * either.
 */
export const LIVE_STALE_AFTER_MS = 3 * 60_000;

/** True for an alert reason a follower may be shown. */
export function isLiveAlertReason(value: unknown): value is LiveAlertReason {
  return value === "possible-crash" || value === "rider-cancelled" || value === "sos";
}
