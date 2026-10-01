import { createHttpPlacesSource } from "@/infrastructure/places/http-places-source";
import { createHttpMapLayersSource } from "@/infrastructure/map-layers/http-map-layers-source";
import { createHttpElevationSource } from "@/infrastructure/elevation/http-elevation-source";
import { createNwsWeatherProvider } from "@/application/preparation/weather-provider";
import { createTomTomTrafficPreparationProvider } from "@/application/preparation/traffic-provider";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import { createRoadHistoryMapLayersSource, type RoadHistoryMapLayersOptions } from "@/application/map-layers/road-history";

export interface AppPreparationProviderOptions {
  readonly roadHistory?: RoadHistoryMapLayersOptions;
}

/** Browser composition root: concrete optional providers stay swappable in tests. */
export function createAppPreparationProviders(
  assetBasePath?: string,
  options: AppPreparationProviderOptions = {},
): PreparationProviderRegistry {
  const mapLayers = createHttpMapLayersSource(assetBasePath === undefined ? {} : { basePath: assetBasePath });
  return {
    weather: createNwsWeatherProvider(),
    traffic: createTomTomTrafficPreparationProvider(),
    places: createHttpPlacesSource(assetBasePath === undefined ? {} : { basePath: assetBasePath }),
    mapLayers: options.roadHistory === undefined
      ? mapLayers
      : createRoadHistoryMapLayersSource(mapLayers, options.roadHistory),
    elevationProfile: createHttpElevationSource(assetBasePath === undefined ? {} : { basePath: assetBasePath }),
  };
}
