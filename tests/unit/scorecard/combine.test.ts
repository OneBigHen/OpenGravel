import { describe, expect, it } from 'vitest';
import { combineRuns, IncompatibleRunsError, renderCombined, type ScorecardRunFile, type ScorecardSourceRow } from '../../../scripts/scorecard/combine';
import type { Verdict } from '../../../scripts/scorecard/types';

const DATE = '2026-11-12T13:21:00Z';
const row = (id: string, verdict: Verdict, extra: Partial<ScorecardSourceRow> = {}): ScorecardSourceRow => ({
  ride: { id, label: id }, verdict, ...extra,
});
const run = (rows: ScorecardSourceRow[], extra: Partial<ScorecardRunFile> = {}): ScorecardRunFile => ({
  set: 'tuning', graphBuildDate: DATE, profileHash: 'sha256:same', gitHead: 'abc123', rows, ...extra,
});

describe('item a: two-run mode', () => {
  it('counts a row only when both runs agree and prints the lower of the two counts', () => {
    const first = run([row('a', 'Win'), row('b', 'Win'), row('c', 'Tie')]);
    const second = run([row('a', 'Win'), row('b', 'Tie'), row('c', 'Win')]);
    const combined = combineRuns(first, second);
    expect(combined.rows.map(r => [r.id, r.verdict, r.agreed])).toEqual([
      ['a', 'Win', true], ['b', 'Disagree', false], ['c', 'Disagree', false],
    ]);
    expect(combined.headline).toContain('Wins 1/3 on both runs');
    expect(combined.headline).toContain('lower of the two run counts 2');
    expect(combined.disagreements).toHaveLength(2);
    expect(combined.warnings.join(' ')).toContain('do not count as wins');
  });
  it('keeps two agreeing runs at the same count and notices thin wins', () => {
    const first = run([row('a', 'Win', { margin: { thin: true } }), row('b', 'Win', { margin: { thin: false } }), row('c', 'Tie')]);
    const second = run([row('a', 'Win', { margin: { thin: true } }), row('b', 'Win', { margin: { thin: true } }), row('c', 'Tie')]);
    const combined = combineRuns(first, second);
    expect(combined.headline).toContain('Wins 2/3 on both runs (2 thin');
    expect(combined.first.thinWins).toBe(1);
    expect(combined.second.thinWins).toBe(2);
  });
  it('does not count a thin win when the other run says otherwise', () => {
    const first = run([row('a', 'Win', { margin: { thin: true } }), row('b', 'Win', { margin: { thin: true } })]);
    const second = run([row('a', 'Win', { margin: { thin: false } }), row('b', 'Tie')]);
    const combined = combineRuns(first, second);
    expect(combined.rows[0]).toMatchObject({ verdict: 'Win', agreed: true, thin: true });
    expect(combined.rows[1]).toMatchObject({ verdict: 'Disagree', agreed: false, thin: false });
    expect(combined.headline).toContain('Wins 1/2 on both runs (1 thin');
  });
  it('counts a broken fastest reference from either run in the combined headline', () => {
    const first = run([row('a', 'Win', { referenceCheck: { failed: true } }), row('b', 'Tie')]);
    const second = run([row('a', 'Win'), row('b', 'Tie', { referenceCheck: { failed: true } })]);
    const combined = combineRuns(first, second);
    expect(combined.headline).toContain('fastest-reference failures 2');
    expect(combined.warnings.join(' ')).toContain('fastest reference broke');
  });
  it('refuses to combine runs from different graph build dates, with the dates in the message', () => {
    const first = run([row('a', 'Win')]);
    const second = run([row('a', 'Win')], { graphBuildDate: '2026-11-10T09:00:00Z' });
    expect(() => combineRuns(first, second)).toThrow(IncompatibleRunsError);
    try {
      combineRuns(first, second);
    } catch (error) {
      expect((error as Error).message).toContain('different graphs');
      expect((error as Error).message).toContain(DATE);
      expect((error as Error).message).toContain('2026-11-10T09:00:00Z');
      expect((error as Error).message).toContain('same graph');
    }
  });
  it('refuses different ride sets and different rows', () => {
    expect(() => combineRuns(run([row('a', 'Win')]), run([row('a', 'Win')], { set: 'nj' }))).toThrow('different ride sets');
    expect(() => combineRuns(run([row('a', 'Win')]), run([row('b', 'Win')]))).toThrow('different rides');
  });
  it('allows two unknown build dates but warns, and refuses unknown against a known date', () => {
    const unknownA = run([row('a', 'Win')], { graphBuildDate: undefined });
    const unknownB = run([row('a', 'Win')], { graphBuildDate: undefined });
    expect(combineRuns(unknownA, unknownB).warnings.join(' ')).toContain('unknown graph build date');
    expect(() => combineRuns(unknownA, run([row('a', 'Win')]))).toThrow('different graphs');
  });
  it('warns when the profiles or the source commits differ on the same graph', () => {
    const combined = combineRuns(
      run([row('a', 'Win')]),
      run([row('a', 'Win')], { profileHash: 'sha256:other', gitHead: 'def456' }),
    );
    expect(combined.warnings.join(' ')).toContain('profile hashes differ');
    expect(combined.warnings.join(' ')).toContain('Source commits differ');
  });
  it('renders both runs and makes a disagreement visible', () => {
    const text = renderCombined(combineRuns(run([row('a', 'Win')]), run([row('a', 'Tie')])));
    expect(text).toContain('Two-run scorecard: tuning');
    expect(text).toContain('Run 1:');
    expect(text).toContain('Run 2:');
    expect(text).toContain('a: Win / Tie → Disagree (not counted)');
  });
});
