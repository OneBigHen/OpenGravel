/**
 * The rider's side of "Follow my ride": start a link, stream positions in
 * batches, raise and clear an alert, finish, and keep sharing across a reload.
 *
 * Everything the session touches is injected, so these tests drive the real
 * session against a scripted server, a fake clock and fake timers. What they
 * assert is what leaves the device: the URL, the batching, the owner secret in
 * the header, and what survives a dead zone (the buffer) versus what does not
 * (a link the server has ended).
 */

import { describe, expect, it } from "vitest";

import {
  createLiveShareSession,
  LIVE_BATCH_POINTS,
  LIVE_BUFFER_MAX,
  LIVE_MIN_POINT_GAP_MS,
  LIVE_SEND_INTERVAL_MS,
  type LiveShareDeps,
  type LiveShareSession,
} from "@/application/live/live-share";
import type { LiveAlertReason, LivePoint } from "@/domain/live/types";

const NOW = Date.UTC(2026, 9, 3, 16, 0, 0);
const LAT = 45.5;
const LON = -122.6;
const CREATED = Object.freeze({
  rideId: "live_1",
  ownerSecret: "owner-secret-1",
  followUrl: "https://opengravel.example/follow/tok_1",
});

interface HttpCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

type Responder = (call: HttpCall) => Response;

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** One buffered point from one GPS fix, as the session will send it. */
function fix(atMs: number, overrides: Partial<Parameters<LiveShareSession["accept"]>[0]> = {}) {
  return { atMs, lat: LAT, lon: LON, speedMps: 12, headingDeg: 90, accuracyM: 5, ...overrides };
}

function point(atMs: number): LivePoint {
  return { t: atMs, lat: LAT, lon: LON, speed: 12, heading: 90, accuracy: 5, battery: 0.8 };
}

function pointsOf(call: HttpCall | undefined): LivePoint[] {
  return (call?.body.points ?? []) as LivePoint[];
}

/** Let every pending microtask of an interval send settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface SetupOptions {
  readonly stored?: string | null;
  readonly responder?: Responder;
}

function setup(options: SetupOptions = {}) {
  const calls: HttpCall[] = [];
  let responder: Responder = options.responder ?? (() => jsonResponse(201, CREATED));
  let stored = options.stored ?? null;
  const writes: (string | null)[] = [];
  let nowMs = NOW;
  let nextHandle = 1;
  const intervals = new Map<number, () => void>();
  const delays: number[] = [];

  const deps: LiveShareDeps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: HttpCall = {
        url,
        method: init?.method ?? "GET",
        headers,
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      };
      calls.push(call);
      return await responder(call);
    }) as unknown as typeof fetch,
    now: () => nowMs,
    setInterval: (work, ms) => {
      const handle = nextHandle;
      nextHandle += 1;
      intervals.set(handle, work);
      delays.push(ms);
      return handle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number);
    },
    storage: {
      read: () => stored,
      write: (value) => {
        stored = value;
        writes.push(value);
      },
    },
    battery: () => 0.8,
  };

  const session = createLiveShareSession(deps);

  return {
    session,
    calls,
    writes,
    delays,
    setResponder(next: Responder) {
      responder = next;
    },
    get stored(): string | null {
      return stored;
    },
    /** Everything after the link was created, in the order it left the device. */
    posts: () => calls.filter((call) => call.url !== "/api/live"),
    intervalCount: () => intervals.size,
    nowMs: () => nowMs,
    advanceClock(ms: number) {
      nowMs += ms;
    },
    /** Fire the send interval (as the browser would) and let the send settle. */
    async tick() {
      for (const work of [...intervals.values()]) work();
      await flush();
    },
  };
}

/** A started session whose link already exists. */
async function sharing(options: SetupOptions = {}) {
  const harness = setup(options);
  const url = await harness.session.start({ riderName: "Sam" });
  expect(url).toBe(CREATED.followUrl);
  return harness;
}

describe("starting a live link", () => {
  it("creates the link on the server and keeps its credentials", async () => {
    const harness = setup();
    const url = await harness.session.start({ riderName: "Sam" });

    expect(url).toBe(CREATED.followUrl);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.url).toBe("/api/live");
    expect(harness.calls[0]?.method).toBe("POST");
    expect(harness.calls[0]?.body).toEqual({ riderName: "Sam" });
    expect(harness.session.snapshot()).toEqual({
      status: "sharing",
      followUrl: CREATED.followUrl,
      alert: null,
      lastSentAt: null,
      pending: 0,
      error: null,
    });
    expect(JSON.parse(harness.stored ?? "null")).toEqual({ credentials: CREATED, buffer: [], alert: null });
  });

  it("arms one send interval at the documented cadence", async () => {
    const harness = await sharing();
    expect(harness.intervalCount()).toBe(1);
    expect(harness.delays).toEqual([LIVE_SEND_INTERVAL_MS]);
  });

  it("sends the planned route only when the rider shared one", async () => {
    const route = { segments: [[{ lon: LON, lat: LAT }]] };
    const harness = setup();
    await harness.session.start({ riderName: "Sam", route });
    expect(harness.calls[0]?.body).toEqual({ riderName: "Sam", route });
  });

  it("reuses the existing link instead of creating a second one", async () => {
    const harness = await sharing();
    await expect(harness.session.start({ riderName: "Someone else" })).resolves.toBe(CREATED.followUrl);
    expect(harness.calls).toHaveLength(1);
  });

  it("reports the server's refusal and stays off", async () => {
    const harness = setup({
      responder: () => jsonResponse(400, { error: { message: "Rider name is required." } }),
    });
    await expect(harness.session.start({ riderName: "" })).resolves.toBeNull();
    expect(harness.session.snapshot()).toMatchObject({
      status: "error",
      followUrl: null,
      error: "Rider name is required.",
    });
    expect(harness.intervalCount()).toBe(0);
  });

  it("reports a dead network without leaving a half-started link", async () => {
    const harness = setup({
      responder: () => {
        throw new Error("offline");
      },
    });
    await expect(harness.session.start({ riderName: "Sam" })).resolves.toBeNull();
    expect(harness.session.snapshot().status).toBe("error");
    expect(harness.session.snapshot().error).toContain("No signal");
    expect(harness.intervalCount()).toBe(0);
  });
});

describe("buffering positions", () => {
  it("skips a fix closer than the minimum gap and keeps one exactly on it", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    harness.session.accept(fix(NOW + 1_000)); // inside the gap: dropped
    harness.session.accept(fix(NOW + LIVE_MIN_POINT_GAP_MS - 1)); // still inside
    harness.session.accept(fix(NOW + LIVE_MIN_POINT_GAP_MS)); // exactly the gap: kept

    expect(harness.session.snapshot().pending).toBe(2);
    await harness.tick();
    expect(pointsOf(harness.posts()[0])).toEqual([point(NOW), point(NOW + LIVE_MIN_POINT_GAP_MS)]);
  });

  it("ignores positions until a link exists", () => {
    const harness = setup();
    harness.session.accept(fix(NOW));
    expect(harness.session.snapshot().pending).toBe(0);
    expect(harness.calls).toHaveLength(0);
  });

  it("keeps at most the documented buffer, dropping the oldest first", async () => {
    const harness = await sharing();
    const beyond = 5;
    for (let index = 0; index < LIVE_BUFFER_MAX + beyond; index += 1) {
      harness.session.accept(fix(NOW + index * LIVE_MIN_POINT_GAP_MS));
    }
    expect(harness.session.snapshot().pending).toBe(LIVE_BUFFER_MAX);

    await harness.tick();
    const sent = pointsOf(harness.posts()[0]);
    expect(sent).toHaveLength(LIVE_BATCH_POINTS);
    expect(sent[0]?.t).toBe(NOW + beyond * LIVE_MIN_POINT_GAP_MS);
  });

  it("survives a reload through storage and resumes sending", async () => {
    const stored = JSON.stringify({
      credentials: CREATED,
      buffer: [point(NOW), point(NOW + LIVE_MIN_POINT_GAP_MS)],
      alert: "sos" as LiveAlertReason,
    });
    const harness = setup({ stored });
    expect(harness.session.snapshot().status).toBe("off");

    harness.session.restore();

    expect(harness.session.snapshot()).toEqual({
      status: "sharing",
      followUrl: CREATED.followUrl,
      alert: "sos",
      lastSentAt: null,
      pending: 2,
      error: null,
    });
    expect(harness.calls).toHaveLength(0); // resumed, not re-created
    expect(harness.intervalCount()).toBe(1);

    await harness.tick();
    expect(harness.posts()[0]?.url).toBe(`/api/live/${CREATED.rideId}/points`);
    expect(pointsOf(harness.posts()[0])).toEqual([point(NOW), point(NOW + LIVE_MIN_POINT_GAP_MS)]);
    expect(harness.session.snapshot().pending).toBe(0);
    expect(JSON.parse(harness.stored ?? "null")).toMatchObject({ buffer: [] });
  });

  it("has nothing to resume without a stored link, or with a corrupt one", () => {
    for (const stored of [null, "{not json", JSON.stringify({ credentials: {} })]) {
      const harness = setup({ stored });
      harness.session.restore();
      expect(harness.session.snapshot().status).toBe("off");
      expect(harness.intervalCount()).toBe(0);
    }
  });
});

describe("sending batches", () => {
  it("posts at most one batch per tick, with the owner secret, and drops what went", async () => {
    const harness = await sharing();
    const count = LIVE_BATCH_POINTS + 20;
    for (let index = 0; index < count; index += 1) {
      harness.session.accept(fix(NOW + index * LIVE_MIN_POINT_GAP_MS));
    }

    await harness.tick();

    const first = harness.posts()[0];
    expect(first?.url).toBe(`/api/live/${CREATED.rideId}/points`);
    expect(first?.method).toBe("POST");
    expect(first?.headers["x-live-secret"]).toBe(CREATED.ownerSecret);
    expect(first?.headers["content-type"]).toBe("application/json");
    expect(pointsOf(first)).toHaveLength(LIVE_BATCH_POINTS);
    expect(first?.body.alert).toBeUndefined(); // no status change is asserted
    expect(harness.session.snapshot().pending).toBe(20);

    harness.advanceClock(11_000);
    await harness.tick();

    const second = harness.posts()[1];
    expect(pointsOf(second)).toHaveLength(20);
    expect(pointsOf(second)[0]?.t).toBe(NOW + LIVE_BATCH_POINTS * LIVE_MIN_POINT_GAP_MS);
    expect(harness.session.snapshot().pending).toBe(0);
    expect(harness.session.snapshot().lastSentAt).toBe(NOW + 11_000);
  });

  it("does not post an empty batch", async () => {
    const harness = await sharing();
    await harness.tick();
    expect(harness.calls).toHaveLength(1); // only the create call
  });

  it("keeps the buffer through a dead zone, says so, and sends on the next tick", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    harness.setResponder(() => {
      throw new Error("offline");
    });

    await harness.tick();

    expect(harness.session.snapshot().pending).toBe(1);
    expect(harness.session.snapshot().error).toContain("No signal");

    harness.setResponder(() => jsonResponse(202));
    harness.advanceClock(11_000);
    await harness.tick();

    expect(pointsOf(harness.posts()[1])).toEqual([point(NOW)]);
    expect(harness.session.snapshot().pending).toBe(0);
    expect(harness.session.snapshot().error).toBeNull();
    expect(harness.session.snapshot().lastSentAt).toBe(NOW + 11_000);
  });

  it.each([404, 403])("ends sharing quietly when the link is %i", async (status) => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    harness.setResponder(() => jsonResponse(status));

    await harness.tick();

    expect(harness.session.snapshot()).toEqual({
      status: "off",
      followUrl: null,
      alert: null,
      lastSentAt: null,
      pending: 0,
      error: "The live link ended.",
    });
    expect(harness.intervalCount()).toBe(0);
    expect(harness.stored).toBeNull();
  });

  it("keeps the buffer when the server rejects the batch, and retries next tick", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    harness.setResponder(() => jsonResponse(500));

    await harness.tick();

    expect(harness.session.snapshot().pending).toBe(1);
    expect(harness.session.snapshot().status).toBe("sharing");
    expect(harness.session.snapshot().error).toContain("retrying");
  });
});

describe("alerts", () => {
  it("sends an alert with the last known position even when the buffer is empty", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    await harness.tick(); // the point goes out, the buffer is now empty
    expect(harness.session.snapshot().pending).toBe(0);

    await harness.session.raiseAlert("possible-crash");

    expect(harness.posts()).toHaveLength(2);
    expect(harness.posts()[1]?.url).toBe(`/api/live/${CREATED.rideId}/points`);
    expect(harness.posts()[1]?.body).toEqual({
      points: [point(NOW)],
      status: "alert",
      alert: { reason: "possible-crash" },
    });
    expect(harness.session.snapshot().alert).toBe("possible-crash");
  });

  it("retries an alert the network dropped, and shows it to followers meanwhile", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    await harness.tick();
    let attempts = 0;
    harness.setResponder(() => {
      attempts += 1;
      if (attempts <= 2) throw new Error("offline");
      return jsonResponse(202);
    });

    await harness.session.raiseAlert("sos");

    expect(attempts).toBe(3);
    expect(harness.session.snapshot().alert).toBe("sos");
    expect(harness.session.snapshot().error).toBeNull();
    const attemptsSent = harness.posts().slice(1);
    expect(attemptsSent).toHaveLength(3);
    for (const attempt of attemptsSent) {
      expect(attempt.body).toMatchObject({ status: "alert", alert: { reason: "sos" } });
    }
  });

  it("clears the alert on the follower's page", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    await harness.session.raiseAlert("possible-crash");

    await harness.session.clearAlert();

    expect(harness.session.snapshot().alert).toBeNull();
    const cleared = harness.calls.at(-1);
    expect(cleared?.url).toBe(`/api/live/${CREATED.rideId}/points`);
    expect(cleared?.body).toEqual({ points: [point(NOW)], alert: null });
  });

  it("does nothing for an alert when the rider is not sharing", async () => {
    const harness = setup();
    await harness.session.raiseAlert("possible-crash");
    await harness.session.clearAlert();
    expect(harness.calls).toHaveLength(0);
  });
});

describe("finishing and tearing down", () => {
  it("drains the buffer, marks the ride finished and forgets the link", async () => {
    const harness = await sharing();
    for (let index = 0; index < 3; index += 1) {
      harness.session.accept(fix(NOW + index * LIVE_MIN_POINT_GAP_MS));
    }

    await harness.session.finish();

    expect(harness.posts()).toHaveLength(2);
    expect(harness.posts()[0]?.url).toBe(`/api/live/${CREATED.rideId}/points`);
    expect(pointsOf(harness.posts()[0])).toHaveLength(3);
    expect(harness.posts()[1]?.url).toBe(`/api/live/${CREATED.rideId}/finish`);
    expect(harness.posts()[1]?.method).toBe("POST");
    expect(harness.posts()[1]?.body).toEqual({});
    expect(harness.session.snapshot()).toEqual({
      status: "off",
      followUrl: null,
      alert: null,
      lastSentAt: null,
      pending: 0,
      error: null,
    });
    expect(harness.intervalCount()).toBe(0);
    expect(harness.stored).toBeNull();
  });

  it("stops the timer on dispose and re-arms it on restore", async () => {
    const harness = await sharing();
    harness.session.accept(fix(NOW));
    expect(harness.intervalCount()).toBe(1);

    harness.session.dispose();
    expect(harness.intervalCount()).toBe(0);
    // A fix that arrives while torn down is still buffered, not lost.
    harness.session.accept(fix(NOW + LIVE_MIN_POINT_GAP_MS));

    harness.session.restore();
    expect(harness.intervalCount()).toBe(1);
    expect(harness.calls).toHaveLength(1); // resumed, not re-created
    expect(harness.session.snapshot().followUrl).toBe(CREATED.followUrl);

    await harness.tick();
    expect(pointsOf(harness.posts()[0])).toEqual([point(NOW), point(NOW + LIVE_MIN_POINT_GAP_MS)]);
  });
});
