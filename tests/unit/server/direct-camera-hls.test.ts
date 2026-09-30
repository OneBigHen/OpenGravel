import { describe, expect, it, vi } from "vitest";

import {
  directCameraPlaybackPath,
  handleDirectCameraHls,
} from "@/server/traffic-cameras/direct-hls";
import { encryptPa511RelayToken } from "@/server/traffic-cameras/pa511-hls";
import type { CameraDnsLookup } from "@/server/traffic-cameras/url-security";

const SECRET = "0123456789abcdefghijklmnopqrstuv";
const publicLookup: CameraDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("direct state-camera HLS relay", () => {
  it("builds same-origin playback only for proxied HLS states", () => {
    const env = { TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET };
    expect(directCameraPlaybackPath("DE", "123", env)).toBe("/api/traffic-cameras/direct/DE/123/hls");
    expect(directCameraPlaybackPath("NY", "123", env)).toBe("/api/traffic-cameras/direct/NY/123/hls");
    expect(directCameraPlaybackPath("VA", "123", env)).toBeNull();
    expect(directCameraPlaybackPath("VA", "123", {
      ...env,
      TRAFFIC_CAMERA_ALLOWED_ORIGINS_VA: "https://streams.example.org",
    })).toBe("/api/traffic-cameras/direct/VA/123/hls");
    expect(directCameraPlaybackPath("OH", "123", env)).toBeNull();
    expect(directCameraPlaybackPath("DE", "123", {})).toBeNull();
  });

  it("keeps the relay disabled unless the multi-state layer is explicitly enabled", async () => {
    const response = await handleDirectCameraHls(
      new Request("https://opengravel.test/api/traffic-cameras/direct/DE/123/hls"),
      "DE",
      "123",
      { env: { TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET }, fetch: vi.fn() as never },
    );
    expect(response.status).toBe(404);
  });

  it("rejects unsupported states before contacting an upstream", async () => {
    const fetcher = vi.fn();
    const response = await handleDirectCameraHls(
      new Request("https://opengravel.test/api/traffic-cameras/direct/OH/123/hls"),
      "OH",
      "123",
      {
        env: { TRAFFIC_CAMERAS_ENABLED: "1", TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
      },
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates direct token targets before forwarding range requests", async () => {
    const token = encryptPa511RelayToken({
      version: 1,
      cameraId: "NJ:123",
      upstreamUrl: "https://njtpk-wink.xcmdata.org/live/segment.ts",
      expiresAt: 20_000,
    }, SECRET);
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-9");
      return new Response("segment", { status: 206, headers: { "content-range": "bytes 0-9/7" } });
    });
    const response = await handleDirectCameraHls(
      new Request(`https://opengravel.test/api/traffic-cameras/direct/NJ/123/hls?r=${encodeURIComponent(token)}`, {
        headers: { range: "bytes=0-9" },
      }),
      "NJ",
      "123",
      {
        env: { TRAFFIC_CAMERAS_ENABLED: "1", TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("segment");
  });

  it("validates the resolved provider root before rewriting its playlist", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("account/login")) {
        return new Response(JSON.stringify({ data: { accessToken: "public-token" } }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("getCameraDataByTourId")) {
        return new Response(JSON.stringify({ data: [{
          id: "123",
          longitude: -74,
          latitude: 40,
          name: "NJ camera",
          cameraMainDetail: [{ camera_use_flag: "HLS", url: "https://njtpk-wink.xcmdata.org/live/main.m3u8" }],
        }] }), { headers: { "content-type": "application/json" } });
      }
      return new Response("#EXTM3U\n#EXTINF:2,\nsegment.ts\n", {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    });
    const response = await handleDirectCameraHls(
      new Request("https://opengravel.test/api/traffic-cameras/direct/NJ/123/hls"),
      "NJ",
      "123",
      {
        env: { TRAFFIC_CAMERAS_ENABLED: "1", TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(200);
    expect((await response.text())).toContain("/api/traffic-cameras/direct/NJ/123/hls?r=");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a direct token for a foreign origin without contacting it", async () => {
    const token = encryptPa511RelayToken({
      version: 1,
      cameraId: "NJ:123",
      upstreamUrl: "https://evil.example/live/segment.ts",
      expiresAt: 20_000,
    }, SECRET);
    const fetcher = vi.fn();
    const response = await handleDirectCameraHls(
      new Request(`https://opengravel.test/api/traffic-cameras/direct/NJ/123/hls?r=${encodeURIComponent(token)}`),
      "NJ",
      "123",
      {
        env: { TRAFFIC_CAMERAS_ENABLED: "1", TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
