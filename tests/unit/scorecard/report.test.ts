import { expect, it } from 'vitest';
import { headline, headlineV1, report } from '../../../scripts/scorecard/report';
import { yardstickCheck } from '../../../scripts/scorecard/yardstick';
import { routerLoad } from '../../../scripts/scorecard/load';
import type { Row, Measurement } from '../../../scripts/scorecard/types';
const measured: Measurement = { miles: 10, minutes: 20, goodMiles: 4, goodShare: 0.4, v1GoodMiles: 3, v1GoodShare: 0.3, dirtShare: 0.4, francoPerKm: 30, busyShare: 0.1, extraMinutes: 0, riderMatch: null, unknownSurfaceShare: 0.2, planningSeconds: 1, trustFailures: ['sand'], unknownTrust: ['No closure feed'], authorityWarnings: [], geometry: [{ lat: 40, lon: -77 }, { lat: 40.01, lon: -77.01 }] };
const ride: Row['ride'] = { id: 'fixture', label: '<script>bad</script>', source: 'corpus', mode: 'gravel', requestId: 'fixed', start: { lat: 40, lon: -77 }, end: { lat: 40.01, lon: -77.01 } };
const row: Row = { ride, openGravel: measured, fastest: { ...measured, trustFailures: [] }, riderLine: null, riderSnap: null, verdict: 'Loss', reasons: ['sand'], verdictV1: 'Tie', reasonsV1: [], routerUse: { calls: 4, shadowCalls: 2, firstRouteSeconds: 3.25 }, errors: [] };
it('produces one self-contained row per ride with sketches, both trust counts and Google links only', () => {
  document.documentElement.innerHTML = report([row], 'tuning', '2026-11-10T17:00:00Z', ['Fixed loop duration'], ['Checkout differs from production']);
  expect(document.querySelectorAll('tbody > tr')).toHaveLength(1);
  expect(document.querySelectorAll('tbody > tr > td')).toHaveLength(11);
  expect(document.querySelectorAll('svg')).toHaveLength(1);
  expect(document.querySelectorAll('polyline')).toHaveLength(4);
  expect(document.querySelectorAll('script,img,link,iframe')).toHaveLength(0);
  expect(document.querySelector('a')?.href).toContain('https://www.google.com/maps/dir/?api=1');
  expect(document.querySelector('tbody')?.textContent).toContain('<script>bad</script>');
  expect(document.querySelector('[role=status]')?.textContent).toContain('Checkout differs from production');
  expect(document.querySelector('h1')?.textContent).toContain('Wins 0/1, trust failures 1');
  expect(document.querySelector('td:last-child')?.textContent).toContain('1 / 0 / unknown');
});
it('prints the v1 headline beside v2, the yardstick, router calls and first-route seconds', () => {
  const wins: Row = { ...row, verdict: 'Win', verdictV1: 'Loss', reasons: [], reasonsV1: ['Fewer good miles than fastest'] };
  expect(headline([wins])).toContain('Wins 1/1');
  expect(headlineV1([wins])).toContain('Wins 0/1');
  // v1 counted 3 good miles for OpenGravel and 3 for fastest; v2 counts 4 and 4.
  expect(headlineV1([wins])).toContain('+0.0 good miles');
  const summary = { yardstick: yardstickCheck([row]), load: routerLoad([row]), curvyLoopThreshold: 0.0734 };
  document.documentElement.innerHTML = report([wins], 'tuning', '2026-11-10T17:00:00Z', [], [], summary);
  const text = document.body.textContent ?? '';
  expect(document.querySelector('h2')?.textContent).toContain('Old yardstick (v1)');
  expect(document.querySelector('h2')?.textContent).toContain('Wins 0/1');
  expect(text).toContain('YARDSTICK FAILED');
  expect(text).toContain('Router calls per plan: 75th percentile 4');
  expect(text).toContain('First-route seconds: 75th percentile 3.3');
  expect(text).toContain('7.34% Curvy bend share');
  expect(text).toContain('4 (+2 shadow) / 3.3');
  expect(text).toContain('v1 would say Loss');
});
it('shows the rider line as a third contestant and sketches it', () => {
  const withRider: Row = { ...row, ride: { ...ride, riderTrack: { catalogId: 'c', geometryPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }, riderLine: { ...measured, goodMiles: 9, trustFailures: [], riderMatch: 0.97 } };
  document.documentElement.innerHTML = report([withRider], 'tuning', '2026-11-10T17:00:00Z');
  expect(document.querySelectorAll('polyline')).toHaveLength(4);
  expect(document.querySelectorAll('polyline')[1]?.getAttribute('stroke')).toBe('#2b6cb0');
  expect(document.querySelector('tbody')?.textContent).toContain("Rider's line");
  expect(document.querySelector('tbody')?.textContent).toContain('4.0 / 4.0 / 9.0');
  expect(document.querySelector('tbody')?.textContent).toContain('unknown / unknown / 97.0%');
});
