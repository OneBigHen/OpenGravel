import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRoadAuthorityCoordinator, type RoadAuthorityCoordinator, type SourceOutcome } from '../../src/application/route-intelligence/coordinator';
import { roadAuthoritySourcesFromEnv } from '../../src/server/planning/road-authority';

/** Freeze the actual first source outcomes (including outages), not a fake
 * all-clear. A refresh or new ride date deliberately starts new evidence. */
export async function frozenAuthority(at: string, refresh: boolean, env: Record<string, string>): Promise<RoadAuthorityCoordinator> {
  const file = 'scorecard-out/authority-snapshots.json';
  let cache: Record<string, SourceOutcome[]> = {};
  if (!refresh) {
    try { cache = JSON.parse(await readFile(file, 'utf8')) as typeof cache; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let writes: Promise<void> = Promise.resolve();
  const live = createRoadAuthorityCoordinator({ sources: roadAuthoritySourcesFromEnv(env), now: () => at });
  return {
    sources: live.sources,
    async assess(box, signal, options) {
      const key = createHash('sha256').update(JSON.stringify({ at, box })).digest('hex');
      if (!cache[key]) {
        const answer = await live.assess(box, signal, options);
        // A source still loading at the deadline is a race, not evidence: never
        // freeze it, so the planner's own bounded re-check can see the answer.
        if (answer.sources.some(outcome => outcome.snapshot.timedOut === true)) return answer;
        cache[key] = [...answer.sources];
        writes = writes.then(async () => {
          await writeFile(`${file}.tmp`, JSON.stringify(cache));
          await rename(`${file}.tmp`, file);
        });
        await writes;
        return answer;
      }
      const sources = cache[key]!.map(outcome => ({
        info: outcome.info, budget: live.sources.find(s => s.info.id === outcome.info.id)!.budget,
        probe: () => ({ available: true as const, reason: null }), snapshot: async () => outcome.snapshot,
      }));
      return createRoadAuthorityCoordinator({ sources, now: () => at }).assess(box, signal);
    },
  };
}
