/** Offline, deliberate selection. Run only when reviewing the frozen manifest. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeCatalogPolyline } from '../../src/application/explore/catalog-build';
import { haversine } from '../../src/domain/geometry/analysis';
import { ROUTING_QUALITY_CORPUS } from '../../tests/real-router/routing-quality-corpus';
import type { Ride } from './types';

const catalog = JSON.parse(gunzipSync(readFileSync('data/catalog/routes.json.gz')).toString()) as { id: string; name: string; distanceKm: number; geometryPolyline: string }[];
function catalogRide(index: number, mode: Ride['mode']): Ride {
  const entry = catalog[index]!;
  const track = decodeCatalogPolyline(entry.geometryPolyline);
  const start = track[0]!; const end = track.at(-1)!;
  const loop = haversine(start, end) < 1000;
  return {
    id: entry.id, label: entry.name, source: 'catalog', mode, requestId: `scorecard:v1:${entry.id}:${mode}`,
    start, ...(loop ? { loopMinutes: Math.max(20, Math.min(480, Math.round(entry.distanceKm / 45 * 60))) } : { end }),
    riderTrack: { catalogId: entry.id, geometryPolyline: entry.geometryPolyline },
  };
}
const dirt: Ride[] = [
  { id: 'pine-grove-loop-2h', label: 'Pine Grove Furnace loop, 2 h', start: { lon: -77.305, lat: 40.0325 }, loopMinutes: 120 },
  { id: 'state-college-rothrock-loop-2h', label: 'State College to Rothrock loop, 2 h', start: { lon: -77.86, lat: 40.7934 }, loopMinutes: 120 },
  { id: 'lock-haven-slate-run', label: 'Lock Haven to Slate Run', start: { lon: -77.4469, lat: 41.137 }, end: { lon: -77.4744, lat: 41.4687 } },
  { id: 'williamsport-waterville', label: 'Williamsport to Waterville', start: { lon: -77.0011, lat: 41.2412 }, end: { lon: -77.3719, lat: 41.3189 } },
].map(r => ({ ...r, mode: 'gravel', source: 'benchmark', requestId: `scorecard:v1:${r.id}:gravel` }));
function set(indices: number[], corpusStart: number, holdout: boolean): Ride[] {
  return [
    ...indices.map((index, i) => catalogRide(index, i < 6 ? (holdout ? 'dual-sport' : 'gravel') : 'curvy')),
    // The spec names four benchmark locations for both sets. The hold-out uses
    // the benchmark's other bike mode; catalog tracks and corpus pairs differ.
    ...dirt.map(r => holdout ? { ...r, mode: 'dual-sport' as const, requestId: r.requestId.replace(':gravel', ':dual-sport') } : r),
    ...ROUTING_QUALITY_CORPUS.slice(corpusStart, corpusStart + 4).map(r => ({
      id: r.id, label: r.label, source: 'corpus' as const, mode: 'curvy' as const,
      requestId: `scorecard:v1:${r.id}:curvy`, start: r.origin, end: r.destination,
      ...(r.options?.avoidHighways === undefined ? {} : { avoidHighways: r.options.avoidHighways }),
    })),
  ];
}
writeFileSync('tests/scorecard/rides.json', JSON.stringify({
  version: 1,
  rideDate: '2026-11-10T17:00:00.000Z',
  notes: [
    'Catalog intent selected from names and existing catalog surface estimates, not ground-truth surface labels.',
    'Catalog loops close within 1 km; requested duration assumes 45 km/h, rounded to a minute (20–480 minute planner limits).',
    'Rider tracks are original catalog polylines, decoded with decodeCatalogPolyline; they never shape the requested plan.',
    'Preflight excluded Canton Endless Mountains (fastest loop disconnected) and Leaser Lake (planner unavailable); replaced with Old Buck Loop and Out and Back Loop before freezing the scorecard. No selection by win score.',
    'Hold-out catalog tracks and corpus pairs are disjoint; the four mandated benchmark locations repeat with the other bike mode.',
    'Fastest loops use the same fixed seed and duration request with the fastest profile; no zero-length start-to-start baseline.',
  ],
  tuning: set([0, 8, 36, 39, 77, 35, 1, 17, 75, 26, 48, 62], 0, false),
  holdout: set([12, 19, 57, 80, 90, 107, 7, 34, 50, 51, 69, 88], 4, true),
}, null, 2) + '\n');
