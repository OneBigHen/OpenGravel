import { describe, expect, it, vi } from "vitest";
import { createSearchPinImages, createSelectedPlaceLabel, searchLabelImageId } from "@/infrastructure/map/maplibre/search-pin-images";

import { searchPinGlyph } from "@/application/geocoding/place-glyph";

describe("rider search pins", () => {
  it("draws six distinct 32px category glyphs inside 48px touch images without canvas or map fonts", () => {
    const images = createSearchPinImages();
    expect(images).toHaveLength(6);
    expect(new Set(images.map((image) => image.id)).size).toBe(6);
    expect(new Set(images.map((image) => image.data.data.join(","))).size).toBe(6);
    for (const image of images) {
      expect(image.options.pixelRatio).toBe(2);
      expect(image.data.width).toBe(96);
      expect(image.data.height).toBe(96);
      // Visible face extends 16 CSS px each way, with a light ring and dark rim.
      const pixel = (x: number, y: number) => [...image.data.data.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 4)];
      expect(pixel(0, 0)[3]).toBe(0);
      expect(pixel(48, 18)[3]).toBeGreaterThan(200);
      expect(pixel(48, 48)[3]).toBe(255);
      expect(pixel(48, 16).slice(0, 3)).not.toEqual(pixel(48, 21).slice(0, 3));
    }
  });
  it("uses the active category, then a known name/context hint, and otherwise a plain place glyph", () => {
    expect(searchPinGlyph("Wawa Gas", "", null)).toBe("gas");
    expect(searchPinGlyph("Mountain Coffee", "", null)).toBe("coffee");
    expect(searchPinGlyph("Sunset Inn", "", null)).toBe("lodging");
    expect(searchPinGlyph("Joe's", "Restaurant", null)).toBe("food");
    expect(searchPinGlyph("Joe's", "Motorcycle repair", null)).toBe("moto");
    expect(searchPinGlyph("Wawa", "", "gas")).toBe("gas");
    expect(searchPinGlyph("Jim Thorpe", "Pennsylvania", null)).toBe("place");
  });
  it("rasterizes the selected name using browser text and bounds a long name", () => {
    const text = vi.fn();
    const context = {
      measureText: (value: string) => ({ width: value.length * 7 }),
      scale: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      fillText: text,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    };
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    try {
      const image = createSelectedPlaceLabel("Wawa Gas");
      expect(image?.id).toBe(searchLabelImageId("Wawa Gas"));
      expect(image?.data.width).toBe(152);
      expect(text).toHaveBeenLastCalledWith("Wawa Gas", 38, 15);
      const long = createSelectedPlaceLabel("A very long motorcycle repair shop in Pennsylvania");
      expect(long?.data.width).toBe(440);
      expect(text.mock.lastCall?.[0]).toMatch(/…$/);
      expect(context.roundRect).toHaveBeenCalled();
    } finally { canvas.mockRestore(); }
  });
  it("keys selected name images by their full text so renaming replaces the label", () => {
    expect(searchLabelImageId("Wawa Gas")).toBe(searchLabelImageId("Wawa Gas"));
    expect(searchLabelImageId("Wawa Gas")).not.toBe(searchLabelImageId("Wawa"));
  });
});
