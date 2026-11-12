/**
 * Browser composition for "Keep for no signal" (R3-7): the ride-pack service
 * wired to Cache Storage, IndexedDB and the rider's saved rides.
 */

import type { LibraryService } from "@/application/library/library-service";
import { createRidePackService, type KeepSource, type RidePackService } from "@/application/offline/ride-pack";
import { surfaceRunSpans } from "@/application/roads/engine-road-evidence";
import type { RideId } from "@/domain/ride/ids";
import {
  createCacheRideTileStore,
  createIndexedDbRidePackStore,
  rideHasSpaceFor,
} from "@/infrastructure/offline/ride-pack-stores";

export function createBrowserRidePackService(library?: Pick<LibraryService, "savedRideLine">): RidePackService {
  return createRidePackService({
    loadRide: async (rideId): Promise<KeepSource | null> => {
      const saved = await library?.savedRideLine(rideId as RideId);
      if (saved == null) return null;
      const surfaceRuns = surfaceRunSpans(saved.line.evidence["surfaceMix"]);
      return {
        rideId,
        title: saved.title,
        line: saved.line.geometry,
        ...(saved.line.instructions === undefined ? {} : { instructions: saved.line.instructions }),
        ...(surfaceRuns === null ? {} : { surfaceRuns }),
      };
    },
    tiles: createCacheRideTileStore(),
    packs: createIndexedDbRidePackStore(),
    hasSpaceFor: rideHasSpaceFor,
  });
}
