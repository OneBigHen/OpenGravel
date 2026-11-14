import { describe, expect, it } from "vitest";

import { createPlacePillImages, PLACE_IMAGE_IDS } from "@/infrastructure/map/maplibre/place-images";
import { infoLayerSpecs } from "@/infrastructure/map/maplibre/info-layers";
import {
  DEFAULT_MAP_PALETTE,
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  overlayLayers,
  placeLayers,
  readMapPalette,
} from "@/infrastructure/map/maplibre/style";
import { contrastRatio } from "../../../helpers/contrast";

/** The Night theme's map tokens, from tokens.css. */
const NIGHT_TOKENS: Readonly<Record<string, string>> = {
  "--og-map-ink": "#ecf1ee",
  "--og-map-paper": "#131a17",
  "--og-map-slate": "#a2aea8",
  "--og-map-gold": "#e5c07a",
  "--og-map-route": "#c9a2f0",
};

/** The flat fill an image was drawn with, sampled inside its body. */
function fillOf(palette: Parameters<typeof createPlacePillImages>[0], id: string): [number, number, number] {
  const image = createPlacePillImages(palette).find((candidate) => candidate.id === id);
  if (image === undefined) throw new Error(`${id} was not drawn`);
  const at = (20 * image.data.width + 30) * 4;
  return [image.data.data[at] as number, image.data.data[at + 1] as number, image.data.data[at + 2] as number];
}

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16)) as [number, number, number];
}

function hexOf(colour: readonly [number, number, number]): string {
  return `#${colour.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** What the eye sees when `text` is painted at `opacity` over `fill`. */
function over(text: string, fill: readonly [number, number, number], opacity: number): string {
  const base = rgb(text.replace("#", ""));
  return hexOf([0, 1, 2].map((index) => (base[index] as number) * opacity + (fill[index] as number) * (1 - opacity)) as [number, number, number]);
}

/** The pill's own text opacity, as painted: a `match` on the tone, or 1. */
function textOpacity(paint: Record<string, unknown> | undefined): number {
  const value = paint?.["text-opacity"];
  if (Array.isArray(value) && value[0] === "match") return Number(value[3]);
  return typeof value === "number" ? value : 1;
}

describe("place pill text contrast", () => {
  it.each(["day", "night"] as const)("clears 4.5:1 on every pill it draws (%s)", (theme) => {
    const root = document.documentElement;
    if (theme === "night") {
      for (const [name, value] of Object.entries(NIGHT_TOKENS)) root.style.setProperty(name, value);
    }
    try {
      const palette = readMapPalette(root);
      const pill = placeLayers(palette).find((layer) => layer.id === MAP_LAYER_IDS.placePill);
      const alpha = textOpacity(pill?.paint as Record<string, unknown> | undefined);
      const pairs: [string, [number, number, number]][] = [
        // Live and soon events: Ink on the tinted/paper pill.
        [palette.ink, fillOf(palette, PLACE_IMAGE_IDS.live)],
        [palette.ink, fillOf(palette, PLACE_IMAGE_IDS.soon)],
        // A quiet venue is quieter in colour, not in opacity (QA-05).
        [palette.slate, fillOf(palette, PLACE_IMAGE_IDS.quiet)],
        // The selected pill is Paper on Ink.
        [palette.paper, fillOf(palette, PLACE_IMAGE_IDS.selected)],
      ];
      for (const [text, fill] of pairs) {
        const visible = over(text, fill, alpha);
        expect(contrastRatio(visible, hexOf(fill)), `${text} on ${hexOf(fill)} (${theme})`).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      for (const name of Object.keys(NIGHT_TOKENS)) root.style.removeProperty(name);
    }
  });
});

describe("place map layers", () => {
  it("draws place marks first, below the route and editing overlays", () => {
    const layers = overlayLayers(DEFAULT_MAP_PALETTE);
    const firstRoute = layers.findIndex((layer) => layer.id === MAP_LAYER_IDS.routeSelected);
    const firstPlace = layers.findIndex((layer) => layer.id === MAP_LAYER_IDS.placeDot);
    const firstSketch = layers.findIndex((layer) => layer.id === MAP_LAYER_IDS.sketchLine);

    // Map-layer information (phase 8) sits under places; places lead the rest.
    expect(firstPlace).toBe(infoLayerSpecs(DEFAULT_MAP_PALETTE).length);
    expect(firstPlace).toBeLessThan(firstRoute);
    expect(firstPlace).toBeLessThan(firstSketch);
    expect(layers.filter((layer) => layer.source === MAP_SOURCE_IDS.places).length).toBeGreaterThan(1);
  });

  it("uses the place palette without Ember or Signal Blue", () => {
    const placePaint = placeLayers(DEFAULT_MAP_PALETTE)
      .map((layer) => layer.paint ?? {})
      .map((paint) => JSON.stringify(paint))
      .join(" ");

    expect(placePaint).not.toContain(DEFAULT_MAP_PALETTE.ember);
    expect(placePaint).not.toContain(DEFAULT_MAP_PALETTE.emberStrong);
    expect(placePaint).not.toContain(DEFAULT_MAP_PALETTE.signalBlue);
    expect(placePaint).toContain(DEFAULT_MAP_PALETTE.goldenHour);
  });

  it("draws image-only search pins and a larger selected pin without map glyphs", () => {
    const pins = placeLayers(DEFAULT_MAP_PALETTE).find((layer) => layer.id === MAP_LAYER_IDS.searchPin);
    expect(pins?.minzoom).toBeUndefined();
    expect(pins?.filter).toEqual(["==", ["get", "kind"], "search"]);
    expect(pins?.layout?.["text-field"]).toBeUndefined();
    expect(pins?.layout?.["icon-image"]).toEqual(["get", "pinImage"]);
    expect(pins?.layout?.["icon-size"]).toEqual(["case", ["==", ["get", "selected"], true], 1.25, 1]);
    expect(pins?.layout?.["icon-allow-overlap"]).toBe(true);
    const label = placeLayers(DEFAULT_MAP_PALETTE).find((layer) => layer.id === MAP_LAYER_IDS.searchLabel);
    expect(label?.layout?.["text-field"]).toBeUndefined();
    expect(label?.layout?.["icon-image"]).toEqual(["get", "labelImage"]);
    expect(label?.filter).toEqual(["all", ["==", ["get", "kind"], "search"], ["==", ["get", "selected"], true]]);
  });

  it("keeps the selected pill visible through symbol collisions", () => {
    const selected = placeLayers(DEFAULT_MAP_PALETTE).find(
      (layer) => layer.id === MAP_LAYER_IDS.placeSelected,
    );

    expect(selected?.filter).toEqual(["all", ["==", ["get", "selected"], true], ["!=", ["get", "kind"], "search"]]);
    expect(selected?.layout).toMatchObject({
      "icon-allow-overlap": true,
      "text-allow-overlap": true,
    });
    expect(selected?.layout?.["text-field"]).toEqual(["get", "pill"]);
  });
});
