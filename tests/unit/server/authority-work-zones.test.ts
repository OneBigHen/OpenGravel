import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { authorityProvider } from "@/server/map-layers/authority";
import { roadAuthoritySourcesFromEnv } from "@/server/planning/road-authority";

/**
 * The work-zones layer over the canonical road authority, in the production
 * shape: `OGV_ROAD_AUTHORITY=on`, no `PTC_WZDX_API_KEY`, and Pennsylvania's
 * only WZDx feed is the keyed Turnpike one.
 */

/** Eastern Pennsylvania, the view the production probe used. */
const VIEW = { west: -75.85, south: 40.8, east: -75.65, north: 40.92 };

/** Rochester, NY: a view whose own state has a keyless feed. */
const NY_VIEW = { west: -77.65, south: 43.1, east: -77.55, north: 43.2 };

/** The USDOT registry lists the keyed Turnpike feed plus keyless state feeds. */
const REGISTRY = [
  {
    active: true, needapikey: true, version: "4.1", format: "geojson", state: "pennsylvania", feedname: "ptc",
    issuingorganization: "Pennsylvania Turnpike Commission", url: { url: "https://atms.paturnpike.com/api/WZDxWorkZoneFeed" },
  },
  {
    active: true, needapikey: false, version: "4.1", format: "geojson", state: "new york", feedname: "nysdot",
    issuingorganization: "New York State DOT", url: { url: "https://511ny.dots.test/wzdx" },
  },
];

const WORK_ZONE_FEED = {
  type: "FeatureCollection",
  features: [{
    id: "wz1",
    type: "Feature",
    properties: {
      core_details: { event_type: "work-zone", road_names: ["US 22"], description: "Bridge repair." },
      vehicle_impact: "some-lanes-closed",
    },
    geometry: { type: "LineString", coordinates: [[-75.8, 40.85], [-75.7, 40.9]] },
  }],
};

const MVUM_ROAD = {
  features: [{
    attributes: { objectid: 1, id: "500", name: "DUTCHMAN", passengervehicle: "open" },
    geometry: { paths: [[[-75.8, 40.83], [-75.7, 40.86]]] },
  }],
};

/**
 * A minimal fetch answer: the adapters only read `ok` and `json()`, so this
 * keeps the fake-timer test free of real stream I/O.
 */
function respond(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

type StubOptions = {
  readonly registry?: unknown;
  readonly feed?: () => Promise<Response>;
  readonly feedFails?: boolean;
  readonly mvum?: unknown;
};

function stubFetch(options: StubOptions = {}) {
  return vi.fn((input: unknown): Promise<Response> => {
    const url = String(input);
    if (url.includes("datahub.transportation.gov")) return Promise.resolve(respond(options.registry ?? REGISTRY));
    if (url.includes("511ny.dots.test")) {
      if (options.feedFails === true) return Promise.reject(new Error("feed down"));
      return options.feed === undefined ? Promise.resolve(respond(WORK_ZONE_FEED)) : options.feed();
    }
    if (url.includes("apps.fs.usda.gov")) return Promise.resolve(respond(options.mvum ?? MVUM_ROAD));
    if (url.includes("paturnpike.com")) return Promise.reject(new Error("the keyed Turnpike feed must not be requested without a key"));
    // The seasonal PA/NJ road layers share the authority composition but not this facet.
    return Promise.resolve(respond({ type: "FeatureCollection", features: [] }));
  });
}

/** A unique cache directory per test: the composition caches one coordinator per env key. */
async function env() {
  return {
    OGV_ROAD_AUTHORITY: "on",
    OGV_ROAD_AUTHORITY_CACHE_DIR: await mkdtemp(path.join(tmpdir(), "ogv-authority-")),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("work-zones layer over the canonical authority", () => {
  it("serves a Pennsylvania view without the Turnpike key instead of reporting unavailable", async () => {
    const fetchStub = stubFetch({ feedFails: true });
    vi.stubGlobal("fetch", fetchStub);
    const context = { env: await env(), fetch: fetchStub as unknown as typeof fetch, signal: new AbortController().signal };

    const mvum = await authorityProvider.snapshot!(VIEW, ["mvum"], context);
    expect(mvum.unavailable).toBeFalsy();
    expect(mvum.features.length).toBeGreaterThan(0);

    // Pennsylvania has no keyless work-zone feed, and the one feed whose coarse
    // state box reaches this view did not answer. No report is not "clear", but
    // it is also not a broken layer: nothing configured for this view failed.
    const workZones = await authorityProvider.snapshot!(VIEW, ["work-zones"], context);
    expect(workZones.unavailable).toBeFalsy();
    expect(workZones.features).toEqual([]);
    expect(workZones.freshness?.[0]?.note).toContain("No keyless work-zone feed is registered for Pennsylvania");
    expect(workZones.freshness?.[0]?.note).toContain("unknown");
    expect(fetchStub.mock.calls.map(([url]) => String(url)).some((url) => url.includes("paturnpike.com"))).toBe(false);
  });

  it("renders the work zones a keyless feed reports inside the view", async () => {
    const fetchStub = stubFetch();
    vi.stubGlobal("fetch", fetchStub);
    const snapshot = await authorityProvider.snapshot!(VIEW, ["work-zones"], {
      env: await env(), fetch: fetchStub as unknown as typeof fetch, signal: new AbortController().signal,
    });
    expect(snapshot.unavailable).toBeFalsy();
    expect(snapshot.features).toHaveLength(1);
    expect(snapshot.features[0]?.layerId).toBe("work-zones");
    expect(snapshot.features[0]?.name).toContain("Work zone");
  });

  it("says unavailable when the view's own state feed genuinely fails", async () => {
    const fetchStub = stubFetch({ feedFails: true });
    vi.stubGlobal("fetch", fetchStub);
    const snapshot = await authorityProvider.snapshot!(NY_VIEW, ["work-zones"], {
      env: await env(), fetch: fetchStub as unknown as typeof fetch, signal: new AbortController().signal,
    });
    expect(snapshot.unavailable).toBe(true);
    expect(snapshot.features).toEqual([]);
  });

  it("waits for a cold registry and feed round-trip instead of timing out as unavailable", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.includes("datahub.transportation.gov")) {
        return new Promise((resolve) => { setTimeout(() => resolve(respond(REGISTRY)), 3_000); });
      }
      if (url.includes("511ny.dots.test")) {
        return new Promise((resolve) => { setTimeout(() => resolve(respond(WORK_ZONE_FEED)), 1_000); });
      }
      return respond({ type: "FeatureCollection", features: [] });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchStub);

    const pending = authorityProvider.snapshot!(VIEW, ["work-zones"], {
      // No cache directory here: a disk write would need real I/O between the
      // two stub round-trips, and this test runs on fake timers.
      env: { OGV_ROAD_AUTHORITY: "on" }, fetch: fetchStub, signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const snapshot = await pending;
    expect(snapshot.unavailable).toBeFalsy();
    expect(snapshot.features).toHaveLength(1);
  });

  it("keeps the WZDx registry and feed snapshots in the authority cache directory", async () => {
    const fetchStub = stubFetch();
    vi.stubGlobal("fetch", fetchStub);
    const cacheEnv = await env();
    const context = { env: cacheEnv, fetch: fetchStub as unknown as typeof fetch, signal: new AbortController().signal };
    await authorityProvider.snapshot!(VIEW, ["mvum"], context);
    await authorityProvider.snapshot!(VIEW, ["work-zones"], context);
    const files = await readdir(cacheEnv.OGV_ROAD_AUTHORITY_CACHE_DIR);
    // MVUM cells keep their names; the work-zone sources persist next to them.
    expect(files.some((name) => /^mvum-/.test(name))).toBe(true);
    expect(files).toEqual(expect.arrayContaining(["wzdx-registry.json", "wzdx-feed-wzdx-nysdot.json"]));
  });

  it("composes the Turnpike feed only when its key is configured", () => {
    expect(roadAuthoritySourcesFromEnv({}).map((source) => source.info.id)).not.toContain("wzdx-ptc");
    const keyed = roadAuthoritySourcesFromEnv({ PTC_WZDX_API_KEY: "configured-key" });
    expect(keyed.map((source) => source.info.id)).toContain("wzdx-ptc");
    expect(keyed.find((source) => source.info.id === "wzdx-ptc")?.probe()).toEqual({ available: true, reason: null });
  });
});
