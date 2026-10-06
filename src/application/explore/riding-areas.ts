import type { CatalogEntry } from "./catalog";

/** Broad browsing windows, based on where a ride starts, not official boundaries. */
export const PA_RIDING_AREAS = [
  { id: "eastern-pa", label: "Lehigh Valley & Poconos", west: -76.25, east: -74.6, south: 40.3, north: 42.3 },
  { id: "southeast-pa", label: "Philadelphia & Southeast PA", west: -76.25, east: -74.6, south: 39.7, north: 40.3 },
  { id: "central-pa", label: "Central PA & Bald Eagle", west: -78.5, east: -76.25, south: 39.7, north: 41.3 },
  { id: "northern-pa", label: "PA Wilds & Northern Tier", west: -78.5, east: -76.25, south: 41.3, north: 42.3 },
  { id: "western-pa", label: "Pittsburgh, Erie & Western PA", west: -80.7, east: -78.5, south: 39.7, north: 42.3 },
] as const;

export type PaRidingArea = typeof PA_RIDING_AREAS[number]["id"];

export function parsePaRidingArea(value: string | null): PaRidingArea | undefined {
  return PA_RIDING_AREAS.find((area) => area.id === value)?.id;
}

export function startsInPaRidingArea(entry: CatalogEntry, id: PaRidingArea): boolean {
  const area = PA_RIDING_AREAS.find((area) => area.id === id);
  const start = (entry.previewGeometry ?? entry.geometry)[0];
  return area !== undefined && start !== undefined
    && start.lon >= area.west && start.lon < area.east
    && start.lat >= area.south && start.lat < area.north;
}
