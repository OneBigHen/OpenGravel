import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import fixtureData from "../../../data/catalog/e2e-fixture-routes.json";
import { decodeCatalogPolyline } from "@/application/explore/catalog-build";
import { parseCatalogEntries } from "@/application/explore/catalog";

function readProductionCatalog(): unknown {
  const compressedPath = path.join(process.cwd(), "data", "catalog", "routes.json.gz");
  const source = gunzipSync(readFileSync(compressedPath)).toString("utf8");
  return JSON.parse(source) as unknown;
}

function hydrateCatalogRoutes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return parseCatalogEntries(value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return candidate;
    const route = candidate as Record<string, unknown>;
    const previewGeometry = route.previewGeometry ?? route.geometry;
    const geometry = typeof route.geometryPolyline === "string"
      ? decodeCatalogPolyline(route.geometryPolyline)
      : route.geometry;
    return { ...route, geometry, previewGeometry };
  }));
}

const catalogSource = process.env.OGV_CATALOG_FIXTURE === "1" ? fixtureData : readProductionCatalog();

export const serverCatalogEntries = hydrateCatalogRoutes(catalogSource);
