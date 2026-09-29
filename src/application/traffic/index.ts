export {
  corridorEndpointDistanceMeters,
  matchCorridor,
  matchTrafficCorridor,
  MAX_TRAFFIC_CORRIDOR_MATCH_METERS,
  type CorridorMatch,
  type CorridorSegmentMatch,
} from "./corridor-match";
export {
  buildProtectTheRideCost,
  protectTheRideCost,
  type ProtectTheRideTrafficCost,
  type TrafficDelayBand,
} from "./protect-ride-cost";
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
} from "@/infrastructure/traffic";
