/**
 * Night terrain: the dark repaint of Mapbox Outdoors, run over the real style
 * fixture so the layer ids and colour expressions are the ones Mapbox ships.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NIGHT_CONTRAST, toNightContrast } from "@/infrastructure/map/night-contrast-style";

interface Layer {
  id: string;
  type: string;
  source?: string;
  minzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Style {
  version: number;
  sources: Record<string, unknown>;
  layers: Layer[];
  [key: string]: unknown;
}

const FIXTURE = JSON.parse(
  readFileSync(resolve("tests/fixtures/map/outdoors-v12.json"), "utf8"),
) as Style;

/** The real style plus the live traffic layers Outdoors no longer ships. */
const STYLE: Style = {
  ...FIXTURE,
  sources: {
    ...FIXTURE.sources,
    "mapbox-traffic": { type: "vector" },
    "mapbox-incidents": { type: "vector" },
  },
  layers: [
    ...FIXTURE.layers,
    {
      id: "traffic-road-motorway",
      type: "line",
      source: "mapbox-traffic",
      paint: { "line-color": "hsl(0, 100%, 50%)" },
    },
    {
      id: "incident-point",
      type: "circle",
      source: "mapbox-incidents",
      paint: { "circle-color": "hsl(0, 100%, 50%)" },
    },
  ],
};

const ORIGINAL = JSON.stringify(FIXTURE);
const night = toNightContrast(STYLE);
const layer = (id: string) => night.layers.find((entry) => entry.id === id);

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

function lightness(colour: string): number {
  const value = colour.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex !== null) {
    let digits = hex[1] ?? "";
    if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join("");
    const number = Number.parseInt(digits.slice(0, 6), 16);
    return hslLightness((number >> 16) & 255, (number >> 8) & 255, number & 255);
  }
  const hsl = /^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/.exec(value);
  if (hsl !== null) return Number(hsl[1]);
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (rgb !== null) return hslLightness(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  throw new Error(`unparsed colour: ${colour}`);
}

function hslLightness(red: number, green: number, blue: number): number {
  const channels = [red / 255, green / 255, blue / 255];
  return ((Math.max(...channels) + Math.min(...channels)) / 2) * 100;
}

/** Every colour string anywhere in one layer's paint, with its property path. */
function colours(value: unknown, path: string, into: { path: string; colour: string }[]): void {
  if (typeof value === "string") {
    if (COLOUR.test(value.trim())) into.push({ path, colour: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => colours(entry, `${path}[${index}]`, into));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) colours(entry, `${path}.${key}`, into);
  }
}

/** A tiny evaluator for the paint expressions this repaint emits. */
function evaluate(expression: unknown, feature: Record<string, unknown>): unknown {
  if (!Array.isArray(expression)) return expression;
  const [operator, ...args] = expression as [string, ...unknown[]];
  switch (operator) {
    case "literal":
      return args[0];
    case "get":
      return feature[args[0] as string];
    case "has":
      return Object.hasOwn(feature, args[0] as string);
    case "any":
      return args.some((arg) => evaluate(arg, feature) === true);
    case "==":
      return evaluate(args[0], feature) === evaluate(args[1], feature);
    case "case": {
      for (let index = 0; index < args.length - 1; index += 2) {
        if (evaluate(args[index], feature) === true) return evaluate(args[index + 1], feature);
      }
      return evaluate(args[args.length - 1], feature);
    }
    case "match": {
      const input = evaluate(args[0], feature);
      for (let index = 1; index < args.length - 1; index += 2) {
        const label = args[index];
        const matched = Array.isArray(label) ? label.includes(input) : label === input;
        if (matched) return evaluate(args[index + 1], feature);
      }
      return evaluate(args[args.length - 1], feature);
    }
    default:
      return expression;
  }
}

describe("Night terrain palette", () => {
  it("is the decided Night terrain spec, and nothing on it is pure white", () => {
    expect(NIGHT_CONTRAST).toMatchObject({
      land: "#0f1512",
      forest: "#15251c",
      contour: "#4a5c53",
      contourIndex: "#5f7268",
      water: "#0c1c26",
      waterLine: "#1d3a4a",
      builtUp: "#171c1a",
      casing: "#0b100e",
      motorway: "#7f8984",
      primary: "#4e5853",
      minor: "#2b3531",
      unpaved: "#d6a862",
      unpavedOpacity: 0.8,
      path: "#3b4540",
      label: "#dfe6e2",
      roadLabel: "#8b9690",
      waterLabel: "#6f9bb3",
      halo: "#0b100e",
    });
  });
});

describe("toNightContrast", () => {
  it("drops live traffic, incident and turn layers with their sources", () => {
    expect(layer("traffic-road-motorway")).toBeUndefined();
    expect(layer("incident-point")).toBeUndefined();
    expect(layer("turning-feature")).toBeUndefined();
    expect(layer("turning-feature-outline")).toBeUndefined();
    expect(layer("road-intersection")).toBeUndefined();
    expect(night.sources).not.toHaveProperty("mapbox-traffic");
    expect(night.sources).not.toHaveProperty("mapbox-incidents");
    // 148 Outdoors layers plus the two injected traffic layers, minus two
    // traffic layers and three turn/intersection layers.
    expect(night.layers).toHaveLength(150 - 5);
  });

  it("keeps every colour string at or below 92% lightness", () => {
    const found: { path: string; colour: string }[] = [];
    for (const entry of night.layers) {
      colours(entry.paint, `${entry.id}.paint`, found);
      colours(entry.layout, `${entry.id}.layout`, found);
    }
    expect(found.length).toBeGreaterThan(100);
    for (const { path, colour } of found) {
      expect(lightness(colour), `${path} is ${colour}`).toBeLessThanOrEqual(92);
    }
  });

  it("paints green-black land and a forest tint over it", () => {
    expect(layer("land")?.paint?.["background-color"]).toBe(NIGHT_CONTRAST.land);
    expect(JSON.stringify(layer("landcover")?.paint?.["fill-color"])).toContain(NIGHT_CONTRAST.forest);
    expect(JSON.stringify(layer("landuse")?.paint?.["fill-color"])).toContain(NIGHT_CONTRAST.forest);
    expect(layer("national-park")?.paint?.["fill-color"]).toBe(NIGHT_CONTRAST.forest);
  });

  it("keeps hillshade on with a near-black shadow and a green highlight", () => {
    const hillshade = JSON.stringify(layer("hillshade")?.paint?.["fill-color"]);
    expect(hillshade).toContain("rgba(4, 7, 10, 0.55)");
    expect(hillshade).toContain("rgba(58, 77, 67, 0.3)");
    // The zoom fade is kept: no hillshade detail is drawn past z16.
    expect(hillshade).toContain("rgba(4, 7, 10, 0)");
  });

  it("draws faint contours, brighter on index lines", () => {
    expect(layer("contour-line")?.paint?.["line-color"]).toEqual([
      "match",
      ["get", "index"],
      [5, 10],
      NIGHT_CONTRAST.contourIndex,
      NIGHT_CONTRAST.contour,
    ]);
    expect(layer("contour-line")?.paint?.["line-opacity"]).toEqual([
      "match",
      ["get", "index"],
      [5, 10],
      0.55,
      0.35,
    ]);
  });

  it("ranks roads by importance on near-black casings, gravel tan", () => {
    expect(layer("road-motorway-trunk-case")?.paint?.["line-color"]).toBe(NIGHT_CONTRAST.casing);
    expect(layer("road-motorway-trunk")?.paint?.["line-color"]).toBe(NIGHT_CONTRAST.motorway);
    expect(layer("road-primary")?.paint?.["line-color"]).toBe(NIGHT_CONTRAST.primary);
    expect(layer("road-secondary-tertiary")?.paint?.["line-color"]).toEqual([
      "match",
      ["get", "surface"],
      "unpaved",
      NIGHT_CONTRAST.unpaved,
      NIGHT_CONTRAST.primary,
    ]);
    expect(layer("road-path")?.paint?.["line-color"]).toBe(NIGHT_CONTRAST.path);
  });

  it("draws dark roads in their order of importance (PF-5: one bright line)", () => {
    // A street with no surface value is the minor grey; the town grid is dark.
    expect(evaluate(layer("road-street")?.paint?.["line-color"], { class: "street" })).toBe("#2b3531");
    expect(evaluate(layer("road-street-low")?.paint?.["line-color"], { class: "street" })).toBe("#2b3531");
    expect(layer("road-primary")?.paint?.["line-color"]).toBe("#4e5853");
    expect(evaluate(layer("road-secondary-tertiary")?.paint?.["line-color"], {})).toBe("#4e5853");
    expect(layer("road-motorway-trunk")?.paint?.["line-color"]).toBe("#7f8984");
    expect(layer("road-path")?.paint?.["line-color"]).toBe("#3b4540");
    expect(layer("road-label")?.paint?.["text-color"]).toBe("#8b9690");
  });

  it("fades town streets in with zoom, but keeps gravel at 80% at every zoom", () => {
    const opacity = layer("road-street-low")?.paint?.["line-opacity"] as unknown[];
    expect(opacity.slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    const stops = opacity.slice(3);
    expect(stops.filter((_, index) => index % 2 === 0)).toEqual([10, 12, 14]);
    const outputs = stops.filter((_, index) => index % 2 === 1);
    expect(outputs.map((out) => evaluate(out, { class: "street" }))).toEqual([0, 0.45, 1]);
    expect(outputs.map((out) => evaluate(out, { class: "street", surface: "unpaved" }))).toEqual([0.8, 0.8, 0.8]);
    expect(outputs.map((out) => evaluate(out, { class: "track" }))).toEqual([0.8, 0.8, 0.8]);
    // Outdoors' own z14 step on road-street is kept (street-low draws below it).
    const original = FIXTURE.layers.find((entry) => entry.id === "road-street")?.paint?.["line-opacity"];
    const street = layer("road-street")?.paint?.["line-opacity"] as unknown[];
    expect(street[0]).toBe("step");
    expect(street[2]).toBe(0);
    expect(evaluate(street[4], { class: "street" })).toBe((original as unknown[])[4]);
    // Gravel on a bigger road is at 80% too; a primary road keeps its strength.
    expect(evaluate(layer("road-secondary-tertiary")?.paint?.["line-opacity"], { surface: "unpaved" })).toBeCloseTo(0.8);
    expect(evaluate(layer("road-secondary-tertiary")?.paint?.["line-opacity"], {})).toBe(1);
    expect(layer("road-primary")?.paint?.["line-opacity"]).toBeUndefined();
  });

  it("never paints a road with an unknown surface as paved or gravel", () => {
    const colour = layer("road-minor")?.paint?.["line-color"];
    // The fallback for "no surface value" is the minor grey...
    expect(evaluate(colour, { class: "service" })).toBe(NIGHT_CONTRAST.minor);
    // ...tan only when the tiles actually say unpaved, or for a track.
    expect(evaluate(colour, { class: "service", surface: "unpaved" })).toBe(NIGHT_CONTRAST.unpaved);
    expect(evaluate(colour, { class: "track" })).toBe(NIGHT_CONTRAST.unpaved);
    expect(evaluate(layer("road-secondary-tertiary")?.paint?.["line-color"], {})).toBe(
      NIGHT_CONTRAST.primary,
    );
  });

  it("dashes tracks 3-2 and dots roads whose surface is unknown", () => {
    const dash = layer("road-minor")?.paint?.["line-dasharray"];
    expect(evaluate(dash, { class: "track" })).toEqual([3, 2]);
    expect(evaluate(dash, { class: "service", surface: "paved" })).toEqual([1, 0]);
    expect(evaluate(dash, { class: "service" })).toEqual([0.4, 1.2]);
    // A primary road is paved by class and keeps a solid line.
    expect(layer("road-primary")?.paint?.["line-dasharray"]).toBeUndefined();
  });

  it("keeps geometry, widths and zoom ranges", () => {
    const original = FIXTURE.layers.find((entry) => entry.id === "road-motorway-trunk");
    expect(layer("road-motorway-trunk")?.paint?.["line-width"]).toEqual(original?.paint?.["line-width"]);
    expect(layer("road-motorway-trunk")?.minzoom).toBe(original?.minzoom);
  });

  it("drops every pattern rather than recolouring a bright sprite", () => {
    for (const entry of night.layers) {
      expect(entry.paint?.["fill-pattern"]).toBeUndefined();
      expect(entry.paint?.["line-pattern"]).toBeUndefined();
    }
  });

  it("puts place labels brightest, road names a step quieter, in a dark halo", () => {
    expect(layer("settlement-major-label")?.paint?.["text-color"]).toBe(NIGHT_CONTRAST.label);
    expect(layer("settlement-major-label")?.paint?.["text-halo-color"]).toBe(NIGHT_CONTRAST.halo);
    expect(layer("road-label")?.paint?.["text-color"]).toBe(NIGHT_CONTRAST.roadLabel);
    expect(layer("water-line-label")?.paint?.["text-color"]).toBe(NIGHT_CONTRAST.waterLabel);
    expect(layer("contour-label")?.paint?.["text-color"]).toBe(NIGHT_CONTRAST.contourIndex);
    // No light lozenge sprites: the shield is a dark halo around its ref.
    expect(layer("road-number-shield")?.paint?.["icon-opacity"]).toBe(0);
    expect(layer("road-number-shield")?.paint?.["text-halo-color"]).toBe(NIGHT_CONTRAST.shieldPlate);
  });

  it("mutes POI icons instead of leaving the coloured dots", () => {
    expect(layer("poi-label")?.paint?.["icon-opacity"]).not.toBe(1);
    expect(layer("poi-label")?.paint?.["text-color"]).toBe(NIGHT_CONTRAST.labelSoft);
  });

  it("does not mutate its input", () => {
    expect(JSON.stringify(FIXTURE)).toBe(ORIGINAL);
    expect(STYLE.sources).toHaveProperty("mapbox-traffic");
  });
});
