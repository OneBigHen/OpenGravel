#!/usr/bin/env node

/**
 * Check every Gravel Atlas corridor against the deployed GraphHopper graph.
 *
 * OSM tags say a corridor is dirt and motor-legal; only the engine knows
 * whether its profile can actually ride it (access rules, gates, snapping).
 * Each corridor is routed through a handful of anchors along its own line; a
 * corridor the engine rides at about its own length is `routable = 1`, one the
 * engine can only reach by a long way round is `routable = 0` and never
 * proposed. Run after build-gravel-atlas.ts, against the graph the router
 * imported (the atlas rows stay valid only for that graph).
 *
 *   npx tsx scripts/validate-gravel-atlas.ts --atlas path.sqlite [--url http://127.0.0.1:8989] [--delay-ms 20]
 */

import { DatabaseSync } from "node:sqlite";

interface Row {
  readonly id: string;
  readonly geometry_json: string;
  readonly length_meters: number;
}

/** Routed length may exceed the corridor's own by this factor (plus a fixed slack) and still count as riding it. */
export const ROUTABLE_LENGTH_FACTOR = 1.3;
export const ROUTABLE_SLACK_METERS = 150;
const ANCHORS = 6;

export function anchorsAlong(line: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
  if (line.length <= ANCHORS) return line;
  return Array.from({ length: ANCHORS }, (_, slot) => line[Math.round((slot * (line.length - 1)) / (ANCHORS - 1))] as readonly [number, number]);
}

export function isRoutable(routedMeters: number, corridorMeters: number): boolean {
  return routedMeters <= corridorMeters * ROUTABLE_LENGTH_FACTOR + ROUTABLE_SLACK_METERS;
}

function args(): { atlas: string; url: string; delayMs: number } {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key?.startsWith("--") && value !== undefined) values.set(key.slice(2), value);
  }
  const atlas = values.get("atlas");
  if (atlas === undefined) throw new Error("--atlas is required");
  return { atlas, url: values.get("url") ?? "http://127.0.0.1:8989", delayMs: Number(values.get("delay-ms") ?? 20) };
}

async function routedMeters(url: string, points: readonly (readonly [number, number])[]): Promise<number | null> {
  const response = await fetch(`${url}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, profile: "motorcycle_adventure", "ch.disable": true, points_encoded: false, instructions: false, details: [] }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json()) as { paths?: { distance: number }[] };
  return json.paths?.[0]?.distance ?? null;
}

async function main(): Promise<void> {
  const { atlas, url, delayMs } = args();
  const database = new DatabaseSync(atlas);
  database.exec("pragma busy_timeout = 10000");
  const columns = (database.prepare("pragma table_info(corridors)").all() as { name: string }[]).map((column) => column.name);
  if (!columns.includes("routable")) database.exec("alter table corridors add column routable integer");
  if (!columns.includes("routed_meters")) database.exec("alter table corridors add column routed_meters real");
  const rows = database.prepare("select id, geometry_json, length_meters from corridors where routable is null").all() as unknown as Row[];
  const update = database.prepare("update corridors set routable = ?, routed_meters = ? where id = ?");
  let ok = 0;
  let bad = 0;
  let done = 0;
  for (const row of rows) {
    const line = JSON.parse(row.geometry_json) as [number, number][];
    let meters: number | null = null;
    try { meters = await routedMeters(url, anchorsAlong(line)); } catch { /* an engine error means the corridor is not routable */ }
    const routable = meters !== null && isRoutable(meters, row.length_meters);
    update.run(routable ? 1 : 0, meters, row.id);
    if (routable) ok += 1; else bad += 1;
    done += 1;
    if (done % 1000 === 0) console.log(`${done}/${rows.length} routable ${ok} not ${bad}`);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  database.close();
  console.log(JSON.stringify({ atlas, checked: rows.length, routable: ok, notRoutable: bad }));
}

if (process.argv[1] !== undefined && /validate-gravel-atlas\.[tj]s$/.test(process.argv[1])) void main();
