import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

import { archiveSource, offlineBasemapStyle } from "@/infrastructure/map/offline-basemap";

describe("offlineBasemapStyle", () => {
  it("is a valid MapLibre style that needs no third-party host", () => {
    const style = offlineBasemapStyle(["ogv-pennsylvania-1", "ogv-new-jersey-1"]);
    expect(validateStyleMin(style as never)).toEqual([]);
    const sources = Object.values(style.sources as Record<string, { url: string; attribution: string }>);
    expect(sources.map((source) => source.url)).toEqual(["pmtiles://ogv-pennsylvania-1", "pmtiles://ogv-new-jersey-1"]);
    // Only the attribution links name a website; nothing the map loads does.
    expect(JSON.stringify({ ...style, sources: null })).not.toContain("http");
    expect(sources.every((source) => source.attribution.includes("OpenStreetMap"))).toBe(true);
    expect(style.glyphs).toMatch(/^ogvasset:\/\//);
    expect(style.sprite).toMatch(/^ogvasset:\/\//);
  });

  it("draws every region's ground before any region's labels, with one background", () => {
    const layers = offlineBasemapStyle(["a", "b"]).layers as { id: string; type: string }[];
    const firstLabel = layers.findIndex((layer) => layer.type === "symbol");
    expect(layers.slice(firstLabel).every((layer) => layer.type === "symbol")).toBe(true);
    expect(layers.filter((layer) => layer.type === "background")).toHaveLength(1);
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);
  });
});

describe("archiveSource", () => {
  it("reads byte ranges from the file and keys by its version", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "pennsylvania.pmtiles", { lastModified: 36 });
    const source = archiveSource(file);
    expect(source.getKey()).toBe("ogv-pennsylvania-10");
    expect(new Uint8Array((await source.getBytes(1, 3)).data)).toEqual(new Uint8Array([2, 3, 4]));
  });
});
