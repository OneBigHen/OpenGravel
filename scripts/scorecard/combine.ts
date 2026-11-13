import type { Row, Verdict } from './types';
import { UNKNOWN } from './provenance';

/** The parts of a saved scorecard row the two-run combiner needs. */
export interface ScorecardSourceRow {
  ride: Pick<Row['ride'], 'id' | 'label'>;
  verdict: Verdict;
  margin?: { thin?: boolean };
  referenceCheck?: { failed?: boolean };
  openGravel?: { trustFailures?: readonly string[] } | null;
}

/** A JSON file written by scorecard `run.ts`. Older files may lack the v4 fields. */
export interface ScorecardRunFile {
  set?: string;
  graphBuildDate?: string;
  profileHash?: string;
  gitHead?: string;
  generatedAt?: string;
  headline?: string;
  rows: readonly ScorecardSourceRow[];
}

export type CombinedVerdict = Verdict | 'Disagree';

export interface CombinedRow {
  id: string;
  label: string;
  first: Verdict;
  second: Verdict;
  /** The verdict both runs agree on, or `Disagree` when they do not. */
  verdict: CombinedVerdict;
  agreed: boolean;
  /** A Win both runs agree is within 10% of its bar (item c). */
  thin: boolean;
  /** The fastest reference broke in either run (item d). */
  referenceFailed: boolean;
}

export interface RunFacts {
  wins: number;
  thinWins: number;
  trustFailures: number;
  fastestReferenceFailures: number;
  graphBuildDate: string;
  profileHash: string;
  gitHead: string;
  generatedAt: string;
  headline: string;
}

export interface CombinedRun {
  mode: 'two-run';
  set: string;
  generatedAt: string;
  first: RunFacts;
  second: RunFacts;
  /** The conservative two-run headline: agreed wins, with the lower of the two raw counts printed. */
  headline: string;
  rows: CombinedRow[];
  disagreements: { id: string; label: string; first: Verdict; second: Verdict }[];
  warnings: string[];
}

/** A refusal the rider can act on: the two files must not be compared. */
export class IncompatibleRunsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleRunsError';
  }
}

function facts(run: ScorecardRunFile): RunFacts {
  return {
    wins: run.rows.filter(row => row.verdict === 'Win').length,
    thinWins: run.rows.filter(row => row.verdict === 'Win' && row.margin?.thin === true).length,
    trustFailures: run.rows.reduce((sum, row) => sum + (row.openGravel?.trustFailures?.length ?? 0), 0),
    fastestReferenceFailures: run.rows.filter(row => row.referenceCheck?.failed === true).length,
    graphBuildDate: run.graphBuildDate ?? UNKNOWN,
    profileHash: run.profileHash ?? UNKNOWN,
    gitHead: run.gitHead ?? UNKNOWN,
    generatedAt: run.generatedAt ?? UNKNOWN,
    headline: run.headline ?? 'unknown',
  };
}

function rowsById(run: ScorecardRunFile, label: string): Map<string, ScorecardSourceRow> {
  const byId = new Map<string, ScorecardSourceRow>();
  for (const row of run.rows) {
    if (byId.has(row.ride.id)) throw new IncompatibleRunsError(`Cannot combine: run ${label} lists ${row.ride.id} twice.`);
    byId.set(row.ride.id, row);
  }
  return byId;
}

/**
 * Scorecard v4 item a: one comparison is two runs, and a row counts only if
 * both runs agree. The headline prints the lower of the two raw win counts.
 * Runs from different graph builds are refused: that comparison is meaningless.
 */
export function combineRuns(first: ScorecardRunFile, second: ScorecardRunFile): CombinedRun {
  const firstSet = first.set ?? UNKNOWN;
  const secondSet = second.set ?? UNKNOWN;
  if (firstSet !== secondSet) {
    throw new IncompatibleRunsError(`Cannot combine a ${firstSet} run with a ${secondSet} run: they cover different ride sets.`);
  }
  const firstFacts = facts(first);
  const secondFacts = facts(second);
  if (firstFacts.graphBuildDate !== secondFacts.graphBuildDate) {
    throw new IncompatibleRunsError(
      `Cannot combine runs from different graphs: run 1 graph build date ${firstFacts.graphBuildDate}, run 2 ${secondFacts.graphBuildDate}. `
      + 'A two-run comparison is only honest on the same graph; run both again against one router.',
    );
  }
  if (first.rows.length === 0 || second.rows.length === 0) {
    throw new IncompatibleRunsError('Cannot combine: one of the scorecard files has no rows.');
  }

  const firstRows = rowsById(first, '1');
  const secondRows = rowsById(second, '2');
  const missing = [...firstRows.keys()].filter(id => !secondRows.has(id));
  const extra = [...secondRows.keys()].filter(id => !firstRows.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new IncompatibleRunsError(
      `Cannot combine runs with different rides: run 2 is missing ${missing.length ? missing.join(', ') : 'none'}, `
      + `run 1 is missing ${extra.length ? extra.join(', ') : 'none'}.`,
    );
  }

  const warnings: string[] = [];
  if (firstFacts.graphBuildDate === UNKNOWN) {
    warnings.push('Both runs report an unknown graph build date; the combiner cannot prove they used the same graph.');
  }
  if (firstFacts.profileHash !== secondFacts.profileHash) {
    warnings.push(`Router profile hashes differ (run 1 ${firstFacts.profileHash}, run 2 ${secondFacts.profileHash}); the profiles changed even though the graph build date matches.`);
  }
  if (firstFacts.gitHead !== secondFacts.gitHead) {
    warnings.push(`Source commits differ (run 1 ${firstFacts.gitHead}, run 2 ${secondFacts.gitHead}); the two runs describe different code.`);
  }

  const rows: CombinedRow[] = [...firstRows.values()].map(a => {
    const b = secondRows.get(a.ride.id)!;
    const agreed = a.verdict === b.verdict;
    return {
      id: a.ride.id,
      label: a.ride.label,
      first: a.verdict,
      second: b.verdict,
      verdict: agreed ? a.verdict : 'Disagree',
      agreed,
      thin: agreed && a.verdict === 'Win' && (a.margin?.thin === true || b.margin?.thin === true),
      referenceFailed: a.referenceCheck?.failed === true || b.referenceCheck?.failed === true,
    };
  });
  const disagreements = rows.filter(row => !row.agreed).map(row => ({ id: row.id, label: row.label, first: row.first, second: row.second }));
  if (disagreements.length > 0) {
    warnings.push(`${disagreements.length} row${disagreements.length === 1 ? '' : 's'} disagree between the two runs and do not count as wins: ${disagreements.map(row => `${row.label} (${row.first} / ${row.second})`).join('; ')}.`);
  }
  if (firstFacts.fastestReferenceFailures > 0 || secondFacts.fastestReferenceFailures > 0) {
    warnings.push(`The fastest reference broke in ${firstFacts.fastestReferenceFailures} run-1 and ${secondFacts.fastestReferenceFailures} run-2 ride(s); those rows are not honest time comparisons.`);
  }

  const combined: CombinedRun = {
    mode: 'two-run',
    set: firstSet,
    generatedAt: new Date().toISOString(),
    first: firstFacts,
    second: secondFacts,
    headline: '',
    rows,
    disagreements,
    warnings,
  };
  combined.headline = combinedHeadline(combined);
  return combined;
}

/** Agreed wins are the count; the lower raw run count is printed beside them. */
export function combinedHeadline(result: Pick<CombinedRun, 'rows' | 'first' | 'second'>): string {
  const wins = result.rows.filter(row => row.verdict === 'Win').length;
  const thin = result.rows.filter(row => row.verdict === 'Win' && row.thin).length;
  const lower = Math.min(result.first.wins, result.second.wins);
  const referenceFailures = result.rows.filter(row => row.referenceFailed).length;
  return `Wins ${wins}/${result.rows.length} on both runs (${thin} thin; lower of the two run counts ${lower}), fastest-reference failures ${referenceFailures}`;
}

export function renderCombined(result: CombinedRun): string {
  const factsLine = (label: string, run: RunFacts) => `${label}: ${run.headline}; graph build ${run.graphBuildDate}; profile ${run.profileHash}; git ${run.gitHead}; trust failures ${run.trustFailures}; fastest-reference failures ${run.fastestReferenceFailures}`;
  const rows = result.rows.map(row => `  ${row.label}: ${row.first} / ${row.second} → ${row.verdict}${row.agreed ? '' : ' (not counted)'}${row.thin ? ' [thin]' : ''}${row.referenceFailed ? ' [reference failed]' : ''}`);
  return [
    `Two-run scorecard: ${result.set}`,
    factsLine('Run 1', result.first),
    factsLine('Run 2', result.second),
    `Combined: ${result.headline}`,
    'Rows:',
    ...rows,
    ...(result.warnings.length > 0 ? ['Warnings:', ...result.warnings.map(warning => `  - ${warning}`)] : []),
  ].join('\n');
}
