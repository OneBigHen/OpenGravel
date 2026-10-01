/**
 * Local road-history overlay over the existing bounded map-layer source.
 *
 * The remote source still owns catalogue transport. This wrapper adds the
 * rider's local observed-history projection only when the explicit
 * `road-history` layer is requested, and never sends local geometry upstream.
 */

import type { LibraryExploreRide } from "@/application/library/library-service";
import {
  observedRoadOverlayFeaturesForPreparedHistory,
  prepareRoadHistory,
  type PreparedRoadHistory,
} from "@/application/roads/explorable-roads";
import type {
  InfoProvider,
  MapLayersResult,
  MapLayersSource,
} from "./types";
import type { MapLayerId } from "./catalog";

const CATALOGUE_LAYERS: readonly MapLayerId[] = ["great-roads", "gravel"];

export interface RoadHistoryMapLayersOptions {
  readonly historyReader: () => Promise<readonly LibraryExploreRide[]>;
}

function uniqueLayers(layers: readonly MapLayerId[]): readonly MapLayerId[] {
  return [...new Set(layers)];
}

function withoutHistoryLayer(layers: readonly MapLayerId[]): readonly MapLayerId[] {
  return layers.filter((layer) => layer !== "road-history");
}

function withUnavailable(result: MapLayersResult, provider: InfoProvider): MapLayersResult {
  return result.unavailable.includes(provider)
    ? result
    : { ...result, unavailable: [...result.unavailable, provider] };
}

export function createRoadHistoryMapLayersSource(
  source: MapLayersSource,
  options: RoadHistoryMapLayersOptions,
): MapLayersSource {
  let preparedHistoryPromise: Promise<PreparedRoadHistory> | null = null;
  const readPreparedHistory = (): Promise<PreparedRoadHistory> => {
    if (preparedHistoryPromise === null) {
      preparedHistoryPromise = options.historyReader().then((history) => prepareRoadHistory(history));
    }
    return preparedHistoryPromise;
  };

  return {
    trafficTileUrl: source.trafficTileUrl,
    ...(source.along === undefined ? {} : { along: source.along.bind(source) }),
    async load(bounds, layers, signal): Promise<MapLayersResult> {
      const historyRequested = layers.includes("road-history");
      const originalLayers = withoutHistoryLayer(layers);
      const requestedLayers = historyRequested
        ? uniqueLayers([...originalLayers, ...CATALOGUE_LAYERS])
        : originalLayers;
      const result = await source.load(bounds, requestedLayers, signal);
      if (!historyRequested) {
        return {
          ...result,
          features: result.features.filter((feature) => originalLayers.includes(feature.layerId)),
        };
      }
      try {
        const history = await readPreparedHistory();
        if (signal?.aborted === true) throw new DOMException("The map-layer read was cancelled.", "AbortError");
        const visible = result.features.filter((feature) => originalLayers.includes(feature.layerId));
        const catalogue = result.features.filter((feature) => CATALOGUE_LAYERS.includes(feature.layerId));
        const overlay = observedRoadOverlayFeaturesForPreparedHistory(catalogue, history);
        const withRoadHistoryStatus = result.unavailable.includes("roads")
          ? withUnavailable(result, "road-history")
          : result;
        return {
          ...withRoadHistoryStatus,
          features: [...visible, ...overlay],
        };
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return withUnavailable({
          ...result,
          features: result.features.filter((feature) => originalLayers.includes(feature.layerId)),
        }, "road-history");
      }
    },
  };
}
