import type { MapHostFactory } from "@/application/map/map-host";
import { routeCardTitle } from "./card";

// Fixture: the UI layer depends on the *port*, which is what makes the renderer
// swappable and the boundary enforceable.
export function render(factory: MapHostFactory): string {
  return `${typeof factory}${routeCardTitle()}`;
}
