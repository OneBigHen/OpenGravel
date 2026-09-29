#!/usr/bin/env node
/**
 * Builds the OSM half of Discover from a regional extract (no Overpass at
 * runtime). Run by build-osm-places.sh:
 *
 *   osmium tags-filter  → only candidate tags
 *   osmium export       → GeoJSON sequence
 *   this script         → osm-places.json, categorized and de-noised
 *
 * Usage: node build-osm-places.mjs out.json in1.geojsonseq [in2.geojsonseq …]
 *
 * The taxonomy mirrors src/application/discover/types.ts. The rule is
 * "interesting to ride to", not "every mapped feature": ordinary parks,
 * plaques and towers are dropped unless something marks them notable.
 */

import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length === 0) {
  console.error("usage: build-osm-places.mjs out.json in.geojsonseq [...]");
  process.exit(2);
}

const notable = (p) => Boolean(p.wikidata || p.wikipedia || p.heritage || p["heritage:operator"]);

/** → [category, ...more] or null when the feature is not worth a stop. */
export function categorize(p) {
  const named = typeof p.name === "string" && p.name.trim().length > 0;
  // A covered bridge, not an enclosed rail span or skywalk: a road or path
  // bridge that is named as one, or marked historic or notable.
  const covered = p.covered === "yes" && p.bridge !== undefined && p.bridge !== "no" && !p.railway &&
    p.highway !== undefined && !["motorway", "trunk", "primary", "corridor"].includes(p.highway);
  const coveredName = /covered bridge/i.test(String(p["bridge:name"] ?? p.name ?? ""));
  if (covered && (coveredName || p.historic || notable(p))) return ["bridge", "history"];
  // Whatever else it is tagged as, a named covered bridge is a covered bridge.
  if (coveredName && !p.railway) return ["bridge", "history"];
  if (p.bridge === "covered") return ["bridge", "history"];
  if (p.waterway === "waterfall" || p.natural === "waterfall") return ["waterfall", "nature", "scenic"];
  if (p.tourism === "viewpoint") return ["viewpoint", "scenic"];
  if (p.man_made === "tower" && p["tower:type"] === "observation") return named ? ["viewpoint", "scenic"] : null;
  if (p.natural === "cave_entrance") return named ? ["quirky", "nature"] : null;
  if (p.natural === "arch") return ["quirky", "nature", "scenic"];
  if (p.natural === "rock" || p.natural === "stone") return named ? ["quirky", "nature"] : null;
  if (p.natural === "peak") return named && (p.ele || notable(p)) ? ["scenic", "nature"] : null;
  if (p.natural === "spring") return named && notable(p) ? ["nature"] : null;
  // "Ruins" or "Butchery" is not a destination; a furnace, lock or mill is.
  if (p.historic === "ruins") {
    return named && (notable(p) || /furnace|mill|lock\b|canal|fort|mine|kiln|iron|castle|church|mansion|station|bridge|dam\b|abbey|tower|estate/i.test(p.name))
      ? ["ruins", "history"]
      : null;
  }
  if (p.historic === "castle" || p.historic === "fort" || p.historic === "battlefield") return named ? ["history"] : null;
  if (p.historic === "wreck" || p.historic === "boundary_stone" || p.historic === "milestone") return named && notable(p) ? ["quirky", "history"] : null;
  // Battlefields carry hundreds of regiment markers: only notable ones.
  if (p.historic === "monument") return named && notable(p) ? ["history"] : null;
  if (p.historic === "memorial" || p.historic === "tomb") return named && notable(p) ? ["history"] : null;
  if (p.historic === "building" || p.historic === "house" || p.historic === "church" || p.historic === "heritage" || p.historic === "yes") {
    return named && notable(p) ? ["architecture", "history"] : null;
  }
  if (p.man_made === "lighthouse") return named ? ["architecture", "scenic"] : null;
  if (p.man_made === "windmill" || p.man_made === "watermill" || p.historic === "mill") return named ? ["history", "architecture"] : null;
  if (p.historic) return named && notable(p) ? ["history"] : null;
  if (p.tourism === "museum" || p.tourism === "gallery") return named ? ["museum"] : null;
  if (p.tourism === "artwork") return named ? ["public-art"] : null;
  // "attraction" is mapped on everything from mini golf to a street address.
  if (p.tourism === "attraction") return named && notable(p) ? ["quirky", "roadside"] : null;
  if (p.tourism === "camp_site") return named ? ["camping", "recreation"] : null;
  if (p.tourism === "picnic_site") return named ? ["recreation"] : null;
  if (p.highway === "trailhead") return named ? ["recreation", "nature"] : null;
  // City transit landings are not a ride; notable crossings are.
  if (p.amenity === "ferry_terminal") return named && (notable(p) || p.motorcar === "yes" || p.motorcycle === "yes") ? ["roadside", "scenic"] : null;
  if (p.leisure === "nature_reserve" || p.boundary === "protected_area") return named ? ["nature"] : null;
  if (p.leisure === "park") return named && notable(p) ? ["recreation", "nature"] : null;
  return null;
}

function centroid(geometry) {
  const points = [];
  const walk = (value) => {
    if (typeof value[0] === "number") points.push(value);
    else for (const inner of value) walk(inner);
  };
  walk(geometry.coordinates);
  if (points.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of points) { lon += x; lat += y; }
  return [Math.round((lon / points.length) * 1e6) / 1e6, Math.round((lat / points.length) * 1e6) / 1e6];
}

function year(value) {
  const match = /(1[0-9]{3}|20[0-9]{2})/.exec(String(value ?? ""));
  return match ? Number(match[1]) : undefined;
}

function describe(p) {
  return typeof p.description === "string" && p.description.length >= 20 && p.description.length <= 300 ? p.description : null;
}

const byId = new Map();
for (const input of inputs) {
  const lines = createInterface({ input: createReadStream(input) });
  for await (const raw of lines) {
    const line = raw.replace(/^\x1e/, "").trim();
    if (!line) continue;
    const feature = JSON.parse(line);
    const p = feature.properties ?? {};
    const categories = categorize(p);
    if (!categories || !p.name) continue;
    // A bare category word ("Overlook", "Ruins", "Waterfall") names nothing.
    if (/^(the )?(ruins?|overlook|viewpoint|scenic (view|overlook)|vista|waterfall|falls|monument|memorial|park|picnic area|trailhead|campground)$/i.test(String(p.name).trim())) continue;
    // A covered bridge mapped on the road way carries the road's name.
    let name = String(p["bridge:name"] ?? p.name);
    if (categories[0] === "bridge" && !/bridge/i.test(name)) name = `Covered bridge on ${name}`;
    const at = centroid(feature.geometry);
    if (!at) continue;
    const id = `osm:${String(p["@type"] ?? "x").charAt(0)}${p["@id"]}`;
    if (byId.has(id)) continue;
    const facts = {};
    const built = year(p.start_date);
    if (built) facts.builtYear = built;
    const ele = Number(p.ele);
    if (Number.isFinite(ele) && ele > 0) facts.elevationMeters = Math.round(ele);
    if (p.heritage) facts.heritage = [String(p["heritage:operator"] ?? "heritage-listed")];
    byId.set(id, {
      id,
      name: name.slice(0, 120),
      c: categories,
      at,
      ...(p.wikidata ? { wd: String(p.wikidata) } : {}),
      ...(p.wikipedia ? { wp: String(p.wikipedia) } : {}),
      ...(describe(p) ? { d: describe(p) } : {}),
      ...(Object.keys(facts).length > 0 ? { f: facts } : {}),
    });
  }
}

const places = [...byId.values()];
writeFileSync(output, JSON.stringify({ version: 1, builtAt: new Date().toISOString(), places }));
const counts = {};
for (const place of places) counts[place.c[0]] = (counts[place.c[0]] ?? 0) + 1;
console.log(`${places.length} places →`, output, counts);
