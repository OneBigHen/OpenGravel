import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RAINVIEWER_CACHE_TTL_MS,
  clearRainViewerCache,
  handleRadarFramesRequest,
  readRadarFrames,
} from "@/server/map-layers/rainviewer";

const NOW = Date.parse("2026-10-03T18:40:00Z");
const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1_000);

function rainviewerPayload(): unknown {
  return {
    version: "2.0",
    generated: unix("2026-10-03T18:40:00Z"),
    host: "https://tilecache.rainviewer.com",
    radar: {
      past: [{ time: unix("2026-10-03T18:30:00Z"), path: "/v2/radar/latest" }],
      nowcast: [{ time: unix("2026-10-03T18:50:00Z"), path: "/v2/radar/nowcast_ab12" }],
    },
  };
}

beforeEach(() => {
  clearRainViewerCache();
});

afterEach(() => {
  clearRainViewerCache();
});

describe("rain radar frame route", () => {
  it("reads RainViewer once and answers from the five-minute cache", async () => {
    const fetch = vi.fn(async () => Response.json(rainviewerPayload()));
    let clock = NOW;

    const first = await readRadarFrames({ fetch, now: () => clock });
    expect(first.frames).toHaveLength(2);
    expect(first.host).toBe("https://tilecache.rainviewer.com");

    clock += RAINVIEWER_CACHE_TTL_MS - 1_000;
    const cached = await readRadarFrames({ fetch, now: () => clock });
    expect(cached).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);

    clock += 2_000;
    await readRadarFrames({ fetch, now: () => clock });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("answers with the parsed list and a client cache header", async () => {
    const response = await handleRadarFramesRequest({
      fetch: async () => Response.json(rainviewerPayload()),
      now: () => NOW,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    const body = (await response.json()) as { frames: readonly unknown[]; generatedAt: string };
    expect(body.generatedAt).toBe("2026-10-03T18:40:00.000Z");
    expect(body.frames).toHaveLength(2);
  });

  it("reports unavailable, never an empty radar, when RainViewer fails", async () => {
    const failing = await handleRadarFramesRequest({
      fetch: async () => new Response("nope", { status: 500 }),
      now: () => NOW,
    });
    expect(failing.status).toBe(503);
    expect(failing.headers.get("cache-control")).toBe("no-store");
    expect(await failing.json()).toMatchObject({ unavailable: true, retryable: true });

    clearRainViewerCache();
    const empty = await handleRadarFramesRequest({
      fetch: async () => Response.json({ host: "https://tilecache.rainviewer.com", radar: { past: [], nowcast: [] } }),
      now: () => NOW,
    });
    expect(empty.status).toBe(503);
  });

  it("does not ask RainViewer again for a minute after a failed read", async () => {
    const fetch = vi.fn(async () => new Response("down", { status: 502 }));
    let clock = NOW;
    await expect(readRadarFrames({ fetch, now: () => clock })).rejects.toThrow();
    clock += 30_000;
    await expect(readRadarFrames({ fetch, now: () => clock })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    clock += 40_000;
    await expect(readRadarFrames({ fetch, now: () => clock })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a good list through a later upstream failure inside the cache window", async () => {
    let healthy = true;
    let clock = NOW;
    const fetch = vi.fn(async () => (healthy ? Response.json(rainviewerPayload()) : new Response("down", { status: 502 })));
    await readRadarFrames({ fetch, now: () => clock });
    healthy = false;
    clock += 60_000;
    await expect(readRadarFrames({ fetch, now: () => clock })).resolves.toMatchObject({ host: "https://tilecache.rainviewer.com" });
  });
});
