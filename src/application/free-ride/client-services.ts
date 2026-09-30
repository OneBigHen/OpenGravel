/**
 * Wires the Free Ride route-query services from application ports.
 *
 * The provider factory comes from the existing browser route-planning
 * composition root. Keep the two provider instances separate because each
 * holds its own active `/api/route-plan` attempt identity.
 */

import { createLiveSuggestionQuery } from "@/application/free-ride/live-suggestion-query";
import { createReturnPlanner } from "@/application/free-ride/return-plan";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type { LiveSuggestionRouteProvider } from "@/application/free-ride/live-suggestion-query";
import type { PersonalRideTrace } from "@/application/roads/personal-road-history";

export function createClientFreeRideServices(deps: {
  readonly rides: RideRepositoryPort;
  readonly geometry: GeometryStore;
  readonly providerFactory: () => LiveSuggestionRouteProvider;
  readonly rideHistory?: () => Promise<readonly PersonalRideTrace[]>;
}) {
  return {
    suggestionQuery: createLiveSuggestionQuery({
      rides: deps.rides,
      geometry: deps.geometry,
      provider: deps.providerFactory(),
      ...(deps.rideHistory === undefined ? {} : { rideHistory: deps.rideHistory }),
    }),
    returnPlanner: createReturnPlanner({
      rides: deps.rides,
      geometry: deps.geometry,
      provider: deps.providerFactory(),
    }),
  };
}
