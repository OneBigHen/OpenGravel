export {
  createTomTomTrafficProvider,
  createTomTomTrafficProviderFromEnv,
  TOMTOM_CURRENT_DATA_WINDOW_MS,
  TOMTOM_FLOW_FRESHNESS_WINDOW_MS,
  TOMTOM_FLOW_SEGMENT_PATH,
  TOMTOM_MAX_WAYPOINTS,
  TOMTOM_TRAFFIC_BASE_URL,
  TOMTOM_TRAFFIC_ZOOM,
  type TomTomTrafficProviderOptions,
} from "./tomtom";
export type {
  TrafficAvailability,
  TrafficDepartureApplicability,
  TrafficFreshness,
  TrafficFreshnessStatus,
  TrafficProvider,
  TrafficRequest,
  TrafficResponse,
  TrafficSegment,
  TrafficSpeedClass,
} from "./traffic-provider";
