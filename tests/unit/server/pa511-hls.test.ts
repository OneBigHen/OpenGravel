import { describe, expect, it, vi } from "vitest";

import {
  decryptPa511RelayToken,
  encryptPa511RelayToken,
  handlePa511HlsRequest,
  rewritePa511Manifest,
} from "@/server/traffic-cameras/pa511-hls";
import type { CameraDnsLookup } from "@/server/traffic-cameras/url-security";

const SECRET = "0123456789abcdefghijklmnopqrstuv";
const publicLookup: CameraDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function relayToken(upstreamUrl: string, expiresAt = 20_000): string {
  return encryptPa511RelayToken({ version: 1, cameraId: "123", upstreamUrl, expiresAt }, SECRET);
}

describe("PA 511 HLS relay", () => {
  it("encrypts relay resources without exposing the upstream URL", () => {
    const payload = {
      version: 1 as const,
      cameraId: "123",
      upstreamUrl: "https://video.example.test/live/segment.ts?token=secret",
      expiresAt: 2_000,
    };
    const token = encryptPa511RelayToken(payload, SECRET);
    expect(token).not.toContain("video.example.test");
    expect(token).not.toContain("secret");
    expect(decryptPa511RelayToken(token, SECRET)).toEqual(payload);
  });

  it("rewrites playlist rows and URI attributes through the same-origin relay", () => {
    const source = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
      "#EXTINF:2,",
      "segment-1.ts",
      '#EXT-X-MAP:URI="init.mp4"',
      "",
    ].join("\n");
    const rewritten = rewritePa511Manifest(
      source,
      new URL("https://video.example.test/live/main.m3u8?token=upstream"),
      "123",
      SECRET,
      "/api/traffic-cameras/pa511/123/hls",
      1_000,
    );

    expect(rewritten).not.toContain("video.example.test");
    expect(rewritten).not.toContain("token=upstream");
    const relayUrls = [...rewritten.matchAll(/(?:URI=")?(\/api\/traffic-cameras\/pa511\/123\/hls\?r=[^"\n]+)/g)]
      .map((match) => match[1]);
    expect(relayUrls).toHaveLength(3);
    for (const local of relayUrls) {
      const encoded = new URL(`https://opengravel.test${local}`).searchParams.get("r");
      expect(encoded).not.toBeNull();
      const decoded = decryptPa511RelayToken(encoded!, SECRET);
      expect(decoded.cameraId).toBe("123");
      expect(decoded.upstreamUrl).toContain("https://video.example.test/live/");
      expect(decoded.upstreamUrl).toContain("token=upstream");
    }
  });

  it("rejects tampered relay tokens", () => {
    const token = encryptPa511RelayToken({
      version: 1,
      cameraId: "123",
      upstreamUrl: "https://video.example.test/live/segment.ts",
      expiresAt: 2_000,
    }, SECRET);
    const replacement = token.endsWith("A") ? "B" : "A";
    expect(() => decryptPa511RelayToken(`${token.slice(0, -1)}${replacement}`, SECRET)).toThrow();
  });

  it("rejects malformed tokens without contacting an upstream", async () => {
    const fetcher = vi.fn();
    const response = await handlePa511HlsRequest(
      new Request("https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=not-a-token"),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a foreign manifest key before minting any child token", async () => {
    const fetcher = vi.fn(async () => new Response([
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://evil.example/secret.key"',
      "#EXTINF:2,",
      "segment.ts",
    ].join("\n"), { headers: { "content-type": "application/vnd.apple.mpegurl" } }));
    const response = await handlePa511HlsRequest(
      new Request(`https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=${encodeURIComponent(relayToken("https://pa-se1.arcadis-ivds.com/live/main.m3u8"))}`),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toBe("Live camera returned an unsafe playlist.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(body).not.toContain("r=");
  });

  it("rejects upstream redirects instead of following them", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/live.m3u8" },
    }));
    const response = await handlePa511HlsRequest(
      new Request(`https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=${encodeURIComponent(relayToken("https://pa-se1.arcadis-ivds.com/live/main.m3u8"))}`),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed URI attributes before signing them", async () => {
    const fetcher = vi.fn(async () => new Response([
      "#EXTM3U",
      "#EXT-X-KEY:METHOD=AES-128,URI='https://pa-se1.arcadis-ivds.com/key.bin'",
    ].join("\n"), { headers: { "content-type": "application/vnd.apple.mpegurl" } }));
    const response = await handlePa511HlsRequest(
      new Request(`https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=${encodeURIComponent(relayToken("https://pa-se1.arcadis-ivds.com/live/main.m3u8"))}`),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Live camera returned an invalid playlist.");
  });

  it("turns a playlist stream failure into a controlled 502", async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("#EXTM3U\n"));
        controller.error(new Error("upstream reset"));
      },
    }), { headers: { "content-type": "application/vnd.apple.mpegurl" } }));
    const response = await handlePa511HlsRequest(
      new Request(`https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=${encodeURIComponent(relayToken("https://pa-se1.arcadis-ivds.com/live/main.m3u8"))}`),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Live camera returned an invalid playlist.");
  });

  it("keeps valid provider children and Range requests on the relay", async () => {
    const playlist = ["#EXTM3U", "#EXTINF:2,", "segment.ts", ""].join("\n");
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("main.m3u8")) {
        return new Response(playlist, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
      }
      expect(String(input)).toContain("pa-se1.arcadis-ivds.com");
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-9");
      return new Response("segment", { status: 206, headers: { "content-range": "bytes 0-9/7" } });
    });
    const first = await handlePa511HlsRequest(
      new Request(`https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=${encodeURIComponent(relayToken("https://pa-se1.arcadis-ivds.com/live/main.m3u8?token=upstream"))}`, {
        headers: { range: "bytes=0-9" },
      }),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(first.status).toBe(200);
    const child = [...(await first.text()).matchAll(/\/api\/traffic-cameras\/pa511\/123\/hls\?r=([^\n]+)/g)][0]?.[1];
    expect(child).toBeDefined();
    const second = await handlePa511HlsRequest(
      new Request(`https://opengravel.test/api/traffic-cameras/pa511/123/hls?r=${encodeURIComponent(child!)}`, {
        headers: { range: "bytes=0-9" },
      }),
      "123",
      {
        env: { PA511_CAMERAS_ENABLED: "1", PA511_VIDEO_ENABLED: "1", PA511_VIDEO_PROXY_SECRET: SECRET },
        fetch: fetcher as never,
        lookup: publicLookup,
        now: () => 1_000,
      },
    );
    expect(second.status).toBe(206);
    expect(await second.text()).toBe("segment");
  });
});
