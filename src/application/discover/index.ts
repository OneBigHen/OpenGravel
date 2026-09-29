export * from "./types";
export type { InterestingPlaceAnswer, InterestingPlaceSource, PlaceEnricher } from "./interesting-place-source";
export { createDiscoverCoordinator, DEFAULT_LIMIT, DISCOVER_DEADLINE_MS, MAX_LIMIT, type DiscoverCoordinator } from "./coordinator";
export { dedupePlaces, normalizedName } from "./dedupe";
export { discoveryScore, rankPlaces, type RankContext } from "./rank";
export {
  distanceToLineMeters,
  lineLengthMeters,
  MAX_CORRIDOR_BUFFER_METERS,
  MAX_SAMPLE_RADIUS_METERS,
  MAX_SAMPLES,
  searchAreaFor,
  thinLine,
} from "./search-area";
export { addDiscoveryStopCommand } from "./discovery-commands";
