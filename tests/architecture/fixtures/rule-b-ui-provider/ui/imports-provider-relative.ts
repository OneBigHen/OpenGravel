import { lookupPlace } from "../infrastructure/providers/tomtom-places";

// Fixture: Rule B — provider helper modules are not UI dependencies.
export const placeLookup = lookupPlace;
