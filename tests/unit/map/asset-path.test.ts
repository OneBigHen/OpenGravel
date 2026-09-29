/**
 * Deployment base paths for the vendored map assets (05 §2; finding 2 of the 4.0
 * review).
 *
 * The worker and its shared module are vendored files, not bundler chunks, so the
 * renderer is told where they live. A deployment behind a prefix therefore has to
 * produce a URL that a browser can actually fetch, and every mistake here is
 * invisible: a relative or doubled path 404s the worker, and MapLibre then draws
 * its background with every source silently unparsed. These tests pin the three
 * shapes a deployment may set, and the two joins that must come out identical.
 */

import { describe, expect, it } from "vitest";

import { assetUrl, normalizeAssetBasePath } from "@/application/map/asset-path";
import { DEFAULT_WORKER_PATH } from "@/infrastructure/map/maplibre/host";

describe("normalizeAssetBasePath", () => {
  it("treats unset, empty and root-only values as no prefix", () => {
    expect(normalizeAssetBasePath(undefined)).toBe("");
    expect(normalizeAssetBasePath(null)).toBe("");
    expect(normalizeAssetBasePath("")).toBe("");
    expect(normalizeAssetBasePath("   ")).toBe("");
    expect(normalizeAssetBasePath("/")).toBe("");
    expect(normalizeAssetBasePath("//")).toBe("");
  });

  it("accepts a prefix with or without its leading slash", () => {
    expect(normalizeAssetBasePath("preview")).toBe("/preview");
    expect(normalizeAssetBasePath("/preview")).toBe("/preview");
  });

  it("absorbs trailing slashes, repeated separators and whitespace", () => {
    expect(normalizeAssetBasePath("/preview/")).toBe("/preview");
    expect(normalizeAssetBasePath("preview//")).toBe("/preview");
    expect(normalizeAssetBasePath("  /preview/  ")).toBe("/preview");
    expect(normalizeAssetBasePath("/a//b/")).toBe("/a/b");
  });

  it("keeps a nested prefix intact", () => {
    expect(normalizeAssetBasePath("/apps/ogv/")).toBe("/apps/ogv");
  });
});

describe("assetUrl", () => {
  it("serves the worker from the origin root when there is no prefix", () => {
    expect(assetUrl(undefined, DEFAULT_WORKER_PATH)).toBe(
      "/vendor/maplibre/maplibre-gl-worker.mjs",
    );
  });

  it("prepends a normalized prefix to a root-relative asset", () => {
    // Every spelling of the same deployment must produce this one URL: the
    // alternative is a relative URL that resolves under the current page and 404s.
    for (const raw of ["preview", "/preview", "preview/", "/preview/", " /preview "]) {
      expect(assetUrl(raw, DEFAULT_WORKER_PATH), raw).toBe(
        "/preview/vendor/maplibre/maplibre-gl-worker.mjs",
      );
    }
  });

  it("treats an asset path without a leading slash as root-relative", () => {
    expect(assetUrl("/preview", "vendor/x.mjs")).toBe("/preview/vendor/x.mjs");
    expect(assetUrl("", "vendor/x.mjs")).toBe("/vendor/x.mjs");
  });

  it("never produces a doubled separator at the join", () => {
    for (const raw of ["/preview", "/preview/", "/preview//"]) {
      expect(assetUrl(raw, "/vendor/maplibre/maplibre-gl-shared.mjs"), raw).toBe(
        "/preview/vendor/maplibre/maplibre-gl-shared.mjs",
      );
    }
  });
});
