import {
  setRideIntent,
} from "../../infrastructure/storage/ride-adapter";

// Fixture: Rule C — the whole declaration is analyzed, so a multiline binding
// cannot hide a ride-state setter imported from a neutral path.
export const writeIntent = setRideIntent;
