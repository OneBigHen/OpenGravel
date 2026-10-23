/**
 * The live ride HTTP boundary: create a ride, push points, finish it, and read
 * what a follower may see.
 *
 * Everything here is validated before it reaches the store, and the response
 * shape is the share endpoint's (`{ message }` for an error, no-store headers,
 * noindex), so the two public features answer a bad request the same way. The
 * rules worth naming:
 *
 * - **The rider's name is a name, not markup.** Trimmed, bounded to 40
 *   characters, no control characters, and always rendered as text.
 * - **The route is geometry, not a document.** At most 5,000 positions per
 *   ride, each a finite coordinate in range; anything else is refused instead
 *   of stored.
 * - **A point is a recent position, not history.** Points older than six hours
 *   or more than two minutes in the future are refused, so a follower's map can
 *   never be moved by a replayed or badly-clocked device.
 * - **Reading is public, writing is not.** Only the owner secret authorises a
 *   points call or a finish; the follow token only ever reads.
 */

import { createHash } from "node:crypto";

import {
  isLiveAlertReason,
  isLiveRideStatus,
  type LiveAlert,
  type LiveRideStatus,
  type LiveRouteGeometry,
} from "@/domain/live/types";
import { clientKey } from "@/server/rate-limit";

import {
  LIVE_MAX_POINTS_PER_CALL,
  LIVE_MAX_ROUTE_POINTS,
  LIVE_POINT_MAX_AGE_MS,
  LIVE_POINT_MAX_FUTURE_MS,
  newFollowToken,
  newLiveRideId,
  newOwnerSecret,
  type LivePointChange,
  type LivePointInput,
  type SQLiteLiveRideStore,
} from "./live-ride-store";

/** A rider name and a planned route: comfortably above the route cap, no more. */
export const MAX_LIVE_CREATE_BODY_BYTES = 512 * 1024;
/** 120 points, each with its own bookkeeping fields. */
export const MAX_LIVE_POINTS_BODY_BYTES = 96 * 1024;

const MAX_RIDER_NAME = 40;
/** Faster than any motorcycle: a speed above this is not a speed. */
const MAX_SPEED_MPS = 200;
/** Worse than this is not a fix, it is a guess. */
const MAX_ACCURACY_METERS = 10_000;

const HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

const reply = (status: number, message: string, extra: Readonly<Record<string, string>> = {}): Response =>
  Response.json({ message }, { status, headers: { ...HEADERS, ...extra } });

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const optionalNumber = (value: unknown, min: number, max: number): value is number | null | undefined =>
  value === undefined || value === null || finite(value, min, max);

export interface LiveHandlerOptions {
  readonly now?: () => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * The client identity the creation budget is counted under.
 *
 * The address the reverse proxy reported is hashed before it is stored, so the
 * budget survives a restart without the database holding client addresses. Every
 * key is metered, including the header-less `anonymous` one: a budget keyed on a
 * header a client writes is only a budget if it cannot be skipped by omitting
 * it.
 */
export function liveOwnerHash(request: Request): string {
  return createHash("sha256").update(clientKey(request)).digest("hex");
}

type BodyResult =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "too-large" }
  | { readonly kind: "invalid" };

/** Reads a JSON body without buffering more than `limit` bytes of it. */
async function readJsonBody(request: Request, limit: number): Promise<BodyResult> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return { kind: "invalid" };
  if (!request.body) return { kind: "invalid" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let input = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { kind: "too-large" };
      }
      input += decoder.decode(chunk.value, { stream: true });
    }
    return { kind: "ok", body: JSON.parse(input + decoder.decode()) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

/** A rider's first name: trimmed, bounded, and free of control characters. */
function riderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_RIDER_NAME) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/** One position list, validated and copied into the store's own shape. */
function coordinates(value: unknown): { lon: number; lat: number }[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points: { lon: number; lat: number }[] = [];
  for (const item of value) {
    if (!object(item) || !finite(item.lon, -180, 180) || !finite(item.lat, -90, 90)) return null;
    points.push({ lon: item.lon, lat: item.lat });
  }
  return points;
}

/**
 * The planned route, accepted either as one point list or as the segmented shape
 * the planner already draws. Returns `null` for "no route shared" and the
 * string `"invalid"` for a geometry that must be refused.
 */
function plannedRoute(value: unknown): LiveRouteGeometry | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (value.length > LIVE_MAX_ROUTE_POINTS) return "invalid";
    const points = coordinates(value);
    return points === null ? "invalid" : { segments: [points] };
  }
  if (!object(value) || !Array.isArray(value.segments) || value.segments.length === 0) return "invalid";
  const segments: { lon: number; lat: number }[][] = [];
  let total = 0;
  for (const segment of value.segments) {
    const points = coordinates(segment);
    if (points === null) return "invalid";
    total += points.length;
    if (total > LIVE_MAX_ROUTE_POINTS) return "invalid";
    segments.push(points);
  }
  return { segments };
}

/** One position report, or `null` when anything about it is not a fix. */
function livePoint(value: unknown, now: number): LivePointInput | null {
  if (!object(value)) return null;
  const t = value.t;
  if (typeof t !== "number" || !Number.isSafeInteger(t)) return null;
  if (t < now - LIVE_POINT_MAX_AGE_MS || t > now + LIVE_POINT_MAX_FUTURE_MS) return null;
  if (!finite(value.lat, -90, 90) || !finite(value.lon, -180, 180)) return null;
  if (!optionalNumber(value.speed, 0, MAX_SPEED_MPS)) return null;
  if (!optionalNumber(value.heading, 0, 360)) return null;
  if (!optionalNumber(value.accuracy, 0, MAX_ACCURACY_METERS)) return null;
  if (!optionalNumber(value.battery, 0, 1)) return null;
  return {
    t,
    lat: value.lat,
    lon: value.lon,
    speed: value.speed ?? null,
    heading: value.heading ?? null,
    accuracy: value.accuracy ?? null,
    battery: value.battery ?? null,
  };
}

/** `https://opengravel.example`, from the deployment's own origin. */
function publicOrigin(request: Request, env: Readonly<Record<string, string | undefined>>): string {
  const declared = env.OGV_PUBLIC_ORIGIN?.trim();
  if (declared !== undefined && declared.length > 0) return declared.replace(/\/+$/, "");
  const protocol = request.headers.get("x-forwarded-proto") === "https" ? "https:" : new URL(request.url).protocol;
  return `${protocol}//${request.headers.get("host") ?? new URL(request.url).host}`;
}

export interface CreatedLiveRide {
  readonly rideId: string;
  readonly followToken: string;
  readonly ownerSecret: string;
  readonly followUrl: string;
}

/**
 * `POST /api/live`: starts one live ride and returns the three handles the ride
 * screen needs — the row id, the public follow token, and the write capability.
 * The owner secret is returned exactly once, here; it is never readable again.
 */
export async function handleCreateLiveRide(
  request: Request,
  store: SQLiteLiveRideStore,
  options: LiveHandlerOptions = {},
): Promise<Response> {
  const parsed = await readJsonBody(request, MAX_LIVE_CREATE_BODY_BYTES);
  if (parsed.kind === "too-large") return reply(413, "This ride is too large to share as a live ride.");
  if (parsed.kind === "invalid" || !object(parsed.body)) return reply(400, "A live ride needs a rider name.");
  const name = riderName(parsed.body.riderName);
  if (name === null) return reply(400, "A rider name of 1 to 40 characters is required.");
  const route = plannedRoute(parsed.body.route);
  if (route === "invalid") return reply(400, "The planned route is not a valid line.");

  const ride: CreatedLiveRide = {
    rideId: newLiveRideId(),
    followToken: newFollowToken(),
    ownerSecret: newOwnerSecret(),
    followUrl: "",
  };
  const result = store.createRide({
    id: ride.rideId,
    token: ride.followToken,
    secret: ride.ownerSecret,
    owner: liveOwnerHash(request),
    riderName: name,
    route,
  });
  if (result.state === "limited") {
    return result.reason === "owner-hourly"
      ? reply(429, "You have started too many live rides in the last hour. Try again later.", { "retry-after": "3600" })
      : reply(429, "Live rides are paused: the live ride store is full right now.");
  }
  return Response.json(
    { ...ride, followUrl: `${publicOrigin(request, options.env ?? process.env)}/follow/${ride.followToken}` },
    { status: 201, headers: HEADERS },
  );
}

/** The owner capability a write call presents, or `null` when it presents none. */
function ownerSecretOf(request: Request): string | null {
  const value = request.headers.get("x-live-secret")?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * `POST /api/live/<rideId>/points`: one batch of recent positions, and — when
 * the call carries them — the rider's own status and alert.
 */
export async function handleAppendLivePoints(
  request: Request,
  rideId: string,
  store: SQLiteLiveRideStore,
  options: LiveHandlerOptions = {},
): Promise<Response> {
  const secret = ownerSecretOf(request);
  if (secret === null) return reply(401, "This call needs the live ride secret.");
  const now = (options.now ?? Date.now)();
  const parsed = await readJsonBody(request, MAX_LIVE_POINTS_BODY_BYTES);
  if (parsed.kind === "too-large") return reply(413, "That is too many points for one call.");
  if (parsed.kind === "invalid" || !object(parsed.body)) return reply(400, "A points list is required.");

  const raw = parsed.body.points;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIVE_MAX_POINTS_PER_CALL) {
    return reply(400, `Send between 1 and ${LIVE_MAX_POINTS_PER_CALL} points per call.`);
  }
  const points: LivePointInput[] = [];
  for (const item of raw) {
    const point = livePoint(item, now);
    if (point === null) return reply(400, "A point is not a recent position report.");
    points.push(point);
  }

  const status = parsed.body.status;
  if (status !== undefined && !isLiveRideStatus(status)) return reply(400, "The ride status is not one this app knows.");
  const alertValue = parsed.body.alert;
  if (alertValue !== undefined && alertValue !== null) {
    if (!object(alertValue) || !isLiveAlertReason(alertValue.reason)) return reply(400, "The alert reason is not one this app knows.");
    if (status !== undefined && status !== "alert") return reply(400, "An alert cannot arrive with a different ride status.");
  }
  // A status of "alert" is a claim that there is an alert, so it needs one; and
  // clearing an alert means the rider is riding again, not still alerting.
  if (status === "alert" && (alertValue === undefined || alertValue === null)) {
    return reply(400, "An alert needs a reason.");
  }
  const change: LivePointChange = {
    ...(status === undefined
      ? alertValue === null ? { status: "riding" as const } : {}
      : { status: status as LiveRideStatus }),
    ...(alertValue === undefined
      ? {}
      : {
          alert: alertValue === null
            ? null
            : ({ reason: alertValue.reason, at: points.reduce((latest, point) => Math.max(latest, point.t), 0) } as LiveAlert),
        }),
  };

  const result = store.appendPoints(rideId, secret, points, change);
  if (result.state === "not-found") return reply(404, "This live ride does not exist or has ended.");
  if (result.state === "forbidden") return reply(403, "That secret does not belong to this live ride.");
  if (result.state === "too-soon") {
    return reply(429, "Points are arriving faster than this ride accepts them.", {
      "retry-after": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
    });
  }
  return Response.json({ ok: true, acceptedThrough: result.acceptedThrough }, { headers: HEADERS });
}

/** `POST /api/live/<rideId>/finish`: the rider ended the ride on purpose. */
export async function handleFinishLiveRide(
  request: Request,
  rideId: string,
  store: SQLiteLiveRideStore,
): Promise<Response> {
  const secret = ownerSecretOf(request);
  if (secret === null) return reply(401, "This call needs the live ride secret.");
  const result = store.finishRide(rideId, secret);
  if (result === "not-found") return reply(404, "This live ride does not exist or has ended.");
  if (result === "forbidden") return reply(403, "That secret does not belong to this live ride.");
  return Response.json({ ok: true, status: "finished" }, { headers: HEADERS });
}

/**
 * `GET /api/live/follow/<token>`: the whole public read. An unknown or expired
 * token is a 404 — a follower is never told the difference, and a finished ride
 * keeps answering until it expires.
 */
export async function handleFollowLiveRide(
  _request: Request,
  token: string,
  store: SQLiteLiveRideStore,
): Promise<Response> {
  const snapshot = store.followSnapshot(token);
  return snapshot === null
    ? reply(404, "This live ride does not exist or has ended.")
    : Response.json(snapshot, { headers: HEADERS });
}
