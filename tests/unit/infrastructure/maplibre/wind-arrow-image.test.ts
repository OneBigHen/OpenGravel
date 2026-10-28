import { describe, expect, it } from "vitest";

import { WIND_BANDS, windArrowImageId } from "@/application/map-layers/wind";
import { createWindArrowImages } from "@/infrastructure/map/maplibre/wind-arrow-image";
import { DEFAULT_MAP_PALETTE, type MapPalette } from "@/infrastructure/map/maplibre/style";

/** The colour most of an image's opaque pixels are: the arrow's fill. */
function dominantColour(image: ReturnType<typeof createWindArrowImages>[number]): string {
  const counts = new Map<string, number>();
  const { data } = image.data;
  for (let at = 0; at < data.length; at += 4) {
    if ((data[at + 3] ?? 0) < 250) continue;
    const key = `${data[at]},${data[at + 1]},${data[at + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  if (winner === undefined) return "none";
  return winner[0];
}

const BAND_PALETTE_SLOT = { calm: "topoSage", breeze: "signalBlue", strong: "goldenHour", gale: "emberStrong" } as const;

describe("wind arrow images", () => {
  it("draws one image per strength band, in the band's palette colour", () => {
    const images = createWindArrowImages(DEFAULT_MAP_PALETTE);
    expect(images.map((image) => image.id)).toEqual(WIND_BANDS.map((band) => windArrowImageId(band.band)));

    for (const band of WIND_BANDS) {
      const image = images.find((entry) => entry.id === windArrowImageId(band.band));
      expect(image).toBeDefined();
      expect(image?.data.width).toBe(image?.data.height);
      expect(image?.options.pixelRatio).toBe(2);
      const slot = BAND_PALETTE_SLOT[band.band];
      const expected = DEFAULT_MAP_PALETTE[slot].slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16));
      expect(dominantColour(image!)).toBe(expected.join(","));
    }
  });

  it("keeps the arrow legible on a light and a dark map by rimming it in the theme's ink", () => {
    const day = createWindArrowImages(DEFAULT_MAP_PALETTE)[0]!;
    const nightPalette: MapPalette = { ...DEFAULT_MAP_PALETTE, ink: "#ecf1ee", paper: "#131a17" };
    const night = createWindArrowImages(nightPalette)[0]!;
    // The fill is the band's fact and never changes with the theme; only the rim does.
    expect(dominantColour(night)).toBe(dominantColour(day));
    expect(day.data.data).not.toEqual(night.data.data);
  });

  it("leaves most of the image transparent so arrows do not blot out the map", () => {
    const image = createWindArrowImages(DEFAULT_MAP_PALETTE)[0]!;
    let opaque = 0;
    for (let at = 3; at < image.data.data.length; at += 4) if ((image.data.data[at] ?? 0) > 0) opaque += 1;
    const share = opaque / (image.data.width * image.data.height);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.5);
  });
});
