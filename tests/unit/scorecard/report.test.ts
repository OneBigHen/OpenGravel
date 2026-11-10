import { expect, it } from 'vitest';
import { report } from '../../../scripts/scorecard/report';
import type { Row, Measurement } from '../../../scripts/scorecard/types';
const measured: Measurement = { miles: 10, minutes: 20, goodMiles: 4, goodShare: 0.4, dirtShare: 0.4, francoPerKm: 30, busyShare: 0.1, extraMinutes: 0, riderMatch: null, unknownSurfaceShare: 0.2, planningSeconds: 1, trustFailures: ['sand'], unknownTrust: ['No closure feed'], authorityWarnings: [], geometry: [{ lat: 40, lon: -77 }, { lat: 40.01, lon: -77.01 }] };
it('produces one self-contained row per ride with sketches, both trust counts and Google links only', () => {
  const row: Row = { ride: { id: 'fixture', label: '<script>bad</script>', source: 'corpus', mode: 'gravel', requestId: 'fixed', start: { lat: 40, lon: -77 }, end: { lat: 40.01, lon: -77.01 } }, openGravel: measured, fastest: { ...measured, trustFailures: [] }, verdict: 'Loss', reasons: ['sand'], errors: [] };
  document.documentElement.innerHTML = report([row], 'tuning', '2026-11-10T17:00:00Z', ['Fixed loop duration'], ['Checkout differs from production']);
  expect(document.querySelectorAll('tbody > tr')).toHaveLength(1);
  expect(document.querySelectorAll('tbody > tr > td')).toHaveLength(10);
  expect(document.querySelectorAll('svg')).toHaveLength(1);
  expect(document.querySelectorAll('polyline')).toHaveLength(3);
  expect(document.querySelectorAll('script,img,link,iframe')).toHaveLength(0);
  expect(document.querySelector('a')?.href).toContain('https://www.google.com/maps/dir/?api=1');
  expect(document.querySelector('tbody')?.textContent).toContain('<script>bad</script>');
  expect(document.querySelector('[role=status]')?.textContent).toContain('Checkout differs from production');
  expect(document.querySelector('h1')?.textContent).toContain('Wins 0/1, trust failures 1');
  expect(document.querySelector('td:last-child')?.textContent).toContain('1 / 0');
});
