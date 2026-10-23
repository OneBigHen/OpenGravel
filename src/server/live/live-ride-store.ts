/**
 * The live ride store: what one rider broadcasts, and what a loved one may read.
 *
 * SQLite (`node:sqlite`), one file, the same shape as the public-share store
 * (`src/server/sharing/public-share-store.ts`): a durable row on disk, a random
 * public handle, and an owner capability that never leaves the server. The four
 * bounds below are what keep a free, unauthenticated feature from filling the
 * disk or being used as a free tracking service:
 *
 * - **A ride expires 24 h after its last point.** Expired rides are pruned on
 *   every write, and an expired token stops resolving even before it is pruned,
 *   so a link cannot outlive the ride it names.
 * - **20,000 points per ride, thinned oldest-first.** Past the cap, the oldest
 *   points are spaced out evenly rather than truncated: the start of a long ride
 *   stays visible as a coarser line, and the end — where the rider is — keeps
 *   full detail.
 * - **200 live rides on disk.** A new ride is refused once the disk budget is
 *   spent (expired rides are pruned first, so this is a live bound, not a
 *   lifetime one).
 * - **10 rides per client per rolling hour.** Keyed on a hash of the client
 *   address the reverse proxy reported, so one browser cannot spend the disk
 *   budget for everyone.
 *
 * The follower's read is thinned again (1,500 points) because a follower's phone
 * draws a line, not an archive.
 *
 * The owner secret is stored only as a SHA-256 hash, and is compared in constant
 * time. It authorises writing points to one ride and nothing else.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  LiveAlert,
  LiveAlertReason,
  LiveFollowSnapshot,
  LivePoint,
  LiveRideStatus,
  LiveRouteGeometry,
  LiveTrailPoint,
} from "@/domain/live/types";
import { thinEvenly } from "./thinning";

/** Rides allowed on disk (after expired ones are pruned). */
export const LIVE_RIDE_CAPACITY = 200;
/** Rides one client address may create per rolling hour. */
export const LIVE_RIDES_PER_OWNER_PER_HOUR = 10;
/** How long a ride stays readable after its last point. */
export const LIVE_RIDE_RETENTION_MS = 24 * 3_600_000;
/** Points kept per ride; the oldest are thinned to stay under this. */
export const LIVE_POINTS_PER_RIDE = 20_000;
/** Trail points one follower read may carry. */
export const LIVE_TRAIL_POINTS = 1_500;
/** One points call per ride per this interval. */
export const LIVE_POINT_MIN_INTERVAL_MS = 3_000;
/** Points one call may carry. */
export const LIVE_MAX_POINTS_PER_CALL = 120;
/** A point older than this is refused: the ride is about now, not history. */
export const LIVE_POINT_MAX_AGE_MS = 6 * 3_600_000;
/** A point this far in the future is a clock problem, not a position. */
export const LIVE_POINT_MAX_FUTURE_MS = 2 * 60_000;
/** Planned-route positions one ride may carry. */
export const LIVE_MAX_ROUTE_POINTS = 5_000;

const HOUR_MS = 3_600_000;
/** 128 random bits, base64url: the public handle in a follow link. */
const FOLLOW_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/** The shape `newOwnerSecret()` produces; anything else cannot match a stored hash. */
const OWNER_SECRET = /^[A-Za-z0-9_-]{20,64}$/;

export interface CreateLiveRideInput {
  readonly id: string;
  readonly token: string;
  /** The raw owner secret. Only its hash is written. */
  readonly secret: string;
  /** A hash of the client key, never the address itself. */
  readonly owner: string;
  readonly riderName: string;
  readonly route: LiveRouteGeometry | null;
}

export type CreateLiveRideResult =
  | { readonly state: "created" }
  /**
   * `owner-hourly` is this client's own budget; `capacity` is the disk budget,
   * which the rider cannot fix by waiting a few minutes.
   */
  | { readonly state: "limited"; readonly reason: "owner-hourly" | "capacity" };

/** What one points call also says about the ride itself. */
export interface LivePointChange {
  /** The rider's own status, when the call reports one. */
  readonly status?: LiveRideStatus;
  /** The alert to raise, or `null` to clear one the rider says is over. */
  readonly alert?: LiveAlert | null;
}

/** The points a call offers, already validated by the handler. */
export interface LivePointInput {
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  readonly speed: number | null;
  readonly heading: number | null;
  readonly accuracy: number | null;
  readonly battery: number | null;
}

export type AppendLivePointsResult =
  | { readonly state: "accepted"; readonly acceptedThrough: number }
  | { readonly state: "not-found" }
  | { readonly state: "forbidden" }
  | { readonly state: "too-soon"; readonly retryAfterMs: number };

export type FinishLiveRideResult = "finished" | "not-found" | "forbidden";

export interface LiveRideStoreOptions {
  readonly now?: () => number;
  readonly capacity?: number;
  readonly perOwnerPerHour?: number;
  readonly retentionMs?: number;
  readonly pointsPerRide?: number;
  readonly trailPoints?: number;
  readonly minIntervalMs?: number;
}

/** 128 random bits, as the base64url text a follow link carries. */
export function newFollowToken(): string {
  return randomBytes(16).toString("base64url");
}

/** 256 random bits, as the write capability the rider's own screen holds. */
export function newOwnerSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** `live_…`: a stable ride id, distinct from a share id or a route id. */
export function newLiveRideId(): string {
  return `live_${randomBytes(16).toString("hex")}`;
}

/** The stored form of an owner secret: a SHA-256 digest, never the secret. */
export function liveSecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** True when `secret` is the capability behind `storedHash`, in constant time. */
function secretMatches(secret: string, storedHash: string): boolean {
  if (!OWNER_SECRET.test(secret)) return false;
  const given = Buffer.from(liveSecretHash(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

interface RideRow {
  readonly id: string;
  readonly rider_name: string;
  readonly route: string | null;
  readonly status: string;
  readonly alert_reason: string | null;
  readonly alert_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly last_point_at: number | null;
  readonly last_push_at: number;
  readonly secret_hash: string;
}

interface PointRow {
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  readonly speed: number | null;
  readonly heading: number | null;
  readonly accuracy: number | null;
  readonly battery: number | null;
}

/** The durable half of the live ride feature: rides, their points and their budgets. */
export class SQLiteLiveRideStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  readonly #capacity: number;
  readonly #perOwnerPerHour: number;
  readonly #retentionMs: number;
  readonly #pointsPerRide: number;
  readonly #trailPoints: number;
  readonly #minIntervalMs: number;

  constructor(path: string, options: LiveRideStoreOptions = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#now = options.now ?? Date.now;
    this.#capacity = options.capacity ?? LIVE_RIDE_CAPACITY;
    this.#perOwnerPerHour = options.perOwnerPerHour ?? LIVE_RIDES_PER_OWNER_PER_HOUR;
    this.#retentionMs = options.retentionMs ?? LIVE_RIDE_RETENTION_MS;
    this.#pointsPerRide = options.pointsPerRide ?? LIVE_POINTS_PER_RIDE;
    this.#trailPoints = options.trailPoints ?? LIVE_TRAIL_POINTS;
    this.#minIntervalMs = options.minIntervalMs ?? LIVE_POINT_MIN_INTERVAL_MS;
    this.#db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS live_rides (
        id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL,
        owner TEXT NOT NULL, rider_name TEXT NOT NULL, route TEXT,
        status TEXT NOT NULL, alert_reason TEXT, alert_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_point_at INTEGER,
        last_push_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS live_points (
        ride_id TEXT NOT NULL, t INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
        speed REAL, heading REAL, accuracy REAL, battery REAL,
        PRIMARY KEY (ride_id, t)
      );
      CREATE INDEX IF NOT EXISTS live_points_ride_t ON live_points(ride_id, t);
      CREATE TABLE IF NOT EXISTS live_creations (owner TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS live_creations_owner ON live_creations(owner, created_at);
      CREATE INDEX IF NOT EXISTS live_rides_created ON live_rides(created_at);`);
  }

  /**
   * Persists one ride if this client and the disk still have room.
   *
   * Expired rides are pruned before either budget is counted, so a rider who
   * stopped riding yesterday has not spent today's capacity.
   */
  createRide(input: CreateLiveRideInput): CreateLiveRideResult {
    const now = this.#now();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#prune(now);
      const mine = this.#db
        .prepare("SELECT COUNT(*) AS n FROM live_creations WHERE owner=? AND created_at>?")
        .get(input.owner, now - HOUR_MS) as { n: number };
      if (mine.n >= this.#perOwnerPerHour) {
        this.#db.exec("ROLLBACK");
        return { state: "limited", reason: "owner-hourly" };
      }
      const live = this.#db.prepare("SELECT COUNT(*) AS n FROM live_rides").get() as { n: number };
      if (live.n >= this.#capacity) {
        this.#db.exec("ROLLBACK");
        return { state: "limited", reason: "capacity" };
      }
      this.#db
        .prepare(`INSERT INTO live_rides
          (id,token,secret_hash,owner,rider_name,route,status,alert_reason,alert_at,created_at,updated_at,last_point_at,last_push_at)
          VALUES(?,?,?,?,?,?,'riding',NULL,NULL,?,?,NULL,0)`)
        .run(input.id, input.token, liveSecretHash(input.secret), input.owner, input.riderName,
          input.route === null ? null : JSON.stringify(input.route), now, now);
      this.#db.prepare("INSERT INTO live_creations(owner,created_at) VALUES(?,?)").run(input.owner, now);
      this.#db.exec("COMMIT");
      return { state: "created" };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Appends one call's points to a ride the secret belongs to.
   *
   * Points are deduplicated by `t` (a retried call writes nothing new), the
   * call's own status/alert is applied when it carries one, and the ride is
   * thinned back under the point cap. One call per ride per
   * `minIntervalMs` — measured against the last accepted call, not the last
   * point, because the budget is about requests.
   */
  appendPoints(
    rideId: string,
    secret: string,
    points: readonly LivePointInput[],
    change: LivePointChange = {},
  ): AppendLivePointsResult {
    const now = this.#now();
    const ride = this.#rideById(rideId);
    if (ride === undefined) return { state: "not-found" };
    if (!secretMatches(secret, ride.secret_hash)) return { state: "forbidden" };
    const wait = ride.last_push_at + this.#minIntervalMs - now;
    if (wait > 0) return { state: "too-soon", retryAfterMs: wait };
    const accepted = points.reduce((latest, point) => Math.max(latest, point.t), Number.NEGATIVE_INFINITY);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.#db.prepare(
        "INSERT OR IGNORE INTO live_points(ride_id,t,lat,lon,speed,heading,accuracy,battery) VALUES(?,?,?,?,?,?,?,?)",
      );
      for (const point of points) {
        insert.run(rideId, point.t, point.lat, point.lon, point.speed, point.heading, point.accuracy, point.battery);
      }
      const status = change.alert !== undefined && change.alert !== null
        ? "alert"
        : change.status ?? ride.status;
      const alert = change.alert !== undefined
        ? change.alert
        : change.status !== undefined
          ? null
          : ride.alert_reason === null
            ? null
            : { reason: ride.alert_reason as LiveAlertReason, at: ride.alert_at ?? ride.updated_at };
      this.#db
        .prepare(`UPDATE live_rides SET status=?, alert_reason=?, alert_at=?, updated_at=?,
            last_point_at=MAX(COALESCE(last_point_at, 0), ?), last_push_at=? WHERE id=?`)
        .run(status, alert === null ? null : alert.reason, alert === null ? null : alert.at,
          now, Number.isFinite(accepted) ? accepted : now, now, rideId);
      this.#thin(rideId);
      this.#prune(now);
      this.#db.exec("COMMIT");
      return { state: "accepted", acceptedThrough: this.#acceptedThrough(rideId, accepted) };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Ends a ride the secret belongs to. The last point stays readable. */
  finishRide(rideId: string, secret: string): FinishLiveRideResult {
    const ride = this.#rideById(rideId);
    if (ride === undefined) return "not-found";
    if (!secretMatches(secret, ride.secret_hash)) return "forbidden";
    const now = this.#now();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare("UPDATE live_rides SET status='finished', alert_reason=NULL, alert_at=NULL, updated_at=? WHERE id=?")
        .run(now, rideId);
      this.#prune(now);
      this.#db.exec("COMMIT");
      return "finished";
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * The public read: everything a follower may see for one token, or `null` for
   * an unknown or expired one. An expired token stops resolving even before its
   * row is pruned, so a link cannot outlive its ride.
   */
  followSnapshot(token: string): LiveFollowSnapshot | null {
    if (!FOLLOW_TOKEN.test(token)) return null;
    const row = this.#db
      .prepare(`SELECT id,rider_name,route,status,alert_reason,alert_at,created_at,updated_at,last_point_at,last_push_at
        FROM live_rides WHERE token=?`)
      .get(token) as Omit<RideRow, "secret_hash"> | undefined;
    if (row === undefined) return null;
    const now = this.#now();
    if ((row.last_point_at ?? row.created_at) < now - this.#retentionMs) return null;
    const last = this.#db
      .prepare("SELECT t,lat,lon,speed,heading,accuracy,battery FROM live_points WHERE ride_id=? ORDER BY t DESC LIMIT 1")
      .get(row.id) as PointRow | undefined;
    const trail = this.#db
      .prepare("SELECT t,lat,lon,speed FROM live_points WHERE ride_id=? ORDER BY t")
      .all(row.id) as unknown as LiveTrailPoint[];
    return {
      riderName: row.rider_name,
      status: row.status as LiveRideStatus,
      alert: row.alert_reason === null
        ? null
        : { reason: row.alert_reason as LiveAlertReason, at: row.alert_at ?? row.updated_at },
      updatedAt: row.updated_at,
      last: last === undefined ? null : pointOf(last),
      trail: thinEvenly(trail, this.#trailPoints),
      route: row.route === null ? null : (JSON.parse(row.route) as LiveRouteGeometry),
    };
  }

  close(): void {
    this.#db.close();
  }

  #rideById(rideId: string): RideRow | undefined {
    return this.#db
      .prepare(`SELECT id,rider_name,route,status,alert_reason,alert_at,created_at,updated_at,last_point_at,last_push_at,secret_hash
        FROM live_rides WHERE id=?`)
      .get(rideId) as RideRow | undefined;
  }

  #acceptedThrough(rideId: string, fallback: number): number {
    const row = this.#db.prepare("SELECT MAX(t) AS t FROM live_points WHERE ride_id=?").get(rideId) as
      | { t: number | null }
      | undefined;
    return row?.t ?? (Number.isFinite(fallback) ? fallback : this.#now());
  }

  /**
   * Thins the oldest points back under the cap: the oldest `2 × excess` points
   * lose every second one, so exactly `excess` are removed and the oldest stretch
   * keeps its line at half the detail instead of losing its beginning.
   *
   * The window is `2 × excess` wide, which one call can never push into the newest
   * points: a call adds at most 120 points to a 20,000-point ride, so the newest
   * stretch — where the rider is — is not thinned.
   */
  #thin(rideId: string): void {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM live_points WHERE ride_id=?").get(rideId) as { n: number };
    const excess = row.n - this.#pointsPerRide;
    if (excess <= 0) return;
    const oldest = this.#db
      .prepare("SELECT t FROM live_points WHERE ride_id=? ORDER BY t LIMIT ?")
      .all(rideId, excess * 2) as unknown as { t: number }[];
    const remove = this.#db.prepare("DELETE FROM live_points WHERE ride_id=? AND t=?");
    oldest.forEach((point, index) => {
      if (index % 2 === 1) remove.run(rideId, point.t);
    });
  }

  /** Drops expired rides, their points, and creation-budget rows past an hour. */
  #prune(now: number): void {
    const cutoff = now - this.#retentionMs;
    this.#db
      .prepare(`DELETE FROM live_points WHERE ride_id IN
        (SELECT id FROM live_rides WHERE COALESCE(last_point_at, created_at) < ?)`)
      .run(cutoff);
    this.#db.prepare("DELETE FROM live_rides WHERE COALESCE(last_point_at, created_at) < ?").run(cutoff);
    this.#db.prepare("DELETE FROM live_creations WHERE created_at < ?").run(now - HOUR_MS);
  }
}

function pointOf(row: PointRow): LivePoint {
  return {
    t: row.t,
    lat: row.lat,
    lon: row.lon,
    speed: row.speed,
    heading: row.heading,
    accuracy: row.accuracy,
    battery: row.battery,
  };
}

let shared: SQLiteLiveRideStore | undefined;

/** The process-wide store. `OGV_LIVE_DB_PATH` is the deployment's own file. */
export function liveRideStore(): SQLiteLiveRideStore {
  return shared ??= new SQLiteLiveRideStore(
    process.env.OGV_LIVE_DB_PATH?.trim() || resolve(process.cwd(), "data/live.sqlite"),
  );
}
