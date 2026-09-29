import { createMapLibreHost } from "../infrastructure/map/host";

// Fixture: a relative escape out of `src/ui` into `src/infrastructure` is the same
// violation as the alias form, and must not slip past the scanner.
export const relativeFactory = createMapLibreHost;
