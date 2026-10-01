import type { Coordinate } from "@/domain/ride/types";
import type { ProviderRouteOptions } from "@/application/planner/route-provider";

export interface RoutingQualityCase {
  readonly id: string;
  readonly label: string;
  readonly origin: Coordinate;
  readonly destination: Coordinate;
  readonly options?: Partial<ProviderRouteOptions>;
  /**
   * Why this case belongs in the corpus. Diagnostic metadata only; tests never
   * use it to declare a route "good".
   */
  readonly tests: readonly string[];
}

/**
 * Stable PA/NJ motorcycle-routing questions for live GraphHopper comparison.
 *
 * The corpus intentionally mixes:
 * - urban/suburban escape,
 * - destination rides,
 * - mountain/backroad corridors,
 * - short local rides where bad doglegs are especially expensive,
 * - mixed-surface territory.
 *
 * Coordinates are ordinary public place coordinates, not rider history.
 */
export const ROUTING_QUALITY_CORPUS: readonly RoutingQualityCase[] = [
  {
    id: "allentown-stroudsburg",
    label: "Allentown → Stroudsburg",
    origin: { lon: -75.4714, lat: 40.6023 },
    destination: { lon: -75.1946, lat: 40.9868 },
    tests: ["profile differentiation", "Pocono approach", "urban escape"],
  },
  {
    id: "hawk-mountain-jim-thorpe",
    label: "Hawk Mountain → Jim Thorpe",
    origin: { lon: -75.9832, lat: 40.6364 },
    destination: { lon: -75.7387, lat: 40.8636 },
    options: { avoidHighways: true },
    tests: ["sustained bends", "mountain roads", "surface variation"],
  },
  {
    id: "doylestown-new-hope",
    label: "Doylestown → New Hope",
    origin: { lon: -75.1299, lat: 40.3101 },
    destination: { lon: -74.9513, lat: 40.3643 },
    options: { avoidHighways: true },
    tests: ["short ride", "suburban doglegs", "Delaware River approach"],
  },
  {
    id: "harrisburg-lancaster",
    label: "Harrisburg → Lancaster",
    origin: { lon: -76.8867, lat: 40.2732 },
    destination: { lon: -76.3055, lat: 40.0379 },
    tests: ["destination ride", "time tradeoff", "route diversity"],
  },
  {
    id: "reading-jim-thorpe",
    label: "Reading → Jim Thorpe",
    origin: { lon: -75.9269, lat: 40.3356 },
    destination: { lon: -75.7387, lat: 40.8636 },
    options: { avoidHighways: true },
    tests: ["longer backroads", "mountain transition", "continuous character"],
  },
  {
    id: "west-chester-lancaster",
    label: "West Chester → Lancaster",
    origin: { lon: -75.6055, lat: 39.9607 },
    destination: { lon: -76.3055, lat: 40.0379 },
    options: { avoidHighways: true },
    tests: ["Chester County backroads", "suburban escape", "arrival quality"],
  },
  {
    id: "bethlehem-delaware-water-gap",
    label: "Bethlehem → Delaware Water Gap",
    origin: { lon: -75.3705, lat: 40.6259 },
    destination: { lon: -75.1424, lat: 40.9793 },
    options: { avoidHighways: true },
    tests: ["river/mountain corridor", "sustained curves", "junction workload"],
  },
  {
    id: "cherry-hill-batsto",
    label: "Cherry Hill → Batsto Village",
    origin: { lon: -75.0307, lat: 39.9348 },
    destination: { lon: -74.6477, lat: 39.6418 },
    options: {
      avoidHighways: true,
      surfacePreference: "mixed",
    },
    tests: ["New Jersey", "Pine Barrens approach", "mixed-surface intent"],
  },
] as const;
