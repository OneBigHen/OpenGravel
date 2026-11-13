/**
 * Scorecard v4 two-run mode. Give it two result files from the same graph:
 *   npm run scorecard:combine -- scorecard-out/run-1.json scorecard-out/run-2.json
 * A row counts only if both runs agree; the headline prints the lower of the
 * two raw win counts. Runs from different graph build dates are refused.
 * The old single-run report and `scorecard-out/latest.json` are untouched.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { combineRuns, IncompatibleRunsError, renderCombined, type ScorecardRunFile } from './combine';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (outIndex >= 0 && out === undefined) throw new Error('--out needs a file path');
  const outPath = out ?? 'scorecard-out/combined.json';
  const files = outIndex >= 0 ? args.filter((_, index) => index !== outIndex && index !== outIndex + 1) : args;
  if (files.length !== 2) throw new Error('Usage: npm run scorecard:combine -- <run-1.json> <run-2.json> [--out combined.json]');
  const read = async (path: string): Promise<ScorecardRunFile> => JSON.parse(await readFile(path, 'utf8')) as ScorecardRunFile;
  try {
    const result = combineRuns(await read(files[0]!), await read(files[1]!));
    await mkdir('scorecard-out', { recursive: true });
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(renderCombined(result));
    console.log(`Wrote ${outPath}`);
  } catch (error) {
    if (error instanceof IncompatibleRunsError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

main().catch(error => { console.error(error); process.exit(1); });
