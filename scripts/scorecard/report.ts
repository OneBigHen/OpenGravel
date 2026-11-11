import type { Row, Measurement } from './types';
import { loadLine, type RouterLoadSummary } from './load';
import type { YardstickResult } from './yardstick';
import type { Coordinate } from '../../src/domain/ride/types';
import { decodeCatalogPolyline } from '../../src/application/explore/catalog-build';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const number = (v: number | null, suffix = '', scale = 1) => v === null ? 'unknown' : `${(v * scale).toFixed(1)}${suffix}`;
export function headline(rows: Row[], verdictOf: (row: Row) => Row['verdict'] = row => row.verdict, good: (m: Measurement) => number = m => m.goodMiles): string {
  const wins = rows.filter(r => verdictOf(r) === 'Win').length;
  const failures = rows.reduce((sum, row) => sum + (row.openGravel?.trustFailures.length ?? 0), 0);
  const extra = rows.reduce((sum, row) => sum + (row.openGravel && row.fastest ? good(row.openGravel) - good(row.fastest) : 0), 0);
  const minutes = rows.reduce((sum, row) => sum + (row.openGravel?.extraMinutes ?? 0), 0);
  return `Wins ${wins}/${rows.length}, trust failures ${failures}, ${extra >= 0 ? '+' : ''}${extra.toFixed(1)} good miles for +${minutes.toFixed(1)} minutes`;
}
/** The headline scorecard v1 would have printed for the same routes (Franco bend miles, 25% Curvy loop share). */
export function headlineV1(rows: Row[]): string { return headline(rows, row => row.verdictV1, m => m.v1GoodMiles); }
function sketch(row: Row): string {
  const rider = row.ride.riderTrack ? decodeCatalogPolyline(row.ride.riderTrack.geometryPolyline) : [];
  const lines = [rider, row.riderLine?.geometry ?? [], row.fastest?.geometry ?? [], row.openGravel?.geometry ?? []];
  const points = lines.flat();
  if (points.length === 0) return 'No route';
  const west = Math.min(...points.map(p => p.lon)); const east = Math.max(...points.map(p => p.lon));
  const south = Math.min(...points.map(p => p.lat)); const north = Math.max(...points.map(p => p.lat));
  const cos = Math.cos((south + north) / 2 * Math.PI / 180);
  const width = (east - west) * cos; const height = north - south;
  const scale = Math.min(210 / Math.max(width, 0.0001), 110 / Math.max(height, 0.0001));
  const xy = (p: Coordinate) => `${(10 + (210 - width * scale) / 2 + (p.lon - west) * cos * scale).toFixed(1)},${(10 + (110 - height * scale) / 2 + (north - p.lat) * scale).toFixed(1)}`;
  const stroke = ['#8a8496', '#2b6cb0', '#d67c1c', '#16835c'];
  return `<svg viewBox="0 0 230 130" role="img" aria-label="${escape(row.ride.label)} route comparison">${lines.map((line, i) => `<polyline points="${line.map(xy).join(' ')}" fill="none" stroke="${stroke[i]}" stroke-width="${i === 0 ? 1 : 2}" opacity="0.85"/>`).join('')}</svg>`;
}
export interface ReportSummary { yardstick: YardstickResult; load: RouterLoadSummary; curvyLoopThreshold: number }
export function report(rows: Row[], set: string, at: string, notes: readonly string[] = [], warnings: readonly string[] = [], summary?: ReportSummary): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenGravel route scorecard</title><style>
body{font:14px system-ui,sans-serif;margin:24px;color:#192c26;background:#fafbf9}h1{font-size:24px}h2{font-size:16px;margin:4px 0}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #cdd8d0;vertical-align:top}th{font-size:12px}svg{width:230px;height:130px}small,summary{font-size:12px}details{max-width:300px}a{color:#146548}.scroll{overflow:auto}.Win{color:#087145}.Loss{color:#ad3023}@media print{body{font-size:9px;margin:0}td,th{padding:3px}svg{width:110px;height:65px}h1{font-size:16px}}</style>
<h1>${escape(headline(rows))}</h1><h2>Old yardstick (v1) for the same routes: ${escape(headlineV1(rows))}</h2>${warnings.map(warning => `<p role="status"><strong>${escape(warning)}</strong></p>`).join('')}${summary ? `<p>${escape(summary.yardstick.message)}</p><p>${escape(loadLine(summary.load))}</p>` : ''}<p>${escape(set)} · ride date ${escape(at)} · ${rows.filter(r => r.verdict === 'Tie').length} ties · ${rows.filter(r => r.verdict === 'Loss').length} losses · ${rows.filter(r => r.errors.length).length} planning errors</p>
<p>OpenGravel versus our own fastest-profile baseline (a stand-in for Google), plus the rider's own line as a ruler. No Google results were fetched. Green: OpenGravel; orange: fastest; blue: the rider's line snapped to our roads; gray: the raw rider track. Each ride occupies one row; contestant metrics read OpenGravel / fastest / rider's line.</p>
<p>Good miles: mapped dirt (sand excluded), or, for Curvy, the planner's own bend miles (heading-fun-v1: long sweepers count; junction corners, town streets, ramps and roundabouts do not). Unknown never counts as gravel. A-to-B Δ minutes is against fastest; loop Δ is absolute distance from requested time. Rider match is distance-sampled track proximity within 50 m, ignores direction and is not scored; for the rider's line it shows how faithfully the snapped line follows the raw track. The rider's line is never used to plan and never scored as "match the rider": it only checks that the measure can tell a rider's favourite road from the fastest one. Trust counts are distinct failure categories per route, not the number of illegal edges. Retraced spurs are a geometry proxy for dead ends. Missing tags and unavailable feeds remain evidence gaps, not a safety clearance.</p>
<p>Section 5: loss for any trust failure, over budget (35% extra A-to-B; ±15% loop time), or fewer good miles. Win additionally needs ≥1.5× and ≥3 extra good miles (loops instead need 35% dirt share, or ${summary ? `${(summary.curvyLoopThreshold * 100).toFixed(2)}%` : 'the frozen'} Curvy bend share: 75% of the median share of the riders' own tuning lines, frozen with the manifest hash), and ≤10 percentage points extra busy share. Otherwise tie. Fastest loops use the same seed and time target. Router calls count every request one plan made before it answered; first-route seconds is how long until the first router answer that carried a route came back. Closure outcomes are frozen locally for repeatability; use --refresh-authority to deliberately refresh. Manual Google time/miles: not entered.</p>
<details><summary>Run assumptions and provenance</summary><ul>${notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul></details>
<div class="scroll"><table><thead><tr><th>Ride / result</th><th>Routes</th><th>Contestant</th><th>Good mi</th><th>Busy</th><th>Minutes / Δ</th><th>Rider match</th><th>Unknown surface</th><th>Plan s</th><th>Router calls / first route s</th><th>Trust</th></tr></thead><tbody>${rows.map(row => {
    const ride = row.ride; const end = ride.end ?? ride.start;
    const url = new URL('https://www.google.com/maps/dir/');
    url.search = new URLSearchParams({ api: '1', origin: `${ride.start.lat},${ride.start.lon}`, destination: `${end.lat},${end.lon}`, travelmode: 'driving' }).toString();
    const three = [row.openGravel, row.fastest, row.riderLine];
    const cells = (field: keyof Measurement, suffix = '', scale = 1, shown = three) => `<td>${shown.map(m => number(m?.[field] as number ?? null, suffix, scale)).join(' / ')}${shown.length < three.length ? ' / n/a' : ''}</td>`;
    const use = row.routerUse;
    const evidence = (label: string, m: Measurement | null) => `<strong>${label}${m ? ` (${m.trustFailures.length})` : ''}</strong><br>${m ? [...m.trustFailures, ...m.unknownTrust, ...m.authorityWarnings].map(escape).join('<br>') : 'not measured'}`;
    const v1Differs = row.verdictV1 !== row.verdict ? `<br><small>v1 would say ${row.verdictV1}</small>` : '';
    // Two compact contestant tables inside the same ride row preserve a single
    // scrollable row per ride while retaining all evidence and route sketches.
    return `<tr><td><strong>${escape(ride.label)}</strong><br>${ride.mode}${ride.loopMinutes ? ` · ${ride.loopMinutes} min loop` : ''}<br><b class="${row.verdict}">${row.verdict}</b>${v1Differs}<br>${[...row.reasons, ...row.errors].map(escape).join('<br>')}<br><a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">Google Maps directions</a>${ride.loopMinutes ? '<br><small>Link opens start/end only; add a turnaround by hand.</small>' : ''}${row.riderSnap ? `<br><small>${escape(row.riderSnap.note)}</small>` : ''}</td><td>${sketch(row)}</td><td>OpenGravel<br>Fastest<br>${ride.riderTrack ? "Rider's line" : 'No rider line'}</td>${cells('goodMiles')}${cells('busyShare', '%', 100)}<td>${three.map(m => number(m?.minutes ?? null)).join(' / ')}<br>Δ ${three.map(m => number(m?.extraMinutes ?? null)).join(' / ')}</td>${cells('riderMatch', '%', 100)}${cells('unknownSurfaceShare', '%', 100)}${cells('planningSeconds', '', 1, three.slice(0, 2))}<td>${use ? `${use.calls}${use.shadowCalls ? ` (+${use.shadowCalls} shadow)` : ''} / ${number(use.firstRouteSeconds)}` : 'unknown'}</td><td>${three.map(m => m?.trustFailures.length ?? 'unknown').join(' / ')}<details><summary>All trust evidence</summary>${evidence('OpenGravel', row.openGravel)}<br>${evidence('Fastest', row.fastest)}${row.riderLine ? `<br>${evidence("Rider's line", row.riderLine)}` : ''}</details></td></tr>`;
  }).join('')}</tbody></table></div></html>`;
}
