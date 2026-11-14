import { describe, expect, it } from "vitest";

import type { ProviderRouteOptions, ProviderRouteRequest } from "@/application/planner/route-provider";
import { valhallaCostingOptions } from "@/infrastructure/routing/valhalla/costing";
import { createIntervalLimiter, LimiterBusyError } from "@/infrastructure/routing/valhalla/limiter";
import {
  createValhallaRouter,
  decodePolyline6,
  FOSSGIS_ROUTE_URL,
  MAX_VALHALLA_LOCATIONS,
  STADIA_ROUTE_URL,
  VALHALLA_CLIENT_ID,
  VALHALLA_COPY,
  ValhallaRoutingError,
  valhallaRouteBody,
  valhallaUpstreamFromEnv,
} from "@/infrastructure/routing/valhalla/router";

const OPTIONS: ProviderRouteOptions = { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle" };

const REQUEST: ProviderRouteRequest = {
  requestId: "req",
  origin: { lon: -72.58, lat: 44.26 },
  destination: { lon: -72.82, lat: 44.47 },
  stops: [],
  shaping: [],
  profile: "motorcycle_fastest",
  avoidPolygons: [],
  options: OPTIONS,
};

/** Encodes points at six decimals (test helper for the decoder and parser). */
function encode(points: readonly [number, number][]): string {
  let out = "";
  let lastLat = 0;
  let lastLon = 0;
  const put = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lon * 1e6);
    put(la - lastLat); put(lo - lastLon);
    lastLat = la; lastLon = lo;
  }
  return out;
}

function tripBody(): unknown {
  return {
    trip: {
      summary: { length: 30.5, time: 1900 },
      legs: [{
        shape: encode([[44.26, -72.58], [44.3, -72.6], [44.47, -72.82]]),
        maneuvers: [
          { type: 1, instruction: "Drive north on Main Street.", length: 1.2, time: 90, begin_shape_index: 0, street_names: ["Main Street"] },
          { type: 15, instruction: "Turn left onto VT 100.", length: 29.3, time: 1810, begin_shape_index: 1, street_names: ["VT 100"] },
          { type: 4, instruction: "You have arrived.", length: 0, time: 0, begin_shape_index: 2 },
        ],
      }],
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("rider style → Valhalla motorcycle costing", () => {
  it("fast and balanced keep Valhalla's defaults", () => {
    expect(valhallaCostingOptions({ ...OPTIONS, roadCharacter: "efficient" })).toEqual({});
    expect(valhallaCostingOptions({ ...OPTIONS, roadCharacter: "balanced" })).toEqual({});
  });
  it("curvy and backroads stay off highways and big roads", () => {
    expect(valhallaCostingOptions({ ...OPTIONS, roadCharacter: "curvy" })).toEqual({ use_highways: 0.1, use_primary: 0.3 });
    expect(valhallaCostingOptions({ ...OPTIONS, roadCharacter: "backroads" })).toEqual({ use_highways: 0.1, use_primary: 0.3 });
  });
  it("gravel asks for some trails, dirt for more", () => {
    expect(valhallaCostingOptions({ ...OPTIONS, targetUnpavedShare: 0.3 })).toEqual({ use_trails: 0.6 });
    expect(valhallaCostingOptions({ ...OPTIONS, surfacePreference: "dirt-preferred" })).toEqual({ use_trails: 0.9 });
    expect(valhallaCostingOptions({ ...OPTIONS, bike: { category: "dual-sport", maintainedGravel: "allow", roughTracks: "allow" } })).toEqual({ use_trails: 0.9 });
  });
  it("the bike's own limits cap the trails", () => {
    expect(valhallaCostingOptions({ ...OPTIONS, surfacePreference: "dirt-preferred", bike: { category: "adventure", maintainedGravel: "allow", roughTracks: "avoid" } })).toEqual({ use_trails: 0.6 });
    expect(valhallaCostingOptions({ ...OPTIONS, surfacePreference: "dirt-preferred", bike: { category: "street", maintainedGravel: "avoid", roughTracks: "avoid" } })).toEqual({});
  });
  it("avoid highways and avoid tolls win", () => {
    expect(valhallaCostingOptions({ ...OPTIONS, roadCharacter: "curvy", avoidHighways: true, tollPolicy: "avoid" })).toEqual({ use_highways: 0, use_primary: 0.3, use_tolls: 0 });
  });
});

describe("upstream choice", () => {
  it("uses Stadia when a key is set", () => {
    const upstream = valhallaUpstreamFromEnv({ STADIA_API_KEY: " abc " });
    expect(upstream.id).toBe("stadia");
    expect(upstream.url).toBe(`${STADIA_ROUTE_URL}?api_key=abc`);
  });
  it("uses the FOSSGIS public server, named, without a key", () => {
    for (const env of [{}, { STADIA_API_KEY: "  " }]) {
      const upstream = valhallaUpstreamFromEnv(env);
      expect(upstream.id).toBe("fossgis");
      expect(upstream.url).toBe(FOSSGIS_ROUTE_URL);
      expect(upstream.headers["x-client-id"]).toBe(VALHALLA_CLIENT_ID);
      expect(upstream.headers["user-agent"]).toContain(VALHALLA_CLIENT_ID);
    }
  });
});

describe("request body", () => {
  it("orders points like the GraphHopper builder and thins pass-through points", () => {
    const shaping = Array.from({ length: 30 }, (_, at) => ({ lon: -72.6 - at / 100, lat: 44.3 }));
    const body = valhallaRouteBody({
      ...REQUEST,
      stops: [{ lon: -72.7, lat: 44.35 }],
      shaping,
      originHeadingDegrees: 91.6,
      avoidPolygons: [[{ lon: -72.7, lat: 44.3 }, { lon: -72.6, lat: 44.3 }, { lon: -72.6, lat: 44.4 }]],
      options: { ...OPTIONS, roadCharacter: "curvy" },
    });
    const locations = body["locations"] as { type: string; lon: number; heading?: number }[];
    expect(locations).toHaveLength(MAX_VALHALLA_LOCATIONS);
    expect(locations[0]).toMatchObject({ type: "break", heading: 92 });
    expect(locations[1]).toMatchObject({ type: "break", lon: -72.7 });
    expect(locations.slice(2, -1).every((location) => location.type === "through")).toBe(true);
    expect(locations[2]!.lon).toBe(shaping[0]!.lon);
    expect(locations.at(-2)!.lon).toBe(shaping.at(-1)!.lon);
    expect(locations.at(-1)).toMatchObject({ type: "break", lon: -72.82 });
    expect(body["costing"]).toBe("motorcycle");
    expect(body["costing_options"]).toEqual({ motorcycle: { use_highways: 0.1, use_primary: 0.3 } });
    expect(body["exclude_polygons"]).toEqual([[[-72.7, 44.3], [-72.6, 44.3], [-72.6, 44.4]]]);
  });
});

describe("decoding and parsing", () => {
  it("decodes polyline6", () => {
    expect(decodePolyline6(encode([[44.26, -72.58], [44.3, -72.6]]))).toEqual([{ lat: 44.26, lon: -72.58 }, { lat: 44.3, lon: -72.6 }]);
  });

  it("returns the line, metres, seconds and turns", async () => {
    const router = createValhallaRouter({ env: {}, limiter: null, fetcher: async () => jsonResponse(200, tripBody()) });
    const route = await router.route(REQUEST, new AbortController().signal);
    expect(route.geometry).toHaveLength(3);
    expect(route.distanceMeters).toBe(30_500);
    expect(route.durationSeconds).toBe(1900);
    expect(route.instructions[1]).toMatchObject({ type: "turn", maneuver: "left", roadName: "VT 100", geometryIndex: 1, distanceMeters: 29_300 });
    expect(route.instructions[2]).toMatchObject({ type: "finish" });
  });

  it("joins multi-leg trips without a repeated point", async () => {
    const body = {
      trip: {
        summary: { length: 2, time: 120 },
        legs: [
          { shape: encode([[44, -72], [44.1, -72.1]]), maneuvers: [{ type: 1, begin_shape_index: 0 }, { type: 4, begin_shape_index: 1 }] },
          { shape: encode([[44.1, -72.1], [44.2, -72.2]]), maneuvers: [{ type: 1, begin_shape_index: 0 }, { type: 10, begin_shape_index: 0 }, { type: 4, begin_shape_index: 1 }] },
        ],
      },
    };
    const router = createValhallaRouter({ env: {}, limiter: null, fetcher: async () => jsonResponse(200, body) });
    const route = await router.route(REQUEST, new AbortController().signal);
    expect(route.geometry).toHaveLength(3);
    expect(route.instructions.map((instruction) => instruction.type)).toEqual(["continue", "via", "turn", "finish"]);
    expect(route.instructions[2]!.geometryIndex).toBe(1);
  });
});

describe("failures are rider copy, never invented lines", () => {
  const route = async (fetcher: typeof fetch): Promise<unknown> => {
    const router = createValhallaRouter({ env: {}, limiter: null, fetcher });
    return router.route(REQUEST, new AbortController().signal).catch((error: unknown) => error);
  };
  it("429 says busy", async () => {
    const error = await route(async () => jsonResponse(429, {}));
    expect(error).toBeInstanceOf(ValhallaRoutingError);
    expect(error).toMatchObject({ code: "provider-unavailable", message: VALHALLA_COPY.busy, recoverable: true });
  });
  it("5xx and network failures say unreachable", async () => {
    expect(await route(async () => jsonResponse(503, {}))).toMatchObject({ code: "provider-unavailable", message: VALHALLA_COPY.unreachable });
    expect(await route(async () => { throw new TypeError("fetch failed"); })).toMatchObject({ code: "provider-unavailable", message: VALHALLA_COPY.unreachable });
  });
  it("no path is a no-route answer; too far says so", async () => {
    expect(await route(async () => jsonResponse(400, { error_code: 442, error: "No path could be found for input" }))).toMatchObject({ code: "no-route", message: VALHALLA_COPY.noRoute, recoverable: false });
    expect(await route(async () => jsonResponse(400, { error_code: 154, error: "Path distance exceeds the max distance limit" }))).toMatchObject({ code: "no-route", message: VALHALLA_COPY.tooLong });
  });
  it("a 200 without a usable line is a failure", async () => {
    expect(await route(async () => jsonResponse(200, { trip: { legs: [{ shape: "" }] } }))).toMatchObject({ code: "provider-unavailable" });
  });
  it("a slow upstream times out", async () => {
    const router = createValhallaRouter({
      env: {}, limiter: null, timeoutMs: 20,
      fetcher: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    expect(await router.route(REQUEST, new AbortController().signal).catch((error: unknown) => error)).toMatchObject({ code: "provider-timeout", message: VALHALLA_COPY.timeout });
  });
});

describe("pacing", () => {
  it("identical questions share one upstream call", async () => {
    let calls = 0;
    const router = createValhallaRouter({ env: {}, limiter: null, fetcher: async () => { calls += 1; return jsonResponse(200, tripBody()); } });
    await Promise.all([router.route(REQUEST, new AbortController().signal), router.route({ ...REQUEST, requestId: "other" }, new AbortController().signal)]);
    expect(calls).toBe(1);
  });

  it("the limiter spaces calls one interval apart and refuses a long queue", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = createIntervalLimiter({
      intervalMs: 1_000, maxWaitMs: 2_000, now: () => clock,
      sleep: async (ms) => { waits.push(ms); },
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(waits).toEqual([1_000, 2_000]);
    await expect(limiter.acquire()).rejects.toBeInstanceOf(LimiterBusyError);
    clock = 5_000;
    await limiter.acquire();
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("a busy limiter is the rider's busy message", async () => {
    const router = createValhallaRouter({
      env: {}, fetcher: async () => jsonResponse(200, tripBody()),
      limiter: { acquire: async () => { throw new LimiterBusyError(); } },
    });
    expect(await router.route(REQUEST, new AbortController().signal).catch((error: unknown) => error)).toMatchObject({ message: VALHALLA_COPY.busy });
  });

  it("the FOSSGIS server is paced by default; Stadia is not", async () => {
    const starts: number[] = [];
    const fetcher: typeof fetch = async () => { starts.push(Date.now()); return jsonResponse(200, tripBody()); };
    const fossgis = createValhallaRouter({ env: {}, fetcher });
    await fossgis.route({ ...REQUEST, origin: { lon: -72.5, lat: 44.2 } }, new AbortController().signal);
    await fossgis.route({ ...REQUEST, origin: { lon: -72.4, lat: 44.2 } }, new AbortController().signal);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(900);
  });
});
