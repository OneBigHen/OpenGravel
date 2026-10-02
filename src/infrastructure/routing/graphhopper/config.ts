/**
 * One deployment authority for GraphHopper connection settings.
 *
 * Planning, health checks and any future provider diagnostics must resolve the
 * router URL the same way. Duplicating a fallback URL in separate server
 * modules can make health probe a different service than planning uses.
 */

export const DEFAULT_GRAPHHOPPER_URL = "http://127.0.0.1:8989";

export function graphHopperUrlFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env["GRAPHHOPPER_URL"]?.trim();
  return configured === undefined || configured === ""
    ? DEFAULT_GRAPHHOPPER_URL
    : configured;
}
