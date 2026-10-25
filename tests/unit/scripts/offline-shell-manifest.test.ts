import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeOfflineShellManifest } from "../../../scripts/offline-shell-manifest.mjs";

it("includes lazy chunks, fonts, CSS and both MapLibre worker modules, excluding source maps and server code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ogv-shell-manifest-"));
  try {
    await mkdir(join(dir, "static/chunks"), { recursive: true });
    await mkdir(join(dir, "static/media"), { recursive: true });
    await mkdir(join(dir, "server"));
    for (const file of ["static/chunks/lazy-hash.js", "static/chunks/style-hash.css", "static/chunks/lazy-hash.js.map", "static/media/font-hash.woff2", "server/secret.js"]) {
      await writeFile(join(dir, file), "fixture");
    }
    await writeOfflineShellManifest(dir, "test-build");
    const manifest = JSON.parse(await readFile(join(dir, "static/ogv-shell/test-build.json"), "utf8"));
    expect(manifest).toEqual({
      buildId: "test-build",
      assets: [
        "/_next/static/chunks/lazy-hash.js", "/_next/static/chunks/style-hash.css", "/_next/static/media/font-hash.woff2",
        "/vendor/maplibre/maplibre-gl-worker.mjs", "/vendor/maplibre/maplibre-gl-shared.mjs",
      ],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
