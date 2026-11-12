/** Two-run rule (verdict 4a): a row counts only if two complete runs agree; otherwise the lower verdict.
 * npm run scorecard:pair -- runA.json runB.json
 * Both files must be whole runs (a latest.json, never progress.json or a stitched file) of the same set,
 * revision, map (import date and fingerprint), router and atlas. Prints the paired headline and every row that moved.
 */
import { readFileSync } from 'node:fs';
import type { Row, Verdict } from './types';

export interface RunFile {
  headline?: string; set: string; gitHead?: string; router?: string; atlasSha256?: string;
  graph?: { importDate: string | null; fingerprint: string };
  summary?: { referenceFaults?: number };
  rows: Row[];
}
const RANK: Record<Verdict, number> = { Loss: 0, Tie: 1, Win: 2 };
export const lower = (a: Verdict, b: Verdict): Verdict => (RANK[a] <= RANK[b] ? a : b);

/** Throws unless the two files are whole, comparable runs. */
export function checkPair(a: RunFile, b: RunFile): void {
  const expected = (run: RunFile) => (run.set === 'nj' ? 10 : 20);
  for (const [name, run] of [['first', a], ['second', b]] as const) {
    if (run.headline === undefined || run.rows.length !== expected(run)) throw new Error(`The ${name} file is not one whole run (no headline or ${run.rows.length} rows). Partial or stitched runs are never compared.`);
    if (run.graph === undefined) throw new Error(`The ${name} file does not record which map answered (older scorecard). Run it again.`);
  }
  const same = (what: string, x: unknown, y: unknown) => { if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`The two runs differ in ${what}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); };
  same('set', a.set, b.set); same('revision', a.gitHead, b.gitHead); same('router', a.router, b.router);
  same('atlas', a.atlasSha256, b.atlasSha256); same('map', a.graph, b.graph);
  same('rides', a.rows.map(r => r.ride.id), b.rows.map(r => r.ride.id));
}

export interface PairedRow { id: string; label: string; first: Verdict; second: Verdict; counted: Verdict }
export function pairRows(a: RunFile, b: RunFile): PairedRow[] {
  return a.rows.map((row, i) => {
    const other = b.rows[i]!;
    return { id: row.ride.id, label: row.ride.label, first: row.verdict, second: other.verdict, counted: lower(row.verdict, other.verdict) };
  });
}

function main(): void {
  const [fa, fb] = process.argv.slice(2);
  if (!fa || !fb) throw new Error('Usage: npm run scorecard:pair -- runA.json runB.json');
  const a = JSON.parse(readFileSync(fa, 'utf8')) as RunFile;
  const b = JSON.parse(readFileSync(fb, 'utf8')) as RunFile;
  checkPair(a, b);
  const rows = pairRows(a, b);
  const wins = rows.filter(r => r.counted === 'Win').length;
  const trust = Math.max(...[a, b].map(run => run.rows.reduce((n, r) => n + (r.openGravel?.trustFailures.length ?? 0), 0)));
  const faults = Math.max(a.summary?.referenceFaults ?? 0, b.summary?.referenceFaults ?? 0);
  console.log(`Two runs on map ${a.graph!.importDate} (${a.graph!.fingerprint.slice(0, 12)}), revision ${a.gitHead?.slice(0, 8)}:`);
  console.log(`  run 1: ${a.headline}`);
  console.log(`  run 2: ${b.headline}`);
  console.log(`Counted (a row counts only if both runs agree; else the lower): Wins ${wins}/${rows.length}, trust failures ${trust}, reference faults ${faults}.`);
  for (const r of rows.filter(r => r.first !== r.second)) console.log(`  moved between runs: ${r.label}: ${r.first} then ${r.second}, counted ${r.counted}`);
}
if (process.argv[1]?.endsWith('pair.ts')) main();
