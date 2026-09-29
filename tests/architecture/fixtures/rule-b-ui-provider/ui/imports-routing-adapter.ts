import { createGraphHopperAdapter } from "../infrastructure/routing/graphhopper-adapter";

// Fixture: Rule B — UI must not reach a routing adapter implementation.
export const adapter = createGraphHopperAdapter;
