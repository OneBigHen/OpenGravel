import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LiveRouteGeometry } from "@/domain/live/types";
import {
  LIVE_POINT_MIN_INTERVAL_MS,
  SQLiteLiveRideStore,
  newFollowToken,
  newLiveRideId,
  newOwnerSecret,
  type LivePointInput,
  type LiveRideStoreOptions,
} from "@/server/live/live-ride-store";

/**
 * The live ride store's bounds, asserted directly: the public feature has no
 * account and no per-rider server, so the store is the thing that decides when a
 * ride is readable, how much of it is kept, and when a client has had its share.
 */

const stores: SQLiteLiveRideStore[] = [];

/** A mutable clock, so expiry and the push interval are facts, not sleeps. */
function clock(start = Date.UTC(2026, 9, 3, 15, 0, 0)) {
  let time = start;
  return {
    now: () => time,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

function store(options: LiveRideStoreOptions = {}): SQLiteLiveRideStore {
  const created = new SQLiteLiveRideStore(":memory:", options);
  stores.push(created);
  return created;
}

const OWNER = "a".repeat(64);

interface Created {
  readonly id: string;
  readonly token: string;
  readonly secret: string;
}

function create(target: SQLiteLiveRideStore, route: LiveRouteGeometry | null = null): Created {
  const ride = { id: newLiveRideId(), token: newFollowToken(), secret: newOwnerSecret() };
  const result = target.createRide({ ...ride, owner: OWNER, riderName: "Sam", route });
  expect(result).toEqual({ state: "created" });
  return ride;
}

/** `t` is relative to the store's clock, which the caller advances. */
function point(t: number, overrides: Partial<LivePointInput> = {}): LivePointInput {
  return {
    t,
    lat: 40.1 + (t % 1000) / 100_000,
    lon: -75.4 + (t % 1000) / 100_000,
    speed: t % 2 === 0 ? 12 : 11,
    heading: 90,
    accuracy: 8,
    battery: 0.62,
    ...overrides,
  };
}

afterEach(() => {
  for (const created of stores.splice(0)) created.close();
});

describe("live ride store", () => {
  it("creates a ride that reads back without its owner capability", () => {
    const time = clock();
    const target = store({ now: time.now });
    const route: LiveRouteGeometry = {
      segments: [[{ lon: -75.4, lat: 40.1 }, { lon: -75.41, lat: 40.2 }]],
    };
    const ride = create(target, route);
    const snapshot = target.followSnapshot(ride.token);
    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      riderName: "Sam",
      status: "riding",
      alert: null,
      last: null,
      trail: [],
      route,
    });
    expect(JSON.stringify(snapshot)).not.toContain(ride.secret);
  });

  it("hands the follow page plain objects a Server Component can pass on", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    target.appendPoints(ride.id, ride.secret, [point(time.now())]);
    const snapshot = target.followSnapshot(ride.token);
    expect(snapshot?.trail).toHaveLength(1);
    for (const value of [snapshot?.last, ...(snapshot?.trail ?? [])]) {
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    }
  });

  it("refuses writes with the wrong secret and reads for unknown tokens", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    expect(target.appendPoints(ride.id, newOwnerSecret(), [point(time.now())])).toEqual({ state: "forbidden" });
    expect(target.appendPoints("live_missing", ride.secret, [point(time.now())])).toEqual({ state: "not-found" });
    expect(target.finishRide(ride.id, newOwnerSecret())).toBe("forbidden");
    expect(target.finishRide("live_missing", ride.secret)).toBe("not-found");
    expect(target.followSnapshot("not-a-token")).toBeNull();
    expect(target.followSnapshot("A".repeat(22))).toBeNull();
  });

  it("accepts points once, deduplicates by t, and reports the newest accepted time", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    const t = time.now();
    const first = target.appendPoints(ride.id, ride.secret, [point(t), point(t + 1000)]);
    expect(first).toEqual({ state: "accepted", acceptedThrough: t + 1000 });

    time.advance(LIVE_POINT_MIN_INTERVAL_MS);
    const retry = target.appendPoints(ride.id, ride.secret, [point(t), point(t + 1000)]);
    expect(retry).toEqual({ state: "accepted", acceptedThrough: t + 1000 });

    const snapshot = target.followSnapshot(ride.token);
    expect(snapshot?.trail.map((entry) => entry.t)).toEqual([t, t + 1000]);
    expect(snapshot?.last).toMatchObject({ t: t + 1000, battery: 0.62 });
  });

  it("meters pushes to one call per three seconds per ride", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    expect(target.appendPoints(ride.id, ride.secret, [point(time.now())]).state).toBe("accepted");
    const blocked = target.appendPoints(ride.id, ride.secret, [point(time.now())]);
    expect(blocked).toEqual({ state: "too-soon", retryAfterMs: LIVE_POINT_MIN_INTERVAL_MS });
    time.advance(LIVE_POINT_MIN_INTERVAL_MS);
    expect(target.appendPoints(ride.id, ride.secret, [point(time.now())]).state).toBe("accepted");
  });

  it("thins the oldest points evenly when the point cap is passed", () => {
    const time = clock();
    const target = store({ now: time.now, pointsPerRide: 20 });
    const ride = create(target);
    const start = time.now();
    // One call of 25 points: five past the cap, so the oldest ten lose every
    // second point and the ride stays at exactly twenty.
    expect(
      target.appendPoints(ride.id, ride.secret, Array.from({ length: 25 }, (_, index) => point(start + index * 1000))).state,
    ).toBe("accepted");
    const trail = target.followSnapshot(ride.token)?.trail ?? [];
    expect(trail).toHaveLength(20);
    expect(trail.map((entry) => (entry.t - start) / 1000)).toEqual([
      0, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it("thins the follower's trail to the wire budget and keeps both ends", () => {
    const time = clock();
    const target = store({ now: time.now, trailPoints: 5 });
    const ride = create(target);
    const start = time.now();
    target.appendPoints(ride.id, ride.secret, Array.from({ length: 10 }, (_, index) => point(start + index * 1000)));
    const trail = target.followSnapshot(ride.token)?.trail ?? [];
    expect(trail).toHaveLength(5);
    expect(trail[0]?.t).toBe(start);
    expect(trail[trail.length - 1]?.t).toBe(start + 9000);
  });

  it("applies the rider's status and alert, and clears an alert when riding resumes", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    const t = time.now();
    target.appendPoints(ride.id, ride.secret, [point(t)], {
      alert: { reason: "possible-crash", at: t },
    });
    expect(target.followSnapshot(ride.token)).toMatchObject({
      status: "alert",
      alert: { reason: "possible-crash", at: t },
    });

    time.advance(LIVE_POINT_MIN_INTERVAL_MS);
    target.appendPoints(ride.id, ride.secret, [point(t + 1000)], { status: "paused" });
    expect(target.followSnapshot(ride.token)).toMatchObject({ status: "paused", alert: null });

    time.advance(LIVE_POINT_MIN_INTERVAL_MS);
    target.appendPoints(ride.id, ride.secret, [point(t + 2000)], { alert: null });
    expect(target.followSnapshot(ride.token)?.alert).toBeNull();
  });

  it("finishes a ride and keeps its last point readable", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    target.appendPoints(ride.id, ride.secret, [point(time.now())]);
    expect(target.finishRide(ride.id, ride.secret)).toBe("finished");
    expect(target.followSnapshot(ride.token)).toMatchObject({ status: "finished" });
    expect(target.followSnapshot(ride.token)?.last).not.toBeNull();
  });

  it("stops resolving a ride 24 hours after its last point, and prunes it on the next write", () => {
    const time = clock();
    const target = store({ now: time.now, capacity: 1, retentionMs: 60_000 });
    const ride = create(target);
    target.appendPoints(ride.id, ride.secret, [point(time.now())]);
    expect(target.followSnapshot(ride.token)).not.toBeNull();

    time.advance(60_001);
    expect(target.followSnapshot(ride.token)).toBeNull();
    // The expired ride no longer spends the disk budget.
    expect(create(target).token).not.toBe(ride.token);
    expect(target.followSnapshot(ride.token)).toBeNull();
  });

  it("counts a ride that never reported a point from its creation time", () => {
    const time = clock();
    const target = store({ now: time.now, retentionMs: 60_000 });
    const ride = create(target);
    time.advance(60_001);
    expect(target.followSnapshot(ride.token)).toBeNull();
  });

  it("caps live rides on disk", () => {
    const time = clock();
    const target = store({ now: time.now, capacity: 2 });
    create(target);
    create(target);
    const third = { id: newLiveRideId(), token: newFollowToken(), secret: newOwnerSecret() };
    expect(
      target.createRide({ ...third, owner: OWNER, riderName: "Kit", route: null }),
    ).toEqual({ state: "limited", reason: "capacity" });
  });

  it("caps ride creation per client address and leaves another client its own budget", () => {
    const time = clock();
    const target = store({ now: time.now, perOwnerPerHour: 2 });
    for (let index = 0; index < 2; index += 1) {
      const ride = { id: newLiveRideId(), token: newFollowToken(), secret: newOwnerSecret() };
      expect(target.createRide({ ...ride, owner: OWNER, riderName: "Sam", route: null })).toEqual({ state: "created" });
    }
    expect(
      target.createRide({
        id: newLiveRideId(),
        token: newFollowToken(),
        secret: newOwnerSecret(),
        owner: OWNER,
        riderName: "Sam",
        route: null,
      }),
    ).toEqual({ state: "limited", reason: "owner-hourly" });

    expect(
      target.createRide({
        id: newLiveRideId(),
        token: newFollowToken(),
        secret: newOwnerSecret(),
        owner: "b".repeat(64),
        riderName: "Kit",
        route: null,
      }),
    ).toEqual({ state: "created" });

    // The budget is a rolling hour, not a lifetime one.
    time.advance(3_600_001);
    expect(
      target.createRide({
        id: newLiveRideId(),
        token: newFollowToken(),
        secret: newOwnerSecret(),
        owner: OWNER,
        riderName: "Sam",
        route: null,
      }),
    ).toEqual({ state: "created" });
  });

  it("keeps a ride across a process restart, without storing the owner secret", () => {
    const directory = mkdtempSync(join(tmpdir(), "og-live-unit-"));
    const path = join(directory, "live.sqlite");
    const time = clock();
    let target = new SQLiteLiveRideStore(path, { now: time.now });
    try {
      const ride = create(target);
      target.appendPoints(ride.id, ride.secret, [point(time.now())]);
      target.close();
      target = new SQLiteLiveRideStore(path, { now: time.now });
      expect(target.followSnapshot(ride.token)).toMatchObject({ riderName: "Sam", status: "riding" });
      expect(target.appendPoints(ride.id, ride.secret, [point(time.now() + 1)]).state).toBe("too-soon");
      time.advance(LIVE_POINT_MIN_INTERVAL_MS);
      expect(target.appendPoints(ride.id, ride.secret, [point(time.now() + 1)]).state).toBe("accepted");
      expect(target.finishRide(ride.id, ride.secret)).toBe("finished");

      // The write capability is stored only as a hash.
      const bytes = readFileSync(path).toString("latin1");
      expect(bytes).not.toContain(ride.secret);
    } finally {
      target.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the trail's speed and drops only what it does not store", () => {
    const time = clock();
    const target = store({ now: time.now });
    const ride = create(target);
    const t = time.now();
    const bare = point(t, { speed: null, heading: null, accuracy: null, battery: null });
    target.appendPoints(ride.id, ride.secret, [bare]);
    const snapshot = target.followSnapshot(ride.token);
    expect(snapshot?.last).toEqual({
      t,
      lat: bare.lat,
      lon: bare.lon,
      speed: null,
      heading: null,
      accuracy: null,
      battery: null,
    });
    expect(snapshot?.trail).toEqual([{ t, lat: bare.lat, lon: bare.lon, speed: null }]);
  });
});
