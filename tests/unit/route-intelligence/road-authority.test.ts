import { describe, expect, it, vi } from "vitest";

import { createRoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import { dedupeRecords } from "@/application/route-intelligence/dedupe";
import { indexRoute, matchRecord } from "@/application/route-intelligence/match";
import { inSeason, roadAuthorityEffect } from "@/application/route-intelligence/policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  RoadAuthorityRecord,
  RoadAuthoritySnapshot,
  RoadAuthoritySourceInfo,
} from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

const AT = "2026-09-27T14:00:00.000Z";
// A straight ~2.2 km road running north.
const ROAD: readonly Coordinate[] = [
  { lon: -75.5, lat: 40.6 },
  { lon: -75.5, lat: 40.61 },
  { lon: -75.5, lat: 40.62 },
];
const ROUTE_ON_ROAD: readonly Coordinate[] = [{ lon: -75.5, lat: 40.595 }, ...ROAD, { lon: -75.5, lat: 40.625 }];
// Crosses the road at right angles, at its middle.
const ROUTE_CROSSING: readonly Coordinate[] = [{ lon: -75.52, lat: 40.61 }, { lon: -75.48, lat: 40.61 }];

function record(overrides: Partial<RoadAuthorityRecord> = {}): RoadAuthorityRecord {
  return {
    sourceId: "feed",
    sourceRecordId: "1",
    kind: "closure",
    geometry: { type: "line", coordinates: ROAD },
    roadName: "Ridge Road",
    description: "Bridge replacement.",
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function info(overrides: Partial<RoadAuthoritySourceInfo> = {}): RoadAuthoritySourceInfo {
  return {
    id: "feed",
    label: "Test feed",
    authority: "authoritative-operational",
    family: "road-authority",
    facet: "closures",
    coverage: [{ west: -76, south: 40, east: -75, north: 41 }],
    precedence: 1,
    ...overrides,
  };
}

function source(
  snapshot: Partial<RoadAuthoritySnapshot> | (() => Promise<RoadAuthoritySnapshot>),
  sourceInfo: RoadAuthoritySourceInfo = info(),
): RoadAuthoritySource {
  return {
    info: sourceInfo,
    budget: {
      maxRemoteCallsPerPlan: 1, maxRecords: 10, timeoutMs: 1_000, concurrency: 1,
      cacheTtlMs: 1, serveStaleMs: 1, retry: "none", cancellable: false,
    },
    probe: () => ({ available: true, reason: null }),
    snapshot: typeof snapshot === "function"
      ? snapshot
      : async () => ({
          status: "fresh", fetchedAt: AT, reason: null, records: [], covered: sourceInfo.coverage, ...snapshot,
        }),
  };
}

const corridor = { west: -75.6, south: 40.5, east: -75.4, north: 40.7 };

describe("route matching", () => {
  it("tells riding along a road from crossing it", () => {
    expect(matchRecord(indexRoute(ROUTE_ON_ROAD), { type: "line", coordinates: ROAD }).strength).toBe("traverses");
    expect(matchRecord(indexRoute(ROUTE_CROSSING), { type: "line", coordinates: ROAD }).strength).toBe("touches");
    expect(matchRecord(indexRoute(ROUTE_CROSSING), { type: "point", coordinate: { lon: -75.3, lat: 40.61 } }).strength).toBe("none");
  });
});

describe("road-authority policy (the exact hard gate)", () => {
  const traverses = { strength: "traverses" as const, overlapMeters: 2_000 };
  const touches = { strength: "touches" as const, overlapMeters: 0 };

  it("an authoritative active closure the route rides rejects it", () => {
    expect(roadAuthorityEffect(record(), "authoritative-operational", traverses, AT)).toMatchObject({ effect: "reject", code: "road-closed" });
  });

  it("community, modeled or contextual sources cannot reject on their own", () => {
    for (const authority of ["community-observed", "government-modeled", "contextual"] as const) {
      expect(roadAuthorityEffect(record(), authority, traverses, AT).effect).not.toBe("reject");
    }
  });

  it("a closure only touched (a point report, a crossing) warns but never rejects", () => {
    expect(roadAuthorityEffect(record(), "authoritative-operational", touches, AT)).toMatchObject({ effect: "warn", code: "road-closure-reported" });
  });

  it("an ended or future closure does nothing; a stale one never stays current", () => {
    expect(roadAuthorityEffect(record({ validUntil: "2026-09-20T00:00:00.000Z" }), "authoritative-operational", traverses, AT).effect).toBe("none");
    expect(roadAuthorityEffect(record({ validFrom: "2026-10-01T00:00:00.000Z" }), "authoritative-operational", traverses, AT).effect).toBe("none");
  });

  it("MVUM seasonal designation obeys the ride's date", () => {
    const seasonal = record({
      kind: "motor-vehicle-designation", validFrom: null, validUntil: null,
      motorcycleAccess: { status: "open", seasons: [{ startMonth: 5, startDay: 15, endMonth: 9, endDay: 15 }] },
    });
    expect(roadAuthorityEffect(seasonal, "authoritative-regulatory", traverses, AT)).toMatchObject({ effect: "reject", code: "access-prohibited" });
    expect(roadAuthorityEffect(seasonal, "authoritative-regulatory", traverses, "2026-07-04T15:00:00.000Z").effect).toBe("none");
    expect(inSeason([{ startMonth: 11, startDay: 1, endMonth: 3, endDay: 31 }], "2026-01-10T12:00:00.000Z")).toBe(true);
  });

  it("MVUM closed to motorcycles rejects; unknown designation does not", () => {
    const closed = record({ kind: "motor-vehicle-designation", motorcycleAccess: { status: "closed", seasons: null } });
    const unknown = record({ kind: "motor-vehicle-designation", motorcycleAccess: { status: "unknown", seasons: null } });
    expect(roadAuthorityEffect(closed, "authoritative-regulatory", traverses, AT).effect).toBe("reject");
    expect(roadAuthorityEffect(unknown, "authoritative-regulatory", traverses, AT).effect).toBe("none");
  });
});

describe("dedupe", () => {
  it("the same event from two feeds contributes once, the road owner's copy kept", () => {
    const owner = record({ sourceId: "wzdx", sourceRecordId: "a" });
    const aggregator = record({ sourceId: "aggregator", sourceRecordId: "b", geometry: { type: "point", coordinate: ROAD[0]! } });
    const kept = dedupeRecords([aggregator, owner], (id) => (id === "wzdx" ? 1 : 2));
    expect(kept).toEqual([owner]);
  });
});

describe("road-authority coordinator", () => {
  it("unavailable is never clear: a covering source that failed leaves closures unknown and says so", async () => {
    const coordinator = createRoadAuthorityCoordinator({
      sources: [source({ status: "unavailable", reason: "Test feed is down.", covered: [] })],
      now: () => AT,
    });
    const verdict = (await coordinator.assess(corridor, new AbortController().signal)).evaluate(ROUTE_ON_ROAD);
    expect(verdict.evidence.closures.status).toBe("unknown");
    expect(verdict.warnings.map((warning) => warning.code)).toContain("road-authority-unavailable");
    expect(verdict.failures).toEqual([]);
  });

  it("a source that misses the deadline is unavailable, not clear", async () => {
    const coordinator = createRoadAuthorityCoordinator({
      sources: [source(() => new Promise(() => undefined))],
      deadlineMs: 20,
      now: () => AT,
    });
    const assessment = await coordinator.assess(corridor, new AbortController().signal);
    expect(assessment.sources[0]?.snapshot.status).toBe("unavailable");
    expect(assessment.evaluate(ROUTE_ON_ROAD).evidence.closures.status).toBe("unknown");
  });

  it("a complete answer with nothing on the route reads as measured and clear", async () => {
    const coordinator = createRoadAuthorityCoordinator({ sources: [source({})], now: () => AT });
    const verdict = (await coordinator.assess(corridor, new AbortController().signal)).evaluate(ROUTE_ON_ROAD);
    expect(verdict.evidence.closures).toMatchObject({ status: "known", value: 0 });
    expect(verdict.warnings).toEqual([]);
  });

  it("a route only partly checked is not clear, and a place no feed covers is no caveat", async () => {
    const coordinator = createRoadAuthorityCoordinator({
      sources: [source({ covered: [{ west: -75.505, south: 40.5, east: -75.4, north: 40.61 }] }, info({ coverage: [{ west: -75.505, south: 40.5, east: -75.4, north: 40.61 }] }))],
      now: () => AT,
    });
    const verdict = (await coordinator.assess(corridor, new AbortController().signal)).evaluate(ROUTE_ON_ROAD);
    expect(verdict.evidence.closures.status).toBe("unknown");
    expect(verdict.warnings).toEqual([]);
  });

  it("an answer's unknown areas keep a covered neighbor from claiming them", async () => {
    const coordinator = createRoadAuthorityCoordinator({
      sources: [source({ unknownAreas: [{ west: -75.6, south: 40.6, east: -75.45, north: 40.7 }] })],
      now: () => AT,
    });
    const verdict = (await coordinator.assess(corridor, new AbortController().signal)).evaluate(ROUTE_ON_ROAD);
    expect(verdict.evidence.closures.status).toBe("unknown");
    expect(verdict.warnings).toEqual([]);
  });

  it("outside every source's coverage, closures stay unknown", async () => {
    const coordinator = createRoadAuthorityCoordinator({ sources: [source({})], now: () => AT });
    const far = [{ lon: -110, lat: 44 }, { lon: -110.1, lat: 44.1 }];
    expect((await coordinator.assess(corridor, new AbortController().signal)).evaluate(far).evidence.closures.status).toBe("unknown");
  });

  it("an active closure on the route rejects it with the source's reason", async () => {
    const coordinator = createRoadAuthorityCoordinator({ sources: [source({ records: [record()] })], now: () => AT });
    const verdict = (await coordinator.assess(corridor, new AbortController().signal)).evaluate(ROUTE_ON_ROAD);
    expect(verdict.failures).toEqual([{ code: "road-closed", message: "Ridge Road is closed: Bridge replacement." }]);
    expect(verdict.evidence.closures.value).toBe(1);
  });

  it("several reports on one road read as one caveat", async () => {
    const daily = [1, 2, 3].map((day) => record({
      kind: "work-zone", sourceRecordId: `w${day}`, roadName: "US 22",
      geometry: { type: "point", coordinate: { lon: -75.5, lat: 40.6 + day * 0.004 } },
      description: `Right lane closed, day ${day}.`,
    }));
    const coordinator = createRoadAuthorityCoordinator({ sources: [source({ records: daily })], now: () => AT });
    const verdict = (await coordinator.assess(corridor, new AbortController().signal)).evaluate(ROUTE_ON_ROAD);
    expect(verdict.warnings).toEqual([{ code: "road-work-on-route", message: "US 22: Right lane closed, day 1. (+2 more on this road)" }]);
  });

  it("an unconfigured source never joins", () => {
    const unconfigured = { ...source({}), probe: () => ({ available: false, reason: "no key" }) };
    expect(createRoadAuthorityCoordinator({ sources: [unconfigured] }).sources).toEqual([]);
  });
});

describe("cache policy", () => {
  it("serves fresh, then stale for a bounded while, then nothing", () => {
    let clock = 0;
    const cache = createTtlCache<string, number>({ ttlMs: 10, serveStaleMs: 10, now: () => clock });
    cache.write("k", 1);
    expect(cache.read("k").state).toBe("fresh");
    clock = 15;
    expect(cache.read("k").state).toBe("stale");
    clock = 25;
    expect(cache.read("k").state).toBe("miss");
  });

  it("shares one in-flight load", async () => {
    const cache = createTtlCache<string, number>({ ttlMs: 10, serveStaleMs: 0 });
    const loader = vi.fn(async () => 7);
    await Promise.all([cache.load("k", loader), cache.load("k", loader)]);
    expect(loader).toHaveBeenCalledOnce();
  });
});
