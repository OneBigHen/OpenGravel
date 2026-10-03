/**
 * One deployment authority for GraphHopper connection settings.
 *
 * Planning, health checks and any future provider diagnostics must resolve the
 * router URL the same way. Duplicating a fallback URL in separate server
 * modules can make health probe a different service than planning uses.
 */

export const DEFAULT_GRAPHHOPPER_URL = "http://127.0.0.1:8989";

export interface GraphHopperEnv {
  readonly GRAPHHOPPER_URL?: string | undefined;
}

export function graphHopperUrlFromEnv(
  env: GraphHopperEnv = { GRAPHHOPPER_URL: process.env["GRAPHHOPPER_URL"] },
): string {
  const configured = env["GRAPHHOPPER_URL"]?.trim();
  return configured === undefined || configured === ""
    ? DEFAULT_GRAPHHOPPER_URL
    : configured;
}
