import type { HostedStyleLayer } from "@/infrastructure/map/maplibre/visual-detail";

/**
 * A ride map is read at speed, so it carries the road and the line, not every
 * 7-Eleven, nail salon and municipal lot the basemap knows about. This hides the
 * basemap's own point-of-interest labels while riding and keeps one kind: gas.
 * (Stops the rider added, ride-along pins and places are OpenGravel's own
 * `ogv-` / `og-` layers and are never touched here.)
 *
 * Pure: it decides which hosted layers are POI labels and what their filter
 * becomes; the renderer adapter applies it.
 */

/** Basemap symbol layers that name businesses and facilities (Mapbox, OpenMapTiles). */
const POI_LAYER_ID = /(^|[-_])poi([-_]|$)|^poi/i;

/** A basemap POI label layer: a symbol layer of the hosted style, not ours. */
export function isBasemapPoiLayer(layer: Pick<HostedStyleLayer, "id" | "type">): boolean {
  if (layer.type !== "symbol") return false;
  if (layer.id.startsWith("ogv-") || layer.id.startsWith("og-")) return false;
  return POI_LAYER_ID.test(layer.id);
}

/** The feature properties the supported styles use to say "this is a gas station". */
const GAS_TESTS: readonly unknown[] = [
  ["==", ["get", "maki"], "fuel"],
  ["==", ["get", "class"], "fuel"],
  ["==", ["get", "subclass"], "fuel"],
  ["==", ["get", "class"], "gas"],
];

/** The layer's own filter narrowed to gas stations. */
export function gasOnlyFilter(original: unknown): unknown {
  const gas = ["any", ...GAS_TESTS];
  return original === undefined || original === null ? gas : ["all", original, gas];
}

export interface DeclutterTarget {
  readonly id: string;
  /** The layer's filter as the hosted style had it. */
  readonly original: unknown;
}

/** The POI label layers of a style with the filters they came with. */
export function declutterTargets(
  layers: readonly (HostedStyleLayer & { readonly filter?: unknown })[],
): readonly DeclutterTarget[] {
  return layers.filter(isBasemapPoiLayer).map((layer) => ({ id: layer.id, original: layer.filter ?? null }));
}
