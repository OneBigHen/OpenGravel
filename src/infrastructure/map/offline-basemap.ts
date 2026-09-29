/**
 * OpenGravel's own basemap, drawn from downloaded PMTiles archives (Lane A2).
 *
 * Mapbox and TomTom terms forbid bulk caching, so offline the map draws
 * Protomaps' OpenStreetMap vector tiles that we host and the rider stores on
 * the device. The style comes from `@protomaps/basemaps`, recoloured toward
 * the Outdoors look the online map uses, in OpenGravel's own palette.
 *
 * Everything the style fetches goes through two MapLibre protocols, so none of
 * it needs a network: `pmtiles://` reads the archive files by byte range, and
 * `ogvasset://` answers glyphs and sprites from Cache Storage (stored with the
 * archive) before trying the network.
 */

import { LIGHT, layers, type Flavor } from "@protomaps/basemaps";
import { PMTiles, Protocol, type Source } from "pmtiles";

import { BASEMAP_ASSET_CACHE, BasemapArchiveStore } from "@/infrastructure/offline/basemap-archive-store";

export const OFFLINE_BASEMAP_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>';

/** The Outdoors-like flavour: warm paper land, green woods, blue water, amber main roads. */
export const OPENGRAVEL_FLAVOR: Flavor = {
  ...LIGHT,
  background: "#f4f0e7",
  earth: "#f1ede2",
  park_a: "#d3e2c3",
  park_b: "#c8dbb5",
  wood_a: "#d6e4c6",
  wood_b: "#c9dcb6",
  scrub_a: "#dfe7cf",
  scrub_b: "#d6e1c3",
  water: "#a9cfe3",
  buildings: "#e2dccf",
  highway: "#f2b073",
  highway_casing_early: "#d9894e",
  highway_casing_late: "#d9894e",
  major: "#fbe0a0",
  major_casing_early: "#d7b979",
  major_casing_late: "#d7b979",
  minor_a: "#ffffff",
  minor_b: "#ffffff",
  boundaries: "#9da98f",
  city_label: "#243a35",
  city_label_halo: "#fbf9f4",
  subplace_label: "#5f6766",
  state_label: "#65745d",
  roads_label_major: "#3b4945",
  roads_label_minor: "#5f6766",
};

export interface MapLibreProtocolHost {
  addProtocol(name: string, action: (params: { url: string }, abort: AbortController) => Promise<{ data: unknown }>): void;
}

/**
 * A downloaded archive as a pmtiles source. The key carries the file's
 * modification time, so an updated archive is a new source rather than a
 * stale handle on bytes that were replaced.
 */
export function archiveSource(file: File): Source {
  const key = `ogv-${file.name.replace(/\.pmtiles$/, "")}-${file.lastModified.toString(36)}`;
  return {
    getKey: () => key,
    getBytes: async (offset, length) => ({ data: await file.slice(offset, offset + length).arrayBuffer() }),
  };
}

let protocol: Protocol | null = null;
const addedFiles = new Set<string>();

async function assetResponse(path: string): Promise<Response> {
  if (typeof caches !== "undefined") {
    const cached = await (await caches.open(BASEMAP_ASSET_CACHE)).match(path);
    if (cached !== undefined) return cached;
  }
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Offline map asset ${path} is unavailable (${response.status}).`);
  return response;
}

/** Registers the two protocols once per page. */
function ensureProtocols(maplibre: MapLibreProtocolHost): Protocol {
  if (protocol !== null) return protocol;
  protocol = new Protocol();
  maplibre.addProtocol("pmtiles", protocol.tile as never);
  maplibre.addProtocol("ogvasset", async (params) => {
    const path = params.url.replace(/^ogvasset:\/\//, "/");
    const response = await assetResponse(decodeURI(path));
    const data = path.endsWith(".json") ? await response.json() : await response.arrayBuffer();
    return { data };
  });
  return protocol;
}

/** The style for these archives, one vector source per region. */
export function offlineBasemapStyle(archiveKeys: readonly string[]): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  const baseLayers: unknown[] = [];
  const labelLayers: unknown[] = [];
  archiveKeys.forEach((key, index) => {
    const id = `ogv-offline-${index}`;
    sources[id] = { type: "vector", url: `pmtiles://${key}`, attribution: OFFLINE_BASEMAP_ATTRIBUTION };
    const prefix = (layer: { id: string }) => ({ ...layer, id: `${id}-${layer.id}` });
    // Every region's ground first, then every region's labels, so one area's
    // fills never cover a neighbour's town names along a shared border.
    const ground = layers(id, OPENGRAVEL_FLAVOR, { lang: "en" }).filter((layer) => layer.type !== "symbol");
    baseLayers.push(...(index === 0 ? ground : ground.filter((layer) => layer.type !== "background")).map(prefix));
    labelLayers.push(...layers(id, OPENGRAVEL_FLAVOR, { lang: "en", labelsOnly: true }).map(prefix));
  });
  return {
    version: 8,
    glyphs: "ogvasset://basemap-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "ogvasset://basemap-assets/sprites/light",
    sources,
    layers: [...baseLayers, ...labelLayers],
  };
}

/**
 * The offline style when this device holds at least one archive, with its
 * protocols registered; `null` when there is nothing downloaded to draw.
 */
export async function prepareOfflineBasemap(maplibre: MapLibreProtocolHost): Promise<Record<string, unknown> | null> {
  let archives: { readonly regionId: string; readonly file: File }[];
  try {
    archives = await new BasemapArchiveStore().installed();
  } catch {
    return null;
  }
  if (archives.length === 0) return null;
  const registered = ensureProtocols(maplibre);
  const keys = archives.map((archive) => {
    const source = archiveSource(archive.file);
    const key = source.getKey();
    if (!addedFiles.has(key)) {
      registered.add(new PMTiles(source));
      addedFiles.add(key);
    }
    return key;
  });
  return offlineBasemapStyle(keys);
}
