/**
 * OpenFreeMap's `dark` style is drawn near-black on black: minor roads at
 * #181818 and town names at rgb(101,101,101). On a phone on the handlebars at
 * night that is a blank screen. This repaints it in the Night palette of
 * DESIGN.md §4 (tokens.css): a road hierarchy you can follow, labels in the
 * Night ink colours on a halo of the Night background. Geometry, layers and
 * sources are untouched; only paint values change.
 */

/** Night token values, written out because MapLibre cannot read CSS. */
const NIGHT = {
  bg: "#0b100e",
  ground: "#0e1512",
  green: "#121b16",
  building: "#161e1b",
  water: "#0f1d24",
  waterLabel: "#7f9aa6",
  minor: "#2b3531",
  path: "#252f2b",
  major: "#3d4945",
  motorway: "#5d6964",
  rail: "#2a3330",
  boundary: "#3d4945",
  ink: "#ecf1ee",
  ink2: "#a2aea8",
} as const;

interface StyleLayer {
  readonly id: string;
  readonly type: string;
  paint?: Record<string, unknown>;
}

interface StyleDocument {
  layers?: StyleLayer[];
}

function paint(layer: StyleLayer, values: Record<string, unknown>): void {
  layer.paint = { ...(layer.paint ?? {}), ...values };
}

/** Repaints OpenFreeMap `dark` in place and returns it. Unknown layers keep their paint. */
export function toNightLegible<T extends StyleDocument>(style: T): T {
  for (const layer of style.layers ?? []) {
    const id = layer.id;
    if (layer.type === "background") paint(layer, { "background-color": NIGHT.bg });
    else if (layer.type === "fill") {
      if (id === "water") paint(layer, { "fill-color": NIGHT.water });
      else if (/wood|park|grass/.test(id)) paint(layer, { "fill-color": NIGHT.green });
      else if (id === "building") paint(layer, { "fill-color": NIGHT.building });
      else if (/residential|landuse|landcover/.test(id)) paint(layer, { "fill-color": NIGHT.ground });
    } else if (layer.type === "line") {
      if (id === "waterway") paint(layer, { "line-color": NIGHT.water });
      else if (id === "highway_path") paint(layer, { "line-color": NIGHT.path });
      else if (/highway_minor|major_subtle|motorway_subtle/.test(id)) paint(layer, { "line-color": NIGHT.minor });
      else if (/major_casing|motorway_casing/.test(id)) paint(layer, { "line-color": NIGHT.bg });
      else if (/major_inner/.test(id)) paint(layer, { "line-color": NIGHT.major });
      else if (/motorway_inner/.test(id)) paint(layer, { "line-color": NIGHT.motorway });
      else if (/^railway(?!.*dashline)/.test(id)) paint(layer, { "line-color": NIGHT.rail });
      else if (/^boundary/.test(id)) paint(layer, { "line-color": NIGHT.boundary });
    } else if (layer.type === "symbol") {
      const halo = { "text-halo-color": NIGHT.bg, "text-halo-width": 1.2, "text-halo-blur": 0.5 };
      if (id === "water_name") paint(layer, { "text-color": NIGHT.waterLabel, ...halo });
      else if (/^highway_name/.test(id)) paint(layer, { "text-color": NIGHT.ink2, ...halo });
      else if (/place_(city|city_large|state|country)/.test(id)) paint(layer, { "text-color": NIGHT.ink, ...halo });
      else if (/^place_/.test(id)) paint(layer, { "text-color": NIGHT.ink2, ...halo });
    }
  }
  return style;
}
