import { describe, expect, it, vi } from "vitest";

import {
  directCameraPlaybackPath,
  handleDirectCameraHls,
} from "@/server/traffic-cameras/direct-hls";

const SECRET = "0123456789abcdefghijklmnopqrstuv";

describe("direct state-camera HLS relay", () => {
  it("builds same-origin playback only for proxied HLS states", () => {
    const env = { TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: SECRET };
    expect(directCameraPlaybackPath("DE", "123", env)).toBe("/api/traffic-cameras/direct/DE/123/hls");
    expect(directCameraPlaybackPath("NY", "123", env)).toBe("/api/traffic-cameras/direct/NY/123/hls");
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
});
