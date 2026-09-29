/**
 * The road-authority capability port (ROUTE-INTELLIGENCE-PROVIDER-MESH §4, §6
 * lane A). Adapters live in `src/infrastructure/route-intelligence/*`; vendor
 * payloads never cross this line.
 */

import type {
  BoundingBox,
  CapabilityProbe,
  RoadAuthoritySnapshot,
  RoadAuthoritySourceInfo,
  SourceBudget,
} from "./types";

export interface RoadAuthoritySource {
  readonly info: RoadAuthoritySourceInfo;
  readonly budget: SourceBudget;
  /** Cheap and synchronous: is this source configured at all? */
  probe(): CapabilityProbe;
  /**
   * Everything the source knows inside `corridor`, from its cache when it can.
   * Never throws: an outage is `status: "unavailable"` with a reason.
   */
  snapshot(corridor: BoundingBox, signal: AbortSignal): Promise<RoadAuthoritySnapshot>;
}
