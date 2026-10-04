/**
 * GraphHopper provider transport — port of the legacy transport/cancellation
 * tests in `tests/unit/graphhopper.test.ts` (baseline `06785c00…`), plus the
 * VNext cancellation contract (06 §28, port doc): caller cancellation is never
 * converted into a provider error, and a 30 s engine timeout is.
 */

import { describe, expect, it } from "vitest";

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";

const HARRISBURG: Coordinate = { lon: -76.8867, lat: 40.2732 };
const LANCASTER: Coordinate = { lon: -76.3055, lat: 40.0379 };

const REQUEST: ProviderRouteRequest = {
  requestId: "req_live",
  origin: HARRISBURG,
  destination: LANCASTER,
  stops: [],
  shaping: [],
  profile: "motorcycle_twisty",
  avoidPolygons: [],
  options: {
    includeAlternatives: false,
    avoidHighways: false,
    tollPolicy: "allow-with-warning",
    vehicle: "motorcycle",
  },
};

const RESPONSE_FIXTURE = {
  info: { version: "11.0" },
  paths: [
    {
      distance: 61_128.978,
      time: 4_335_684,
      ascend: 420,
      descend: 390,
      points: {
        type: "LineString",
        coordinates: [
          [-76.8867, 40.2732],
          [-76.7, 40.15],
          [-76.5, 40.2],
          [-76.3055, 40.0379],
        ],
      },
      instructions: [
        { distance: 1_000, time: 80_000, sign: 0, text: "Continue" },
        { distance: 800, time: 60_000, sign: 2, text: "Turn right" },
      ],
    },
  ],
};

/** One recorded provider call: the URL and the parsed JSON body. */
interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

/**
 * A `fetch`-shaped stub that records calls and answers with the queued
 * responses in order. Using the real `typeof fetch` signature (instead of a
 * mock with loose types) keeps the assertions typed.
 */
function stubFetch(responses: readonly (() => Response | Promise<Response>)[]): {
  calls: RecordedCall[];
  fetcher: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error("no stubbed response");
    return next();
  };
  return { calls, fetcher };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A stub that never answers until its signal aborts, like a hung engine. */
const pendingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener(
      "abort",
      () => reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")),
      { once: true },
    );
  });

describe("GraphHopper provider", () => {
  it("requests bounded round-trip candidates for planning-time discovery", async () => {
    const { calls, fetcher } = stubFetch([
      () => jsonResponse(RESPONSE_FIXTURE),
      () => jsonResponse(RESPONSE_FIXTURE),
      () => jsonResponse(RESPONSE_FIXTURE),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });
    const request: ProviderRouteRequest = {
      ...REQUEST,
      destination: HARRISBURG,
      // The fixture path is 72 min: inside the tolerance, so no correction.
      discovery: {
        targetMinutes: 75,
        toleranceMinutes: 15,
      },
    };

    const answer = await provider.candidates(request, new AbortController().signal);

    expect(calls).toHaveLength(3);
    expect(calls.map(({ body }) => body["algorithm"])).toEqual(Array(3).fill("round_trip"));
    expect(new Set(calls.map(({ body }) => body["round_trip.seed"])).size).toBe(3);
    expect(answer.candidates).toHaveLength(3);
  });

  it("keeps successful loop seeds when one optional round-trip attempt has no path", async () => {
    const { fetcher } = stubFetch([
      () => jsonResponse(RESPONSE_FIXTURE),
      () => jsonResponse({ message: "Connection not found" }, 400),
      () => jsonResponse(RESPONSE_FIXTURE),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    const answer = await provider.candidates({
      ...REQUEST,
      destination: HARRISBURG,
      discovery: { targetMinutes: 75, toleranceMinutes: 15 },
    }, new AbortController().signal);

    expect(answer.candidates).toHaveLength(2);
  });

  it("corrects a loop's distance toward its ride time when the engine overshoots", async () => {
    // An engine whose loops run 1.8x the distance asked for, at 48 mph.
    const calls: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      const askedMeters = Number(body["round_trip.distance"]);
      const meters = askedMeters * 1.8;
      const path = { ...RESPONSE_FIXTURE.paths[0], distance: meters, time: Math.round((meters / 21.4579) * 1000) };
      return jsonResponse({ ...RESPONSE_FIXTURE, paths: [path] });
    };
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    const answer = await provider.candidates({
      ...REQUEST,
      destination: HARRISBURG,
      discovery: { targetMinutes: 180, toleranceMinutes: 27 },
    }, new AbortController().signal);

    // Each of the three seeds asks once, misses by 144 min, and asks again.
    expect(calls).toHaveLength(6);
    const distances = calls.map((body) => Number(body["round_trip.distance"]));
    expect(Math.min(...distances)).toBeLessThan(Math.max(...distances) * 0.8);
    for (const candidate of answer.candidates) {
      expect(Math.abs(candidate.durationSeconds - 180 * 60)).toBeLessThanOrEqual(27 * 60);
    }
  });

  it("describes itself in provider-internal vocabulary only", () => {
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test" });

    expect(provider.id).toBe("graphhopper");
    expect(provider.capabilities()).toEqual({
      profiles: [
        "motorcycle_fastest",
        "motorcycle_twisty",
        "motorcycle_scenic",
        "motorcycle_adventure",
      ],
      supportsAlternatives: true,
      supportsAvoidPolygons: true,
    });
  });

  it("posts the ported request body and returns VNext candidates", async () => {
    const { calls, fetcher } = stubFetch([() => jsonResponse(RESPONSE_FIXTURE)]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test/", fetcher });

    const result = await provider.candidates(REQUEST, new AbortController().signal);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://router.test/route");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.body).toMatchObject({
      profile: "motorcycle_twisty",
      points: [
        [-76.8867, 40.2732],
        [-76.3055, 40.0379],
      ],
      points_encoded: false,
      details: [
        "road_class",
        "surface",
        "track_type",
        "max_speed",
        "max_speed_estimated",
        "toll",
        "road_environment",
        "urban_density",
        "curvature",
        "time",
        "smoothness",
        "road_class_link",
        "roundabout",
        "car_access",
        "road_access",
      ],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      providerId: "graphhopper",
      profile: "motorcycle_twisty",
      distanceMeters: 61_128.978,
      durationSeconds: 4_335.684,
      providerMetadata: { engineVersion: "11.0" },
    });
    expect(result.candidates[0]?.geometry).toHaveLength(4);
    expect(result.candidates[0]?.instructions?.[1]?.type).toBe("turn");
  });

  it("passes the caller's signal to the engine together with the timeout", async () => {
    const { calls, fetcher } = stubFetch([() => jsonResponse(RESPONSE_FIXTURE)]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });
    const controller = new AbortController();

    await provider.candidates(REQUEST, controller.signal);

    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
  });

  it("rejects with the caller's abort reason instead of a provider error", async () => {
    const provider = createGraphHopperProvider({
      baseUrl: "http://router.test",
      fetcher: pendingFetch,
    });
    const controller = new AbortController();
    const pending = provider.candidates(REQUEST, controller.signal);
    controller.abort();

    const caught: unknown = await pending.then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).not.toBeInstanceOf(GraphHopperProviderError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("AbortError");
  });

  it("maps an engine timeout to provider-timeout, never to cancellation", async () => {
    const provider = createGraphHopperProvider({
      baseUrl: "http://router.test",
      fetcher: pendingFetch,
      timeoutMs: 10,
    });

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-timeout", recoverable: true });
  });

  it("retries once without a detail the active graph cannot serve", async () => {
    const { calls, fetcher } = stubFetch([
      () => jsonResponse({ message: "Cannot find the path details: [curvature]" }, 400),
      () => jsonResponse(RESPONSE_FIXTURE),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    const result = await provider.candidates(REQUEST, new AbortController().signal);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body.details).toContain("curvature");
    expect(calls[1]?.body.details).not.toContain("curvature");
    expect(calls[1]?.body.details).toContain("surface");
    expect(result.candidates[0]?.providerMetadata).toMatchObject({ degraded: true });
  });

  it("drops every detail one rejection names, not just the first", async () => {
    const { calls, fetcher } = stubFetch([
      () => jsonResponse({ message: "Cannot find the path details: [curvature, urban_density]" }, 400),
      () => jsonResponse(RESPONSE_FIXTURE),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    await provider.candidates(REQUEST, new AbortController().signal);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.details).not.toContain("curvature");
    expect(calls[1]?.body.details).not.toContain("urban_density");
    expect(calls[1]?.body.details).toContain("road_class");
  });

  it("retries once when the active graph lacks the smoothness encoded value", async () => {
    const { calls, fetcher } = stubFetch([
      () => jsonResponse({ message: "Cannot compile expression: 'smoothness' not available" }, 400),
      () => jsonResponse(RESPONSE_FIXTURE),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    const result = await provider.candidates(REQUEST, new AbortController().signal);

    expect(calls).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.providerMetadata).toMatchObject({ degraded: true });
  });

  it("does not retry a failure that names nothing it can drop", async () => {
    const { calls, fetcher } = stubFetch([
      () => jsonResponse({ message: "Cannot compile expression: unknown condition" }, 400),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "validation" });
    expect(calls).toHaveLength(1);
  });

  it("normalizes an out-of-coverage rejection without leaking the engine message", async () => {
    const { fetcher } = stubFetch([
      () => jsonResponse({ message: "Point 1 is out of bounds" }, 400),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    const caught: unknown = await provider.candidates(REQUEST, new AbortController().signal).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toMatchObject({
      code: "outside-coverage",
      httpStatus: 400,
      recoverable: false,
    });
    expect((caught as Error).message).not.toContain("out of bounds");
  });

  it("reports an engine with no route as no-route, not as an empty success", async () => {
    const { fetcher } = stubFetch([() => jsonResponse({ paths: [] })]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "no-route" });
  });

  it("rejects unusable geometry instead of returning a synthetic candidate", async () => {
    const { fetcher } = stubFetch([
      () => jsonResponse({ paths: [{ points: { coordinates: [[-76.9, 40.2]] } }] }),
    ]);
    const provider = createGraphHopperProvider({ baseUrl: "http://router.test", fetcher });

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });

  it("does not expose the configured router URL when the connection fails", async () => {
    const internalUrl = "http://graphhopper.internal:8989/private";
    const fetcher: typeof fetch = async () => {
      throw new TypeError(`fetch failed while requesting ${internalUrl}/route`);
    };
    const provider = createGraphHopperProvider({ baseUrl: internalUrl, fetcher });

    const caught: unknown = await provider.candidates(REQUEST, new AbortController().signal).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toMatchObject({
      code: "provider-unavailable",
      recoverable: true,
    });
    expect((caught as Error).message).not.toContain(internalUrl);
  });
});
