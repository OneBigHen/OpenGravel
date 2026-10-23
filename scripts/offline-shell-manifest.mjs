import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Include lazy chunks, worker bundles, CSS and local fonts, not only the
 * scripts referenced by the first page's HTML. No provider/map/API data. */
export async function writeOfflineShellManifest(distDir, buildId) {
  const staticDir = join(distDir, "static");
  const files = await readdir(staticDir, { recursive: true, withFileTypes: true });
  const assets = files
    .filter((file) => file.isFile() && /\.(?:js|mjs|css|woff2?|ttf|otf|wasm)$/.test(file.name))
    .map((file) => `/_next/static/${join(file.parentPath, file.name).slice(staticDir.length + 1).replaceAll("\\", "/")}`)
    .sort();
  assets.push("/vendor/maplibre/maplibre-gl-worker.mjs");
  assets.push("/vendor/maplibre/maplibre-gl-shared.mjs");
  const manifestDir = join(staticDir, "ogv-shell");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(join(manifestDir, `${buildId}.json`), JSON.stringify({ buildId, assets }));
}
