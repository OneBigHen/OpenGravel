import { describe, expect, it } from "vitest";

import {
  decryptPa511RelayToken,
  encryptPa511RelayToken,
  rewritePa511Manifest,
} from "@/server/traffic-cameras/pa511-hls";

const SECRET = "0123456789abcdefghijklmnopqrstuv";

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
});
