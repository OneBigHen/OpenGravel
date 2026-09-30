import { describe, expect, it } from "vitest";

import { parsePa511CameraPage } from "@/server/map-layers/pa511-cameras";

describe("PA 511 traffic camera catalogue", () => {
  it("parses current camera records and drops disabled or malformed entries", () => {
    const page = parsePa511CameraPage({
      recordsTotal: 3,
      data: [
        {
          id: 101,
          roadway: "I-476",
          county: "Montgomery",
          location: "I-476 @ PA 63",
          latLng: { geography: { wellKnownText: "POINT (-75.3501 40.1512)" } },
          images: [{ id: 201, imageUrl: "/camera/201.jpg", videoUrl: "https://video.example.test/live.m3u8" }],
        },
        {
          id: 102,
          roadway: "US 1",
          latLng: { geography: { wellKnownText: "POINT (-75.1000 40.2000)" } },
          images: [{ id: 202, imageUrl: "/camera/202.jpg", disabled: true }],
        },
        {
          id: 103,
          roadway: "PA 611",
          latLng: { geography: { wellKnownText: "not-a-point" } },
          images: [{ id: 203, imageUrl: "/camera/203.jpg" }],
        },
      ],
    });

    expect(page.total).toBe(3);
    expect(page.cameras).toHaveLength(1);
    expect(page.cameras[0]).toMatchObject({
      id: "101",
      imageId: "201",
      name: "I-476 @ PA 63",
      roadway: "I-476",
      county: "Montgomery",
      coordinates: [-75.3501, 40.1512],
      imageUrl: "https://www.511pa.com/camera/201.jpg",
      videoUrl: "https://video.example.test/live.m3u8",
    });
  });

  it("treats video-disabled camera images as still-only", () => {
    const page = parsePa511CameraPage({
      recordsTotal: 1,
      data: [{
        id: "a",
        roadway: "I-95",
        latLng: { geography: { wellKnownText: "POINT (-75.14 39.95)" } },
        images: [{ id: "b", imageUrl: "/still.jpg", videoUrl: "https://video.example.test/live.m3u8", videoDisabled: true }],
      }],
    });
    expect(page.cameras[0]?.videoUrl).toBeNull();
  });
});
