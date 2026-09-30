import { describe, expect, it } from "vitest";

import {
  cameraFetchTarget,
  createExactOriginPolicy,
  createCameraUrlPolicy,
  createCameraMetadataPolicy,
  DEFAULT_CAMERA_ORIGINS,
  readCappedResponseText,
  type CameraDnsLookup,
  CameraUrlSecurityError,
} from "@/server/traffic-cameras/url-security";

const publicLookup: CameraDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("traffic-camera URL security", () => {
  it("allows only exact configured origins for each state", async () => {
    const policy = createCameraUrlPolicy("NJ", {}, { lookup: publicLookup });
    await expect(policy.validate("https://njtpk-wink.xcmdata.org/live/main.m3u8")).resolves.toBeInstanceOf(URL);
    await expect(policy.validate("https://evil.example/live/main.m3u8")).rejects.toMatchObject({ code: "untrusted-origin" });
  });

  it("rejects non-HTTPS URLs, credentials, and explicit non-default ports", async () => {
    const policy = createCameraUrlPolicy("DE", {}, { lookup: publicLookup });
    await expect(policy.validate("http://video.deldot.gov/live.m3u8")).rejects.toMatchObject({ code: "invalid-url" });
    await expect(policy.validate("https://user:password@video.deldot.gov/live.m3u8")).rejects.toMatchObject({ code: "invalid-url" });
    await expect(policy.validate("https://video.deldot.gov:8443/live.m3u8")).rejects.toMatchObject({ code: "invalid-url" });
  });

  it("allows the observed PA stream port only when the exact host and port are configured", async () => {
    const policy = createCameraUrlPolicy("PA", {}, { lookup: publicLookup });
    await expect(policy.validate("https://pa-se2.arcadis-ivds.com:8200/live/main.m3u8")).resolves.toBeInstanceOf(URL);
    await expect(policy.validate("https://pa-se2.arcadis-ivds.com:8201/live/main.m3u8")).rejects.toMatchObject({ code: "invalid-url" });
  });

  it("rejects private and local addresses before a request can be made", async () => {
    const privateLookup: CameraDnsLookup = async () => [
      { address: "10.0.0.8", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ];
    const policy = createCameraUrlPolicy("NJ", {}, { lookup: privateLookup });
    await expect(policy.validate("https://njtpk-wink.xcmdata.org/live.m3u8")).rejects.toMatchObject({ code: "private-address" });
    await expect(createCameraUrlPolicy("NJ", {}, {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    }).validate("https://njtpk-wink.xcmdata.org/live.m3u8")).rejects.toMatchObject({ code: "private-address" });
    await expect(policy.validate("https://localhost/live.m3u8")).rejects.toMatchObject({ code: "untrusted-origin" });
    await expect(createCameraUrlPolicy("NJ", {
      TRAFFIC_CAMERA_ALLOWED_ORIGINS_NJ: "https://localhost",
    }, { lookup: publicLookup }).validate("https://localhost/live.m3u8")).rejects.toMatchObject({ code: "untrusted-origin" });
  });

  it("fails closed when DNS cannot produce a public address", async () => {
    const policy = createCameraUrlPolicy("WV", {}, {
      lookup: async () => { throw new Error("resolver unavailable"); },
    });
    await expect(policy.validate("https://vtc3.roadsummary.com/live.m3u8")).rejects.toMatchObject({ code: "dns-failed" });
  });

  it("accepts exact per-state environment additions while retaining validation", async () => {
    const policy = createCameraUrlPolicy("VA", {
      TRAFFIC_CAMERA_ALLOWED_ORIGINS_VA: "https://streams.example.org",
    }, { lookup: publicLookup });
    await expect(policy.validate("https://streams.example.org/live.m3u8")).resolves.toBeInstanceOf(URL);
    expect(DEFAULT_CAMERA_ORIGINS.VA).toHaveLength(0);
    await expect(createCameraUrlPolicy("VA", {
      TRAFFIC_CAMERA_ALLOWED_ORIGINS_VA: "https://streams.example.org,https://127.0.0.1",
    }, { lookup: publicLookup }).validate("https://127.0.0.1/live.m3u8")).rejects.toMatchObject({ code: "private-address" });
  });

  it("keeps metadata origins separate from media origins", async () => {
    const metadata = createCameraMetadataPolicy("NJ", {}, { lookup: publicLookup });
    await expect(metadata.validate("https://511nj.org/account/login")).resolves.toBeInstanceOf(URL);
    await expect(metadata.validate("https://njtpk-wink.xcmdata.org/live/main.m3u8")).rejects.toMatchObject({ code: "untrusted-origin" });
    const paMetadata = createCameraMetadataPolicy("PA", {}, { lookup: publicLookup });
    await expect(paMetadata.validate("https://pa.arcadis-ivds.com/api/SecureTokenUri/GetSecureTokenUriBySourceId")).resolves.toBeInstanceOf(URL);
  });

  it("supports exact-origin policies without assigning a fake camera state", async () => {
    const policy = createExactOriginPolicy(["https://streams.example.org"], { lookup: publicLookup });
    await expect(policy.validate("https://streams.example.org/live/main.m3u8")).resolves.toBeInstanceOf(URL);
    await expect(policy.validate("https://other.example.org/live/main.m3u8")).rejects.toMatchObject({ code: "untrusted-origin" });
  });

  it("rejects Request transport inputs before any outbound request can be created", () => {
    expect(() => cameraFetchTarget(new Request("https://streams.example.org/live/main.m3u8"))).toThrowError(/explicit URL/);
  });

  it("caps streamed response text and converts reader failures into controlled errors", async () => {
    await expect(readCappedResponseText(new Response("1234"), 3)).rejects.toMatchObject({ code: "upstream-response" });
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("upstream reset"));
      },
    });
    await expect(readCappedResponseText(new Response(broken))).rejects.toMatchObject({ code: "upstream-response" });
  });

  it("rejects invalid configured origins instead of creating an unrestricted proxy", () => {
    expect(() => createCameraUrlPolicy("NJ", {
      TRAFFIC_CAMERA_ALLOWED_ORIGINS_NJ: "https://*.example.org",
    }, { lookup: publicLookup })).toThrowError(CameraUrlSecurityError);
  });
});
