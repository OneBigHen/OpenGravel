/**
 * The deployment prefix for the vendored map assets, read at the composition root
 * (4.0 review finding 2).
 *
 * The page is the only place that reads an environment variable for this, and it
 * reads it per request (`export const dynamic = "force-dynamic"`), so a deployment
 * that adds a path prefix does not need a rebuild to have its worker served from
 * the right URL. The normalization itself belongs to the map's asset-path module —
 * this function exists so the *variable name* lives in the composition root and the
 * join stays a pure, tested function shared with the renderer.
 *
 * A missing value means the origin root, which is what a deployment without a
 * prefix wants and what an unset variable has to mean: there is no third option,
 * because an unset prefix must not produce a relative URL.
 */

import {
  normalizeAssetBasePath,
  ROOT_ASSET_BASE_PATH,
} from "@/application/map/asset-path";

/**
 * The environment shape this reads.
 *
 * It carries an index signature as well as the one named variable, because that is
 * what `process.env` satisfies structurally: a named-only interface has no
 * properties in common with `ProcessEnv` (a string index signature), so the page
 * could not pass it.
 */
export interface AssetBasePathEnvironment {
  readonly [name: string]: string | undefined;
  readonly NEXT_PUBLIC_BASE_PATH?: string | undefined;
}

/** The normalized deployment prefix for one process's environment. */
export function assetBasePathFromEnv(
  env: AssetBasePathEnvironment,
): string {
  return normalizeAssetBasePath(env.NEXT_PUBLIC_BASE_PATH ?? ROOT_ASSET_BASE_PATH);
}
