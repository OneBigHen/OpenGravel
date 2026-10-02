import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const scanRoots = ["src", "apps", "scripts", "infra"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const ignoredDirectories = new Set(["node_modules", ".next", "dist", "build", "coverage", "public", "fixtures"]);

const prefixes = [
  "OGV_",
  "NEXT_PUBLIC_",
  "GRAPHHOPPER_",
  "PHOTON_",
  "TOMTOM_",
  "NWS_",
  "WIKIMEDIA_",
  "CURVATURE_",
  "GRAVEL_",
  "PTC_",
  "ADVISOR_",
  "OPENROUTER_",
  "JEV_",
  "SPOTIFY_",
  "COMMUNITY_",
  "TRAFFIC_CAMERA_",
  "TRAFFIC_CAMERAS_",
  "PA511_",
  "OHGO_",
  "STORMSCOPE_",
];

const builtIns = new Set(["NODE_ENV", "CI"]);

function looksLikeDeploymentKey(value) {
  return builtIns.has(value) || prefixes.some((prefix) => value.startsWith(prefix));
}

async function filesUnder(directory) {
  const absolute = path.join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(relative));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

function deploymentKeysFromSource(source) {
  const keys = new Set();

  // Direct/injected env reads: process.env.KEY, process.env["KEY"], env.KEY, env["KEY"].
  for (const match of source.matchAll(/\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g)) {
    const key = match[1] ?? match[2];
    if (key && looksLikeDeploymentKey(key)) keys.add(key);
  }

  // Named env constants such as ADVISOR_ENDPOINT_ENV = "ADVISOR_ENDPOINT".
  for (const match of source.matchAll(/\b[A-Z][A-Z0-9_]*_ENV\s*=\s*["']([A-Z][A-Z0-9_]*)["']/g)) {
    const key = match[1];
    if (key && looksLikeDeploymentKey(key)) keys.add(key);
  }

  // Template-derived camera origin prefixes are real deployment keys but do
  // not appear as complete literals in source.
  if (source.includes("TRAFFIC_CAMERA_ALLOWED_ORIGINS_")) {
    for (const state of ["PA", "NJ", "NY", "DE", "MD", "VA", "WV"]) {
      keys.add(`TRAFFIC_CAMERA_ALLOWED_ORIGINS_${state}`);
    }
  }
  if (source.includes("TRAFFIC_CAMERA_METADATA_ORIGINS_")) {
    for (const state of ["PA", "NJ", "NY", "DE", "MD", "VA", "WV"]) {
      keys.add(`TRAFFIC_CAMERA_METADATA_ORIGINS_${state}`);
    }
  }

  return keys;
}

function documentedKeys(example) {
  const keys = new Set();
  for (const line of example.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match && looksLikeDeploymentKey(match[1])) keys.add(match[1]);
  }
  return keys;
}

const files = (await Promise.all(scanRoots.map(filesUnder))).flat();
const used = new Map();

for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  for (const key of deploymentKeysFromSource(source)) {
    if (builtIns.has(key)) continue;
    const locations = used.get(key) ?? [];
    locations.push(file);
    used.set(key, locations);
  }
}

const example = await readFile(path.join(root, ".env.example"), "utf8");
const documented = documentedKeys(example);
const missing = [...used.keys()].filter((key) => !documented.has(key)).sort();

console.log(`Environment contract: ${used.size} source keys, ${documented.size} documented keys.`);

if (missing.length > 0) {
  console.error("\nUndocumented production environment keys:");
  for (const key of missing) {
    console.error(`- ${key}: ${[...new Set(used.get(key) ?? [])].join(", ")}`);
  }
  process.exitCode = 1;
} else {
  console.log("All recognized production environment keys are represented in .env.example.");
}
