import { afterEach, describe, expect, it } from "vitest";

import { handleCreateLiveRideRequest } from "@/app/api/live/route";
import type { LiveFollowSnapshot } from "@/domain/live/types";
import {
  handleAppendLivePoints,
  handleCreateLiveRide,
  handleFinishLiveRide,
  handleFollowLiveRide,
} from "@/server/live/handler";
import {
  SQLiteLiveRideStore,
  type LivePointInput,
  type LiveRideStoreOptions,
} from "@/server/live/live-ride-store";

/**
 * The live ride HTTP boundary: what it accepts, what it refuses, and what a
 * follower is allowed to read. Every validation here exists because the endpoint
 * is public and unauthenticated on the read side.
 */

const stores: SQLiteLiveRideStore[] = [];

function clock(start = Date.UTC(2026, 9, 3, 15, 0, 0)) {
  let time = start;
  return { now: () => time, advance: (ms: number) => { time += ms; } };
}

function store(options: LiveRideStoreOptions = {}): SQLiteLiveRideStore {
  const created = new SQLiteLiveRideStore(":memory:", options);
  stores.push(created);
  return created;
}

const ENV = { OGV_PUBLIC_ORIGIN: "https://opengravel.example/" };

interface Handles {
  readonly rideId: string;
  readonly followToken: string;
  readonly ownerSecret: string;
  readonly followUrl: string;
}

async function startRide(
  target: SQLiteLiveRideStore,
  now: () => number,
  body: Record<string, unknown> = { riderName: "Sam" },
  address = "203.0.113.7",
): Promise<Handles> {
  const response = await handleCreateLiveRide(
    new Request("https://live.test/api/live", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": address },
      body: JSON.stringify(body),
    }),
    target,
    { now, env: ENV },
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Handles;
}

function points(handles: Handles, entries: readonly LivePointInput[], extra: Record<string, unknown> = {}, secret = handles.ownerSecret): Request {
  return new Request(`https://live.test/api/live/${handles.rideId}/points`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-live-secret": secret },
    body: JSON.stringify({ points: entries, ...extra }),
  });
}

function point(t: number, overrides: Partial<LivePointInput> = {}): LivePointInput {
  return {
    t,
    lat: 40.1,
    lon: -75.4,
    speed: 17,
    heading: 90,
    accuracy: 8,
    battery: 0.62,
    ...overrides,
  };
}

/** One points call, with the test's clock so the freshness window is real. */
function append(
  target: SQLiteLiveRideStore,
  handles: Handles,
  request: Request,
  now: () => number,
): Promise<Response> {
  return handleAppendLivePoints(request, handles.rideId, target, { now });
}

async function followed(target: SQLiteLiveRideStore, handles: Handles): Promise<LiveFollowSnapshot> {
  const response = await handleFollowLiveRide(new Request(`https://live.test/api/live/follow/${handles.followToken}`), handles.followToken, target);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  return (await response.json()) as LiveFollowSnapshot;
}

afterEach(() => {
  for (const created of stores.splice(0)) created.close();
});

describe("live ride creation", () => {
  it("answers with the ride id, follow token, owner secret and a follow URL on the deployment origin", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now);
    expect(handles.rideId).toMatch(/^live_[0-9a-f]{32}$/);
    expect(handles.followToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(handles.ownerSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handles.followUrl).toBe(`https://opengravel.example/follow/${handles.followToken}`);
    expect(await followed(target, handles)).toMatchObject({ riderName: "Sam", status: "riding", last: null, trail: [] });
  });

  it("falls back to the request's own host when no public origin is declared", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const response = await handleCreateLiveRide(
      new Request("https://live.test/api/live", {
        method: "POST",
        headers: { "content-type": "application/json", host: "live.test" },
        body: JSON.stringify({ riderName: "Sam" }),
      }),
      target,
      { now: time.now, env: {} },
    );
    const body = (await response.json()) as Handles;
    expect(body.followUrl).toBe(`https://live.test/follow/${body.followToken}`);
  });

  it("trims a rider name and refuses an empty, over-long or control-character one", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now, { riderName: "  Sam  " });
    expect((await followed(target, handles)).riderName).toBe("Sam");

    for (const riderName of ["", "   ", "x".repeat(41), "Sam\nSmith", 42, null]) {
      const response = await handleCreateLiveRide(
        new Request("https://live.test/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ riderName }),
        }),
        target,
        { now: time.now, env: ENV },
      );
      expect(response.status, String(riderName)).toBe(400);
      expect(await response.json()).toMatchObject({ message: expect.any(String) });
    }
  });

  it("stores a planned route, flat or segmented, and refuses geometry that is not a line", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const flat = await startRide(target, time.now, {
      riderName: "Sam",
      route: [{ lat: 40.1, lon: -75.4 }, { lat: 40.2, lon: -75.41 }],
    });
    expect((await followed(target, flat)).route).toEqual({
      segments: [[{ lon: -75.4, lat: 40.1 }, { lon: -75.41, lat: 40.2 }]],
    });

    const segmented = await startRide(target, time.now, {
      riderName: "Kit",
      route: {
        segments: [
          [{ lat: 40.1, lon: -75.4 }, { lat: 40.2, lon: -75.41 }],
          [{ lat: 40.3, lon: -75.42 }, { lat: 40.4, lon: -75.43 }],
        ],
      },
    });
    expect((await followed(target, segmented)).route?.segments).toHaveLength(2);

    const tooMany = Array.from({ length: 5_001 }, (_, index) => ({ lat: 40 + index * 0.00001, lon: -75.4 }));
    for (const route of [
      [{ lat: 40.1, lon: -75.4 }],
      [{ lat: 91, lon: -75.4 }, { lat: 40.2, lon: -75.41 }],
      [{ lat: 40.1, lon: -181 }, { lat: 40.2, lon: -75.41 }],
      [{ lat: 40.1, lon: -75.4 }, { lat: "40.2", lon: -75.41 }],
      { segments: [] },
      { segments: [[{ lat: 40.1, lon: -75.4 }]] },
      tooMany,
    ]) {
      const response = await handleCreateLiveRide(
        new Request("https://live.test/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ riderName: "Sam", route }),
        }),
        target,
        { now: time.now, env: ENV },
      );
      expect(response.status, JSON.stringify(route).slice(0, 80)).toBe(400);
    }
  });

  it("refuses a body that is not JSON or is too large", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const text = await handleCreateLiveRide(
      new Request("https://live.test/api/live", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ riderName: "Sam" }),
      }),
      target,
      { now: time.now, env: ENV },
    );
    expect(text.status).toBe(400);

    const huge = await handleCreateLiveRide(
      new Request("https://live.test/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ riderName: "Sam", padding: "x".repeat(600 * 1024) }),
      }),
      target,
      { now: time.now, env: ENV },
    );
    expect(huge.status).toBe(413);
  });
});

describe("live ride points", () => {
  it("requires the owner secret and the ride it belongs to", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now);
    expect((await append(target, handles, points(handles, [point(time.now())], {}, ""), time.now)).status).toBe(401);
    expect((await append(target, handles, points(handles, [point(time.now())], {}, "wrong-secret"), time.now)).status).toBe(403);
    const missing = { ...handles, rideId: "live_00000000000000000000000000000000" };
    expect((await append(target, missing, points(missing, [point(time.now())]), time.now)).status).toBe(404);
  });

  it("accepts one batch, reports the newest accepted time, and meters the next call", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now);
    const t = time.now();
    const accepted = await append(target, handles, points(handles, [point(t), point(t + 1000, { speed: null })]), time.now);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, acceptedThrough: t + 1000 });

    const blocked = await append(target, handles, points(handles, [point(t + 2000)]), time.now);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3");

    time.advance(3_000);
    expect((await append(target, handles, points(handles, [point(t + 2000)]), time.now)).status).toBe(200);
  });

  it("refuses stale, future, too many and malformed points", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now);
    const now = time.now();
    const invalid: unknown[] = [
      [point(now - 7 * 3_600_000)],
      [point(now + 3 * 60_000)],
      Array.from({ length: 121 }, (_, index) => point(now + index)),
      [],
      [point(now, { lat: 100 })],
      [point(now, { lon: 200 })],
      [point(now, { speed: -1 })],
      [point(now, { speed: 500 })],
      [point(now, { heading: 361 })],
      [point(now, { battery: 1.5 })],
      [point(now, { accuracy: 20_000 })],
      [{ ...point(now), t: 1.5 }],
      [{ lat: 40, lon: -75 }],
    ];
    for (const entries of invalid) {
      const request = new Request(`https://live.test/api/live/${handles.rideId}/points`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-live-secret": handles.ownerSecret },
        body: JSON.stringify({ points: entries }),
      });
      expect((await append(target, handles, request, time.now)).status, JSON.stringify(entries).slice(0, 80)).toBe(400);
    }
    expect((await followed(target, handles)).trail).toEqual([]);
  });

  it("raises the rider's alert, clears it, and refuses a reason or status it does not know", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now);
    const t = time.now();
    expect(
      (await append(target, handles, points(handles, [point(t)], { alert: { reason: "possible-crash" } }), time.now)).status,
    ).toBe(200);
    expect(await followed(target, handles)).toMatchObject({
      status: "alert",
      alert: { reason: "possible-crash", at: t },
    });

    time.advance(3_000);
    const cleared = await append(target, handles, points(handles, [point(t + 1000)], { alert: null }), time.now);
    expect(cleared.status).toBe(200);
    expect((await followed(target, handles)).alert).toBeNull();
    // Clearing the alert says the rider is riding again, not still alerting.
    expect((await followed(target, handles)).status).toBe("riding");

    const badReason = await append(target, handles, points(handles, [point(t + 2000)], { alert: { reason: "hungry" } }), time.now);
    expect(badReason.status).toBe(400);
    const noReason = await append(target, handles, points(handles, [point(t + 2000)], { status: "alert" }), time.now);
    expect(noReason.status).toBe(400);
    const conflict = await append(
      target,
      handles,
      points(handles, [point(t + 2000)], { alert: { reason: "sos" }, status: "paused" }),
      time.now,
    );
    expect(conflict.status).toBe(400);
  });
});

describe("finishing and following", () => {
  it("finishes a ride and keeps the last known position readable", async () => {
    const time = clock();
    const target = store({ now: time.now });
    const handles = await startRide(target, time.now);
    await append(target, handles, points(handles, [point(time.now())]), time.now);
    const request = (secret: string) =>
      new Request(`https://live.test/api/live/${handles.rideId}/finish`, {
        method: "POST",
        headers: { "x-live-secret": secret },
      });
    expect((await handleFinishLiveRide(request("wrong-secret"), handles.rideId, target)).status).toBe(403);
    const finished = await handleFinishLiveRide(request(handles.ownerSecret), handles.rideId, target);
    expect(finished.status).toBe(200);
    expect(await finished.json()).toEqual({ ok: true, status: "finished" });
    expect(await followed(target, handles)).toMatchObject({ status: "finished", last: { speed: 17 } });
  });

  it("answers 404 for an unknown, malformed or expired token", async () => {
    const time = clock();
    const target = store({ now: time.now, retentionMs: 60_000 });
    const handles = await startRide(target, time.now);
    await append(target, handles, points(handles, [point(time.now())]), time.now);
    for (const token of ["", "nope", "A".repeat(21), "A".repeat(22)]) {
      const response = await handleFollowLiveRide(new Request("https://live.test/api/live/follow/x"), token, target);
      expect(response.status, token).toBe(404);
      expect(await response.json()).toMatchObject({ message: expect.any(String) });
    }
    time.advance(60_001);
    expect((await handleFollowLiveRide(new Request("https://live.test"), handles.followToken, target)).status).toBe(404);
  });
});

describe("live ride creation is metered per client address", () => {
  const create = (address: string, forwarded: string) =>
    new Request("https://live.test/api/live", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": address,
        "x-forwarded-for": forwarded,
      },
      body: JSON.stringify({ riderName: "Sam" }),
    });

  it("answers the eleventh ride from one address with 429 even when x-forwarded-for is forged", async () => {
    const target = store({ perOwnerPerHour: 1_000 });
    for (let index = 0; index < 10; index += 1) {
      expect((await handleCreateLiveRideRequest(create("198.51.100.42", `10.0.0.${index}`), target)).status).toBe(201);
    }
    const overflow = await handleCreateLiveRideRequest(create("198.51.100.42", "10.0.0.99"), target);
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await overflow.json()).toMatchObject({ message: expect.stringMatching(/too many live rides/i) });
    // Another address has its own budget.
    expect((await handleCreateLiveRideRequest(create("198.51.100.43", "10.0.0.1"), target)).status).toBe(201);
  });
});
