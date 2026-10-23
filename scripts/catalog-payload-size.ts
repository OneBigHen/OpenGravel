/**
 * Measures the bytes Explore downloads for its route list.
 *
 * The list only needs a line a card image and the overview map can draw; the
 * route page fetches `/api/catalog/<id>` for the full line. This script reports
 * the served list and a reconstruction of the older list (each route's whole
 * build-time preview) so a payload change can be checked against real catalog
 * data instead of a fixture:
 *
 *   node --conditions=react-server --import tsx scripts/catalog-payload-size.ts
 */

import { gzipSync } from "node:zlib";

import { serverCatalogEntries } from "../src/server/explore/catalog-data";
import { handleCatalogList } from "../src/server/explore/catalog-http";
import type { CatalogEntry } from "../src/application/explore/catalog";

const OLD_MEMBER_POINTS = 24;

function oldMemberLine(entry: CatalogEntry): unknown {
  const points = entry.previewGeometry ?? entry.geometry;
  if (points.length <= OLD_MEMBER_POINTS) return points;
  return Array.from(
    { length: OLD_MEMBER_POINTS },
    (_, index) => points[Math.round((index * (points.length - 1)) / (OLD_MEMBER_POINTS - 1))],
  );
}

function baseline(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const byId = new Map(serverCatalogEntries.map((entry) => [entry.id, entry]));
  const routes = (body["routes"] as readonly Record<string, unknown>[]).map((route) => {
    const entry = byId.get(String(route["id"]));
    const members = (route["catalogMembers"] as readonly Record<string, unknown>[] | undefined) ?? [];
    return {
      ...route,
      ...(entry === undefined ? {} : { preview: entry.previewGeometry ?? entry.geometry }),
      catalogMembers: members.map((member) => {
        const source = byId.get(String(member["id"]));
        return source === undefined ? member : { ...member, previewGeometry: oldMemberLine(source) };
      }),
    };
  });
  return { ...body, routes };
}

function bytes(value: unknown): { readonly raw: number; readonly gzip: number } {
  const json = JSON.stringify(value);
  return { raw: Buffer.byteLength(json), gzip: gzipSync(json).byteLength };
}

function print(label: string, value: unknown): void {
  const size = bytes(value);
  console.log(`${label}: ${size.raw.toLocaleString("en-US")} raw / ${size.gzip.toLocaleString("en-US")} gzip`);
}

const url = new URL("http://localhost/api/catalog");
const response = handleCatalogList(url, serverCatalogEntries);
const routes = response.body["routes"] as readonly Record<string, unknown>[] | undefined;
const previewPoints = (routes ?? []).map((route) => (route["preview"] as readonly unknown[] | undefined)?.length ?? 0);

console.log(`routes: ${routes?.length ?? 0} from ${serverCatalogEntries.length} catalog entries`);
console.log(`route preview points: max ${Math.max(...previewPoints)}`);
print("served list", response.body);
print("previous list (whole build preview, 24-point members)", baseline(response.body));
