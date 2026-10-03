import { access, constants, stat } from "node:fs/promises";
import path from "node:path";

const env = process.env;
const errors = [];
const warnings = [];
const info = [];

const fixtureKeys = [
  "OGV_ROUTE_PLAN_FIXTURE",
  "OGV_WEATHER_FIXTURE",
  "OGV_GEOCODE_FIXTURE",
  "OGV_PLACES_FIXTURE",
  "OGV_MAP_LAYERS_FIXTURE",
  "OGV_ELEVATION_FIXTURE",
  "OGV_CATALOG_FIXTURE",
  "OGV_ADVISOR_FIXTURE",
];

function present(key) {
  return typeof env[key] === "string" && env[key].trim() !== "";
}

function value(key) {
  return present(key) ? env[key].trim() : "";
}

function capability(label, enabled) {
  info.push(`${label}: ${enabled ? "configured" : "not configured"}`);
}

for (const key of fixtureKeys) {
  if (value(key) === "1") errors.push(`${key}=1 is a test/demo fixture and must not be enabled in production.`);
}

const origin = value("OGV_PUBLIC_ORIGIN");
if (!origin) {
  errors.push("OGV_PUBLIC_ORIGIN must be set explicitly for production.");
} else {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") errors.push("OGV_PUBLIC_ORIGIN must use HTTPS in production.");
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      errors.push("OGV_PUBLIC_ORIGIN must be an origin only (scheme + host [+ port]), with no path/query/credentials.");
    }
  } catch {
    errors.push("OGV_PUBLIC_ORIGIN is not a valid URL.");
  }
}

if (!present("GRAPHHOPPER_URL")) {
  errors.push("GRAPHHOPPER_URL must be explicit in production; do not rely on the development loopback default.");
}
if (!present("OGV_BUILD_ID")) warnings.push("OGV_BUILD_ID is unset; production health will not identify the deployed build.");
if (!present("OGV_GRAPH_VERSION")) warnings.push("OGV_GRAPH_VERSION is unset; production health cannot identify the active graph.");

const basemap = value("NEXT_PUBLIC_OGV_BASEMAP");
if (basemap === "mapbox") {
  const token = value("NEXT_PUBLIC_MAPBOX_TOKEN");
  if (!token.startsWith("pk.")) errors.push("Mapbox basemap selected but NEXT_PUBLIC_MAPBOX_TOKEN is not a public pk token.");
}

const placesUrl = present("OGV_PLACES_API_URL");
const placesKey = present("OGV_PLACES_API_KEY");
if (placesUrl !== placesKey) {
  errors.push("Current main requires OGV_PLACES_API_URL and OGV_PLACES_API_KEY together.");
}
capability("Places", placesUrl && placesKey);

const spotifyClient = present("SPOTIFY_CLIENT_ID");
const spotifyKey = value("OGV_SPOTIFY_SESSION_KEY");
if (spotifyClient && !/^[0-9a-fA-F]{64}$/.test(spotifyKey)) {
  errors.push("SPOTIFY_CLIENT_ID is configured but OGV_SPOTIFY_SESSION_KEY is not a 32-byte hex key.");
}
capability("Spotify web/PWA", spotifyClient && /^[0-9a-fA-F]{64}$/.test(spotifyKey));

const cameras = value("TRAFFIC_CAMERAS_ENABLED") === "1";
const relaySecret = value("TRAFFIC_CAMERA_VIDEO_PROXY_SECRET");
if (cameras && relaySecret && relaySecret.length < 24) {
  errors.push("TRAFFIC_CAMERA_VIDEO_PROXY_SECRET must be at least 24 characters when configured.");
}
if (value("PA511_VIDEO_ENABLED") === "1") {
  const paSecret = value("PA511_VIDEO_PROXY_SECRET") || relaySecret;
  if (paSecret.length < 24) errors.push("PA511 live video is enabled but no valid relay secret is configured.");
}
capability("Traffic cameras", cameras);

if (value("OGV_ROAD_AUTHORITY").toLowerCase() === "on") {
  info.push("Road authority: enabled");
} else {
  info.push("Road authority: disabled");
}

capability("TomTom", present("TOMTOM_API_KEY") || present("TOMTOM_TRAFFIC_API_KEY"));
capability("OSM Discover index", present("OGV_DISCOVER_OSM_PLACES"));
capability("Curvature catalogue", present("CURVATURE_DB_PATH"));
capability("Gravel Atlas", present("GRAVEL_ATLAS_DB_PATH"));
capability("Advisor", present("ADVISOR_API_KEY") || present("ADVISOR_OPENROUTER_API_KEY") || present("OPENROUTER_API_KEY"));
capability("Jev classifier", present("JEV_API_KEY"));

const requiredPersistent = [
  ["OGV_SHARE_DB_PATH", "public-share database"],
  ["COMMUNITY_DB_PATH", "community database"],
  ["OGV_FEEDBACK_DB_PATH", "feedback database"],
];
for (const [key, label] of requiredPersistent) {
  if (!present(key)) warnings.push(`${key} is unset; ${label} will use a path under the release checkout.`);
  else {
    const parent = path.dirname(value(key));
    try {
      await access(parent, constants.R_OK | constants.W_OK);
    } catch {
      errors.push(`${key} parent directory is not readable/writable: ${parent}`);
    }
  }
}

const configuredFiles = [
  ["OGV_DISCOVER_OSM_PLACES", "OSM Discover index"],
  ["CURVATURE_DB_PATH", "Curvature database"],
  ["GRAVEL_ATLAS_DB_PATH", "Gravel Atlas database"],
];
for (const [key, label] of configuredFiles) {
  if (!present(key)) continue;
  try {
    const details = await stat(value(key));
    if (!details.isFile()) errors.push(`${label} path is not a file: ${value(key)}`);
  } catch {
    errors.push(`${label} does not exist: ${value(key)}`);
  }
}

const configuredDirectories = [
  ["OGV_OFFLINE_REGION_ROOT", "offline region root"],
  ["OGV_BASEMAP_ROOT", "offline basemap root"],
];
for (const [key, label] of configuredDirectories) {
  if (!present(key)) {
    warnings.push(`${key} is unset; ${label} will use a path under the release checkout.`);
    continue;
  }
  try {
    const details = await stat(value(key));
    if (!details.isDirectory()) errors.push(`${label} is not a directory: ${value(key)}`);
  } catch {
    errors.push(`${label} does not exist: ${value(key)}`);
  }
}

console.log("OpenGravel production environment preflight");
console.log("------------------------------------------");
for (const line of info) console.log(`INFO  ${line}`);
for (const line of warnings) console.warn(`WARN  ${line}`);
for (const line of errors) console.error(`ERROR ${line}`);

if (errors.length > 0) {
  console.error(`\nFAILED: ${errors.length} production configuration error(s).`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS with ${warnings.length} warning(s). No secret values were printed.`);
}
