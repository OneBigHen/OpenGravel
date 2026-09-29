import { setRideDocument } from "../../application/stores/ride-document-store";

// Fixture: Rule C — map internals must not import ride store setters.
export const writeRide = setRideDocument;
