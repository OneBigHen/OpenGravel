import { createMapLibreHost } from "@/infrastructure/map/maplibre/host";

// Fixture: the 4.0 review's finding 8 — the UI layer must not import the concrete
// map host. The composition root wires it instead.
export const factory = createMapLibreHost;
