import type { Row, Measurement } from './types';
import type { Coordinate } from '../../src/domain/ride/types';
import { decodeCatalogPolyline } from '../../src/application/explore/catalog-build';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const number = (v: number | null, suffix = '', scale = 1) => v === null ? 'unknown' : `${(v * scale).toFixed(1)}${suffix}`;
export function headline(rows: Row[]): string {
  const wins = rows.filter(r => r.verdict === 'Win').length;
  const failures = rows.reduce((sum, row) => sum + (row.openGravel?.trustFailures.length ?? 0), 0);
  const good = rows.reduce((sum, row) => sum + (row.openGravel && row.fastest ? row.openGravel.goodMiles - row.fastest.goodMiles : 0), 0);
  const minutes = rows.reduce((sum, row) => sum + (row.openGravel?.extraMinutes ?? 0), 0);
  return `Wins ${wins}/${rows.length}, trust failures ${failures}, ${good >= 0 ? '+' : ''}${good.toFixed(1)} good miles for +${minutes.toFixed(1)} minutes`;
}
function sketch(row: Row): string {
  const rider = row.ride.riderTrack ? decodeCatalogPolyline(row.ride.riderTrack.geometryPolyline) : [];
  const lines = [rider, row.fastest?.geometry ?? [], row.openGravel?.geometry ?? []];
  const points = lines.flat();
  if (points.length === 0) return 'No route';
  const west = Math.min(...points.map(p => p.lon)); const east = Math.max(...points.map(p => p.lon));
  const south = Math.min(...points.map(p => p.lat)); const north = Math.max(...points.map(p => p.lat));
  const cos = Math.cos((south + north) / 2 * Math.PI / 180);
  const width = (east - west) * cos; const height = north - south;
  const scale = Math.min(210 / Math.max(width, 0.0001), 110 / Math.max(height, 0.0001));
  const xy = (p: Coordinate) => `${(10 + (210 - width * scale) / 2 + (p.lon - west) * cos * scale).toFixed(1)},${(10 + (110 - height * scale) / 2 + (north - p.lat) * scale).toFixed(1)}`;
  return `<svg viewBox="0 0 230 130" role="img" aria-label="${escape(row.ride.label)} route comparison">${lines.map((line, i) => `<polyline points="${line.map(xy).join(' ')}" fill="none" stroke="${['#8a8496', '#d67c1c', '#16835c'][i]}" stroke-width="${i === 0 ? 1 : 2}" opacity="0.85"/>`).join('')}</svg>`;
}
export function report(rows: Row[], set: string, at: string, notes: readonly string[] = [], warnings: readonly string[] = []): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenGravel route scorecard</title><style>
body{font:14px system-ui,sans-serif;margin:24px;color:#192c26;background:#fafbf9}h1{font-size:24px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #cdd8d0;vertical-align:top}th{font-size:12px}svg{width:230px;height:130px}small,summary{font-size:12px}details{max-width:300px}a{color:#146548}.scroll{overflow:auto}.Win{color:#087145}.Loss{color:#ad3023}@media print{body{font-size:9px;margin:0}td,th{padding:3px}svg{width:110px;height:65px}h1{font-size:16px}}</style>
<h1>${escape(headline(rows))}</h1>${warnings.map(warning => `<p role="status"><strong>${escape(warning)}</strong></p>`).join('')}<p>${escape(set)} · ride date ${escape(at)} · ${rows.filter(r => r.verdict === 'Tie').length} ties · ${rows.filter(r => r.verdict === 'Loss').length} losses · ${rows.filter(r => r.errors.length).length} planning errors</p>
<p>OpenGravel versus our own fastest-profile baseline (a stand-in for Google). No Google results were fetched. Green: OpenGravel; orange: fastest; gray: rider track. Each ride occupies one row; contestant metrics read OpenGravel / fastest.</p>
<p>Good miles: mapped dirt (sand excluded), or Franco v1 bend miles for Curvy. Unknown never counts as gravel. A-to-B Δ minutes is against fastest; loop Δ is absolute distance from requested time. Rider match is distance-sampled track proximity within 50 m, ignores direction and is not scored. Trust counts are distinct failure categories per route, not the number of illegal edges. Retraced spurs are a geometry proxy for dead ends. Missing tags and unavailable feeds remain evidence gaps, not a safety clearance.</p>
<p>Section 5: loss for any trust failure, over budget (35% extra A-to-B; ±15% loop time), or fewer good miles. Win additionally needs ≥1.5× and ≥3 extra good miles (loops instead need 35% dirt or 25% curvy share), and ≤10 percentage points extra busy share. Otherwise tie. Fastest loops use the same seed and time target. Closure outcomes are frozen locally for repeatability; use --refresh-authority to deliberately refresh. Manual Google time/miles: not entered.</p>
<details><summary>Run assumptions and provenance</summary><ul>${notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul></details>
<div class="scroll"><table><thead><tr><th>Ride / result</th><th>Routes</th><th>Contestant</th><th>Good mi</th><th>Busy</th><th>Minutes / Δ</th><th>Rider match</th><th>Unknown surface</th><th>Plan s</th><th>Trust</th></tr></thead><tbody>${rows.map(row => {
    const ride = row.ride; const end = ride.end ?? ride.start;
    const url = new URL('https://www.google.com/maps/dir/');
    url.search = new URLSearchParams({ api: '1', origin: `${ride.start.lat},${ride.start.lon}`, destination: `${end.lat},${end.lon}`, travelmode: 'driving' }).toString();
    const cells = (field: keyof Measurement, suffix = '', scale = 1) => `<td>${number(row.openGravel?.[field] as number ?? null, suffix, scale)} / ${number(row.fastest?.[field] as number ?? null, suffix, scale)}</td>`;
    // Two compact contestant tables inside the same ride row preserve a single
    // scrollable row per ride while retaining all evidence and route sketches.
    return `<tr><td><strong>${escape(ride.label)}</strong><br>${ride.mode}${ride.loopMinutes ? ` · ${ride.loopMinutes} min loop` : ''}<br><b class="${row.verdict}">${row.verdict}</b><br>${[...row.reasons, ...row.errors].map(escape).join('<br>')}<br><a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">Google Maps directions</a>${ride.loopMinutes ? '<br><small>Link opens start/end only; add a turnaround by hand.</small>' : ''}</td><td>${sketch(row)}</td><td>OpenGravel<br>Fastest</td>${cells('goodMiles')}${cells('busyShare', '%', 100)}<td>${number(row.openGravel?.minutes ?? null)} / ${number(row.fastest?.minutes ?? null)}<br>Δ ${number(row.openGravel?.extraMinutes ?? null)} / ${number(row.fastest?.extraMinutes ?? null)}</td>${cells('riderMatch', '%', 100)}${cells('unknownSurfaceShare', '%', 100)}${cells('planningSeconds')}<td>${row.openGravel?.trustFailures.length ?? 'unknown'} / ${row.fastest?.trustFailures.length ?? 'unknown'}<details><summary>All trust evidence</summary><strong>OpenGravel</strong><br>${[...(row.openGravel?.trustFailures ?? []), ...(row.openGravel?.unknownTrust ?? []), ...(row.openGravel?.authorityWarnings ?? [])].map(escape).join('<br>')}<br><strong>Fastest (${row.fastest?.trustFailures.length ?? 'unknown'})</strong><br>${[...(row.fastest?.trustFailures ?? []), ...(row.fastest?.unknownTrust ?? []), ...(row.fastest?.authorityWarnings ?? [])].map(escape).join('<br>')}</details></td></tr>`;
  }).join('')}</tbody></table></div></html>`;
}
