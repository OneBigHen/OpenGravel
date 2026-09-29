import { setRideIntent } from "../../infrastructure/storage/ride-adapter";

// Fixture: Rule C — a neutral module path is still rejected when the imported
// binding is a ride-state setter.
export const writeIntent = setRideIntent;
