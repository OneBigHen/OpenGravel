import { describe, expect, it } from "vitest";

import {
  parseDelawareCameras,
  parseMarylandCameras,
  parseNewJerseyCameras,
  parseOhioCameras,
  parseVirginiaCameras,
  parseWestVirginiaCameras,
} from "@/server/traffic-cameras/registry";
import { clearTrafficCameraCatalogCache, relevantTrafficCameraAdapters, trafficCamerasProvider } from "@/server/map-layers/traffic-cameras";

describe("regional traffic camera adapters", () => {
  it.each([{}, { TRAFFIC_CAMERA_VIDEO_PROXY_SECRET: "a-secure-test-secret-of-at-least-24-characters" }])("does not advertise unqualified Virginia video with env %o", async (videoEnv) => {
    clearTrafficCameraCatalogCache();
    const features = await trafficCamerasProvider.load(
      { west: -80, south: 37, east: -79, north: 38 }, ["traffic-cameras"],
      {
        env: { TRAFFIC_CAMERAS_ENABLED: "1", TRAFFIC_CAMERAS_STATES: "VA", ...videoEnv },
        fetch: async () => Response.json({ features: [{ properties: { id: "va-camera", active: true, problem_stream: false, https_url: "https://unqualified.example.test/va.m3u8" }, geometry: { coordinates: [-79.9, 37.3] } }] }),
      },
    );
    expect(features).toHaveLength(1);
    expect(features[0]?.media).toMatchObject({ playbackUrl: null, videoAvailable: false, sourceHref: "https://511.vdot.virginia.gov/" });
  });
  it("parses active Delaware HLS cameras", () => {
    const result = parseDelawareCameras({
      videoCameras: [{
        id: 7,
        title: "I-95 @ DE 1",
        enabled: true,
        status: "Active",
        lat: 39.7,
        lon: -75.55,
        urls: { m3u8s: "https://video.example.test/de.m3u8" },
      }],
    });
    expect(result[0]).toMatchObject({ state: "DE", id: "7", videoAvailable: true, coordinates: [-75.55, 39.7] });
  });

  it("uses Maryland CHART online/OK cameras and public video metadata", () => {
    const result = parseMarylandCameras({
      data: [{
        id: "cam-1",
        description: "I-95 at MD 100",
        cctvIp: "camera.example.test",
        commMode: "ONLINE",
        opStatus: "OK",
        lat: 39.17,
        lon: -76.72,
        routePrefix: "I",
        routeNumber: "95",
        publicVideoURL: "https://chart.maryland.gov/camera/1",
      }],
    });
    expect(result[0]).toMatchObject({
      state: "MD",
      playbackUrl: "https://camera.example.test/rtplive/cam-1/playlist.m3u8",
      coordinates: [-76.72, 39.17],
    });
  });

  it("drops VDOT problem streams", () => {
    const result = parseVirginiaCameras({
      features: [
        { properties: { id: "ok", active: true, problem_stream: false, https_url: "https://video.example.test/va.m3u8", description: "I-81" }, geometry: { coordinates: [-79.9, 37.3] } },
        { properties: { id: "bad", active: true, problem_stream: true, https_url: "https://video.example.test/bad.m3u8" }, geometry: { coordinates: [-79.8, 37.4] } },
      ],
    });
    expect(result.map((camera) => camera.id)).toEqual(["ok"]);
  });

  it("parses available WV streaming cameras", () => {
    const result = parseWestVirginiaCameras({
      features: [{
        properties: { statewide_id: 12, is_stream: 1, available: 1, descriptive_location: "I-79", url: "https://vtc3.roadsummary.com/wv.m3u8" },
        geometry: { coordinates: [-80.0, 39.0] },
      }],
    });
    expect(result[0]).toMatchObject({ state: "WV", id: "12", videoAvailable: true });
  });

  it("expands each OHGO camera view into a snapshot feature", () => {
    const result = parseOhioCameras({
      Results: [{
        Id: "site-1",
        Latitude: 40.1,
        Longitude: -82.9,
        Location: "I-270",
        Description: "I-270 at US 23",
        CameraViews: [
          { Direction: "NB", LargeUrl: "https://images.example.test/1.jpg" },
          { Direction: "SB", LargeUrl: "https://images.example.test/2.jpg" },
        ],
      }],
    });
    expect(result).toHaveLength(2);
    expect(result.map((camera) => camera.id)).toEqual(["site-1-0", "site-1-1"]);
    expect(result.every((camera) => camera.videoAvailable === false)).toBe(true);
  });

  it("parses 511NJ public-login camera payloads", () => {
    const result = parseNewJerseyCameras({
      data: [{
        id: 44,
        name: "I-295",
        deviceDescription: "@ NJ 73",
        latitude: "39.95",
        longitude: "-75.02",
        cameraMainDetail: [{ camera_use_flag: "HLS", url: "https://xcmdata.example.test/nj.m3u8" }],
      }],
    });
    expect(result[0]).toMatchObject({ state: "NJ", id: "44", coordinates: [-75.02, 39.95], videoAvailable: true });
  });

  it("contacts only states intersecting the current view and honors OHGO key requirements", () => {
    const paNjView = { west: -75.5, south: 39.85, east: -74.9, north: 40.3 };
    expect(relevantTrafficCameraAdapters(paNjView, { TRAFFIC_CAMERAS_ENABLED: "1" }).map((adapter) => adapter.state))
      .toEqual(["PA", "NJ"]);
    const ohioView = { west: -84.5, south: 39.5, east: -83.0, north: 40.5 };
    expect(relevantTrafficCameraAdapters(ohioView, { TRAFFIC_CAMERAS_ENABLED: "1" })).toHaveLength(0);
    expect(relevantTrafficCameraAdapters(ohioView, { TRAFFIC_CAMERAS_ENABLED: "1", OHGO_API_KEY: "k" }).map((adapter) => adapter.state))
      .toEqual(["OH"]);
  });
});
