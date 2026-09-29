export * from "./types";
export type { RoadAuthoritySource } from "./road-authority-source";
export { createTtlCache, type CacheRead, type TtlCache } from "./cache-policy";
export { boundingBoxOf, boxesIntersect, indexRoute, matchRecord, padBox, type RouteIndex, type RouteMatch } from "./match";
export { inSeason, isActive, roadAuthorityEffect, type RoadAuthorityEffect } from "./policy";
export { dedupeRecords } from "./dedupe";
export {
  createRoadAuthorityCoordinator,
  ROAD_AUTHORITY_DEADLINE_MS,
  type RoadAuthorityAssessment,
  type RoadAuthorityCoordinator,
  type RoadAuthorityFailureCode,
  type RoadAuthorityVerdict,
  type RoadAuthorityWarningCode,
  type SourceOutcome,
} from "./coordinator";
