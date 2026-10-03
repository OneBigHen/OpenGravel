#!/usr/bin/env node
/**
 * Convert a bounded Overture Places GeoJSONSeq extract into OpenGravel's compact
 * rider-destination index.
 *
 * This is intentionally conservative. Overture is a broad POI corpus; the
 * runtime feed should not become a restaurant/business directory. Ordinary food
 * and commerce stay out until another source supplies actual rider relevance,
 * rating, popularity or time-bound value.
 */

import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [output, release, schema, input] = process.argv.slice(2);
if (!output || !release || !schema || !input) {
  console.error("usage: node build-overture-places.mjs out.json RELEASE SCHEMA input.geojsonseq");
  process.exit(2);
}

function parsedJson(value) {
  if (typeof value !== "string") return value && typeof value === "object" ? value : null;
  try { return JSON.parse(value); } catch { return null; }
}

function taxonomyTokens(properties) {
  const taxonomy = parsedJson(properties.taxonomy) ?? {};
  const hierarchy = Array.isArray(taxonomy.hierarchy) ? taxonomy.hierarchy : [];
  const values = [
    properties.basic_category,
    taxonomy.primary,
    ...hierarchy,
    ...(Array.isArray(taxonomy.alternates) ? taxonomy.alternates : []),
  ];
  return [...new Set(values
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_")))];
}

/** → OpenGravel Discover categories, or null when the POI is too generic. */
export function categorizeOverture(properties) {
  const tokens = taxonomyTokens(properties);
  const has = (pattern) => tokens.some((token) => pattern.test(token));

  if (has(/waterfall|cascade/)) return ["waterfall", "nature", "scenic"];
  if (has(/scenic_viewpoint|viewpoint|observation_deck|observation_tower|lookout/)) return ["viewpoint", "scenic"];
  if (has(/covered_bridge/) || (has(/bridge/) && /bridge/i.test(String(properties.name ?? "")))) return ["bridge", "history"];
  if (has(/cave|cavern|natural_arch|rock_formation/)) return ["quirky", "nature"];
  if (has(/lighthouse/)) return ["architecture", "scenic"];
  if (has(/ruins|archaeological_site/)) return ["ruins", "history"];
  if (has(/battlefield|historic_site|historical_landmark|fort|castle|monument|memorial/)) return ["history"];
  if (has(/museum/)) return ["museum"];
  if (has(/art_gallery|public_art|sculpture_garden/)) return ["public-art"];
  if (has(/roadside_attraction|tourist_attraction|visitor_attraction|oddity/)) return ["quirky", "roadside"];
  if (has(/campground|camp_site|rv_park/)) return ["camping", "recreation"];
  if (has(/national_park|state_park|nature_reserve|wildlife_refuge|protected_area/)) return ["nature", "recreation"];
  if (has(/trailhead/)) return ["recreation", "nature"];
  return null;
}

function point(feature) {
  if (!feature?.geometry || feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const [lon, lat] = feature.geometry.coordinates;
  return typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat)
    ? [lon, lat]
    : null;
}

function website(properties) {
  const raw = parsedJson(properties.websites);
  const candidates = Array.isArray(raw) ? raw : [];
  return candidates.find((value) => typeof value === "string" && value.toLowerCase().startsWith("https://"));
}

const byId = new Map();
const lines = createInterface({ input: createReadStream(input) });
for await (const raw of lines) {
  const line = raw.replace(/^/, "").trim();
  if (!line) continue;
  const feature = JSON.parse(line);
  const properties = feature.properties ?? {};
  const name = typeof properties.name === "string" ? properties.name.trim() : "";
  const id = typeof properties.id === "string" ? properties.id : String(feature.id ?? "");
  const at = point(feature);
  if (!id || !name || at === null) continue;
  const categories = categorizeOverture(properties);
  if (categories === null) continue;

  const confidence = Number(properties.confidence);
  byId.set(id, {
    id,
    name: name.slice(0, 140),
    c: categories,
    at: [Number(at[0].toFixed(6)), Number(at[1].toFixed(6))],
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    ...(website(properties) ? { website: website(properties) } : {}),
  });
}

const places = [...byId.values()];
writeFileSync(output, JSON.stringify({
  version: 1,
  release,
  schema,
  builtAt: new Date().toISOString(),
  places,
}));

const counts = {};
for (const place of places) counts[place.c[0]] = (counts[place.c[0]] ?? 0) + 1;
console.log(`${places.length} Overture rider destinations → ${output}`, counts);
