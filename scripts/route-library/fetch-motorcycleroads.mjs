#!/usr/bin/env node
/**
 * Fetch MotorcycleRoads.com tracks into the national ride library.
 *
 * Basis for hosting: "owner-confirmed permission from MotorcycleRoads.com 2026-11-14".
 *
 * Each ride page carries a link to https://www.motorcycleroads.com/downloadgpx/<id>
 * (some records already store that address in gpx.download_url). The file served
 * there is the ride's own track, no login needed. This script:
 *
 *  - fetches one file at a time, never two at once, with at least 3 s between requests;
 *  - skips a ride whose track is already on disk, so a stopped run resumes;
 *  - rejects anything that is not GPX with a track or route of two or more points
 *    (an HTML page, a login wall, an empty file) instead of saving it;
 *  - saves <id>.gpx beside <id>.json and updates the record: gpx.availability
 *    "hosted", gpx.local_file, gpx.points, gpx.bounds, gpx.fetched_at,
 *    terms.allows_rehost "yes" and terms.basis;
 *  - keeps the file's own formatting (indent, escaping, trailing newline) so the
 *    diff only touches the lines it changes.
 *
 * It never bypasses a login or captcha: a page that needs one is reported as a
 * failure and left alone.
 *
 * Usage:
 *   node scripts/route-library/fetch-motorcycleroads.mjs [--library DIR] [--state ST]
 *        [--limit N] [--dry-run] [--failures FILE]
 */

import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_LIBRARY = "/root/Vibe/og-route-library-national";
const BASIS = "owner-confirmed permission from MotorcycleRoads.com 2026-11-14";
const SOURCE_NAMES = new Set(["motorcycleroads.com", "motorcycleroads"]);
const ORIGIN = "https://www.motorcycleroads.com";
const REQUEST_GAP_MS = 3000;
const RETRY_DELAY_MS = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function log(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = { library: DEFAULT_LIBRARY, state: null, limit: Number.POSITIVE_INFINITY, dryRun: false, failures: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--library") options.library = argv[(index += 1)];
    else if (arg === "--state") options.state = String(argv[(index += 1)]).toUpperCase();
    else if (arg === "--limit") options.limit = Number(argv[(index += 1)]);
    else if (arg === "--failures") options.failures = argv[(index += 1)];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function isMotorcycleRoads(record) {
  const name = record?.source?.name;
  return typeof name === "string" && SOURCE_NAMES.has(name.trim().toLowerCase());
}

function listRecords(library, state) {
  const routesDir = path.join(library, "routes");
  const states = readdirSync(routesDir)
    .filter((name) => statSync(path.join(routesDir, name)).isDirectory())
    .filter((name) => state === null || name === state)
    .sort();
  const found = [];
  for (const stateCode of states) {
    const dir = path.join(routesDir, stateCode);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
      const jsonPath = path.join(dir, file);
      let record;
      try {
        record = JSON.parse(readFileSync(jsonPath, "utf8"));
      } catch {
        continue;
      }
      if (!isMotorcycleRoads(record)) continue;
      found.push({ dir, jsonPath, id: record.id, record });
    }
  }
  return found;
}

let lastRequestAt = 0;

/** One request at a time, at least REQUEST_GAP_MS apart, browser User-Agent, no credentials. */
async function request(url) {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": USER_AGENT, accept: "application/gpx+xml,application/xml,text/html;q=0.8,*/*;q=0.5" },
    signal: AbortSignal.timeout(60000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", body };
}

/** A retry for a rate limit or a server fault; never for a 404 or a login wall. */
async function requestWithRetry(url) {
  const first = await request(url);
  if (first.status !== 429 && first.status < 500) return first;
  log(`  retrying ${first.status} for ${url} after ${RETRY_DELAY_MS / 1000}s`);
  await sleep(RETRY_DELAY_MS);
  return request(url);
}

function parseGpxText(text) {
  const points = [];
  for (const match of text.matchAll(/<(?:trkpt|rtept)\b[^>]*>/g)) {
    const lat = /\blat="(-?[0-9.]+)"/.exec(match[0]);
    const lon = /\blon="(-?[0-9.]+)"/.exec(match[0]);
    if (lat === null || lon === null) continue;
    points.push({ lat: Number(lat[1]), lon: Number(lon[1]) });
  }
  return points;
}

/** Real GPX with a track or route of two or more usable points, or a reason it is not. */
function checkGpx(download) {
  const type = download.contentType.toLowerCase();
  if (download.status !== 200) return { ok: false, why: `download answered ${download.status}` };
  if (type.includes("html")) return { ok: false, why: `download answered with HTML (${type})` };
  if (download.body.length === 0) return { ok: false, why: "empty file" };
  if (download.body.length > MAX_BODY_BYTES) return { ok: false, why: `file is ${download.body.length} bytes` };
  const text = download.body.toString("latin1");
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (!head.startsWith("<?xml") && !head.startsWith("<gpx")) return { ok: false, why: "not XML" };
  if (!/<gpx[\s>]/.test(text)) return { ok: false, why: "no <gpx> element" };
  if (!/<(?:trk|rte)[\s>]/.test(text)) return { ok: false, why: "no track or route" };
  const points = parseGpxText(text);
  if (points.length < 2) return { ok: false, why: `only ${points.length} point(s)` };
  if (points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180)) {
    return { ok: false, why: "a point is out of range" };
  }
  const round = (value) => Math.round(value * 1e6) / 1e6;
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  return {
    ok: true,
    points: points.length,
    bounds: {
      west: round(Math.min(...lons)),
      south: round(Math.min(...lats)),
      east: round(Math.max(...lons)),
      north: round(Math.max(...lats)),
    },
  };
}

async function rideIdFor(entry) {
  const stored = entry.record?.gpx?.download_url;
  const known = typeof stored === "string" ? /downloadgpx\/(\d+)/.exec(stored) : null;
  if (known !== null) return known[1];
  const url = entry.record?.source?.url;
  if (typeof url !== "string") throw new Error("record has no source address");
  const page = await requestWithRetry(url);
  if (page.status !== 200) throw new Error(`ride page answered ${page.status}`);
  const match = /downloadgpx\/(\d+)/.exec(page.body.toString("utf8"));
  if (match === null) throw new Error("ride page has no GPX download link");
  return match[1];
}

/**
 * The library keeps eight JSON layouts (1 or 2 space indent, ASCII-escaped or
 * literal UTF-8, with or without a trailing newline). Match the file's own
 * layout so a rewrite only changes the lines this script touches.
 */
const LAYOUTS = [
  { indent: 1, ascii: false, newline: "\n" },
  { indent: 1, ascii: false, newline: "" },
  { indent: 1, ascii: true, newline: "\n" },
  { indent: 1, ascii: true, newline: "" },
  { indent: 2, ascii: false, newline: "\n" },
  { indent: 2, ascii: false, newline: "" },
  { indent: 2, ascii: true, newline: "\n" },
  { indent: 2, ascii: true, newline: "" },
];

function escapeNonAscii(text) {
  return text.replace(/[\u0080-\uFFFF]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function format(value, layout) {
  const text = JSON.stringify(value, null, layout.indent);
  return (layout.ascii ? escapeNonAscii(text) : text) + layout.newline;
}

function formatLike(original, value) {
  let parsed;
  try {
    parsed = JSON.parse(original);
  } catch {
    parsed = null;
  }
  if (parsed !== null) {
    for (const layout of LAYOUTS) if (format(parsed, layout) === original) return format(value, layout);
  }
  return format(value, { indent: 2, ascii: true, newline: "\n" });
}

function alreadyDone(entry) {
  const gpx = entry.record?.gpx;
  if (gpx?.availability !== "hosted" || typeof gpx.local_file !== "string") return false;
  const file = path.join(entry.dir, gpx.local_file);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "latin1");
  return checkGpx({ status: 200, contentType: "gpx", body: Buffer.from(text, "latin1") }).ok;
}

function writeAtomically(file, bytes) {
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, bytes);
  renameSync(temp, file);
}

function nearSameBox(left, right) {
  if (left === undefined || right === undefined) return false;
  return ["west", "south", "east", "north"].every(
    (edge) => typeof left[edge] === "number" && typeof right[edge] === "number" && Math.abs(left[edge] - right[edge]) < 0.001,
  );
}

function updateRecord(entry, { localFile, points, downloadUrl, bounds, fetchedAt }) {
  const record = entry.record;
  const raw = readFileSync(entry.jsonPath, "utf8");
  record.gpx = {
    ...record.gpx,
    availability: "hosted",
    download_url: downloadUrl,
    local_file: localFile,
    points,
    // An existing box measured from the same track is kept: no need to churn four lines.
    bounds: nearSameBox(record.gpx?.bounds, bounds) ? record.gpx.bounds : bounds,
    requires_login: false,
    fetched_at: fetchedAt,
  };
  record.terms = {
    ...record.terms,
    allows_rehost: "yes",
    basis: BASIS,
    checked_at: fetchedAt,
  };
  record.publishability = {
    ...record.publishability,
    status: "ready-to-ship",
    permission_notes: `Hosting allowed: ${BASIS}. The site's own terms would exclude hosting, so this record rests on that direct permission, recorded here and in sources-policy.json.`,
  };
  if (typeof record.source?.fetched_via === "string") record.source.fetched_via = "direct-download";
  writeAtomically(entry.jsonPath, formatLike(raw, record));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help === true) {
    log("usage: fetch-motorcycleroads.mjs [--library DIR] [--state ST] [--limit N] [--dry-run] [--failures FILE]");
    return;
  }
  const entries = listRecords(options.library, options.state);
  log(`MotorcycleRoads.com fetch: ${entries.length} record(s) under ${options.library}${options.state === null ? "" : ` for ${options.state}`}`);
  log(`basis: ${BASIS}`);
  log(`metering: one request at a time, ${REQUEST_GAP_MS / 1000}s apart${options.dryRun ? "; dry run, no requests" : ""}`);

  const failures = [];
  let fetched = 0;
  let skipped = 0;
  let seen = 0;
  let requested = 0;

  for (const entry of entries) {
    if (seen >= options.limit) break;
    seen += 1;
    if (alreadyDone(entry)) {
      skipped += 1;
      continue;
    }
    const label = `${entry.record.id}`;
    if (options.dryRun) {
      log(`  would fetch ${label}`);
      continue;
    }
    try {
      const rideId = await rideIdFor(entry);
      requested += 1;
      const download = await requestWithRetry(`${ORIGIN}/downloadgpx/${rideId}`);
      const checked = checkGpx(download);
      if (!checked.ok) throw new Error(`${checked.why} (downloadgpx/${rideId})`);
      const localFile = `${entry.record.id}.gpx`;
      writeAtomically(path.join(entry.dir, localFile), download.body);
      const fetchedAt = new Date().toISOString();
      updateRecord(entry, { localFile, points: checked.points, downloadUrl: `${ORIGIN}/downloadgpx/${rideId}`, bounds: checked.bounds, fetchedAt });
      fetched += 1;
      log(`  ok ${label} ${checked.points} points (downloadgpx/${rideId})`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      failures.push({ id: entry.record.id, url: entry.record?.source?.url ?? null, why });
      log(`  FAILED ${label}: ${why}`);
    }
    if (seen % 25 === 0) {
      log(`progress ${seen}/${entries.length}: fetched ${fetched}, skipped ${skipped}, failed ${failures.length}`);
    }
  }

  const summary = { records: entries.length, seen, fetched, skipped, failed: failures.length, requested };
  log(`done: ${JSON.stringify(summary)}`);
  if (failures.length > 0) {
    log(`failures: ${failures.map((entry) => `${entry.id} (${entry.why})`).join("; ")}`);
  }
  if (options.failures !== null) {
    writeFileSync(options.failures, `${JSON.stringify({ summary, failures }, null, 2)}\n`);
    log(`failure list written to ${options.failures}`);
  }
}

main().catch((error) => {
  log(`stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
