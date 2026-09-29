import { describe, expect, it } from "vitest";

import { projectRecordedTrack } from "@/ui/rides/RecordedTrackThumbnail";

describe("recorded track thumbnail projection", () => {
  it("keeps the line within its viewbox and handles a flat axis", () => {
    expect(projectRecordedTrack([])).toEqual([]);
    expect(projectRecordedTrack([{ lon: 1, lat: 1 }])).toEqual([]);
    expect(projectRecordedTrack([
      { lon: 1, lat: 5 },
      { lon: 2, lat: 5 },
      { lon: 3, lat: 5 },
    ])).toEqual(["6.0,6.0", "80.0,6.0", "154.0,6.0"]);
  });

  it("projects the simplified preview line while retaining its endpoints", () => {
    const line = Array.from({ length: 64 }, (_, index) => ({ lon: index / 64, lat: index / 128 }));
    const points = projectRecordedTrack(line);
    expect(points).toHaveLength(64);
    expect(points[0]).toBe("6.0,46.0");
    expect(points.at(-1)).toBe("154.0,6.0");
  });
});
