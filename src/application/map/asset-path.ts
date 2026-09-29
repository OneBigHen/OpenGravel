/**
 * Deployment base paths for the map's vendored assets (05 §2; finding 2 of the
 * 4.0 review).
 *
 * The MapLibre worker is a vendored file (`public/vendor/maplibre`), not a
 * bundler chunk, so the renderer has to be told where it is served from. A
 * deployment behind a path prefix (`/preview`, `/ogv`) needs that prefix on both
 * the worker URL and the shared module the worker imports beside it, and the
 * *only* honest reading of a prefix is a normalized one: `prefix`, `/prefix` and
 * `/prefix/` must all produce exactly one URL shape.
 *
 * Two failure modes are why this is a module with its own tests rather than a
 * template string in the renderer:
 *
 * - **A missing leading slash.** `<base>vendor/...` is a *relative* URL: from
 *   `/planner` the browser resolves it to `/planner/vendor/...`, which 404s, and
 *   MapLibre then draws its background with every source silently unparsed.
 * - **A doubled or missing separator.** `/prefix` + `vendor/...` or `/prefix/` +
 *   `/vendor/...` are both 404s, and a 404 here is invisible: the worker failing
 *   produces no exception, only a map that never finishes loading.
 *
 * Both are pure functions, so a deployment claim about a prefixed build is
 * testable without a build, and the composition root can normalize the
 * environment value exactly once.
 */

/** The empty base path: no prefix, i.e. assets served from the origin root. */
export const ROOT_ASSET_BASE_PATH = "";

/**
 * Normalizes a base path into `""` or `"/prefix"`.
 *
 * Surrounding whitespace, a missing leading slash, repeated separators and any
 * trailing slash are all absorbed, because every one of them produces a different
 * URL for the same deployment. `"/"` and `""` both mean the origin root, so an
 * unset, empty or root-only value is the same value — which is what lets a
 * deployment opt out of the prefix by leaving the variable empty.
 */
export function normalizeAssetBasePath(raw: string | undefined | null): string {
  if (typeof raw !== "string") return ROOT_ASSET_BASE_PATH;
  const collapsed = raw.trim().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (collapsed === "" || collapsed === "/") return ROOT_ASSET_BASE_PATH;
  return collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
}

/**
 * Joins a base path with a root-relative asset path.
 *
 * The asset path is the renderer's own (`/vendor/maplibre/...`), and it is
 * always treated as root-relative: a prefix is prepended, never merged into the
 * middle of the path.
 */
export function assetUrl(basePath: string | undefined | null, assetPath: string): string {
  const base = normalizeAssetBasePath(basePath);
  const suffix = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
  return `${base}${suffix}`;
}
