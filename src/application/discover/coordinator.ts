/**
 * The discovery coordinator: ask every source about a few bounded circles,
 * each inside a deadline; merge duplicates; keep what the query actually
 * covers; measure distance and detour; rank; bound the answer.
 *
 * A source outage is reported per source and never blocks the rest, and it
 * never touches planning: discovery reads, the rider decides.
 */

import { haversine } from "@/domain/geometry/analysis";

import { dedupePlaces } from "./dedupe";
import type { InterestingPlaceAnswer, InterestingPlaceSource, PlaceEnricher } from "./interesting-place-source";
import { rankPlaces } from "./rank";
import { distanceToLineMeters, searchAreaFor, thinLine } from "./search-area";
import type { DiscoverRequest, DiscoverResult, DiscoverSourceReport, InterestingPlace } from "./types";

export const DISCOVER_DEADLINE_MS = 4_000;
export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 60;
/** Enrichment gets this much after the sources answer, for at most `ENRICH_TOP` places. */
export const ENRICH_BUDGET_MS = 1_200;
const ENRICH_TOP = 40;
/** Out-and-back at a relaxed backroad pace, for the "~N min detour" estimate. */
const DETOUR_SPEED_MPS = 40_000 / 3_600;

export interface DiscoverCoordinator {
  discover(request: DiscoverRequest, signal: AbortSignal): Promise<DiscoverResult>;
}

function withDeadline(source: InterestingPlaceSource, run: () => Promise<InterestingPlaceAnswer>, deadlineMs: number): Promise<InterestingPlaceAnswer> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ status: "unavailable", reason: `${source.label} did not answer in time.`, places: [] }),
      deadlineMs,
    );
    run().then(
      (answer) => { clearTimeout(timer); resolve(answer); },
      () => { clearTimeout(timer); resolve({ status: "unavailable", reason: `${source.label} failed.`, places: [] }); },
    );
  });
}

export function createDiscoverCoordinator(deps: {
  readonly sources: readonly InterestingPlaceSource[];
  /** Fill in images, summaries and kinds for places a source found bare (Wikidata). */
  readonly enrichers?: readonly PlaceEnricher[];
  readonly deadlineMs?: number;
  readonly now?: () => string;
}): DiscoverCoordinator {
  const deadlineMs = deps.deadlineMs ?? DISCOVER_DEADLINE_MS;
  const now = deps.now ?? (() => new Date().toISOString());
  const order = new Map(deps.sources.map((source, index) => [source.id, index]));

  return {
    async discover(request, signal) {
      const area = searchAreaFor(request.query);
      const answers = await Promise.all(deps.sources.map(async (source) => ({
        source,
        answer: await withDeadline(source, () => source.search(area, signal), deadlineMs),
      })));
      const reports: DiscoverSourceReport[] = answers.map(({ source, answer }) => ({
        id: source.id,
        label: source.label,
        status: answer.status,
        reason: answer.reason ?? (area.partial ? "Only part of this route could be searched." : null),
      }));

      const at = now();
      const merged = dedupePlaces(
        answers.flatMap(({ answer }) => answer.places).filter((place) => place.validUntil === undefined || place.validUntil > at),
        (sourceId) => order.get(sourceId) ?? Number.MAX_SAFE_INTEGER,
      );

      const query = request.query;
      const line = query.kind === "corridor" ? thinLine(query.line) : null;
      const measured: InterestingPlace[] = [];
      for (const place of merged) {
        if (request.categories !== undefined && request.categories.length > 0 &&
            !place.categories.some((category) => request.categories!.includes(category))) continue;
        if (query.kind === "corridor") {
          const off = distanceToLineMeters(place.coordinate, line!);
          if (off > query.bufferMeters) continue;
          measured.push({
            ...place,
            distanceFromRouteMeters: Math.round(off),
            detourMinutes: Math.max(1, Math.round((2 * off) / DETOUR_SPEED_MPS / 60)),
          });
        } else {
          const distance = haversine(query.center, place.coordinate);
          if (distance > query.radiusMeters) continue;
          measured.push({ ...place, distanceMeters: Math.round(distance) });
        }
      }

      const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const context = {
        ...(request.categories === undefined ? {} : { preferred: request.categories }),
        ...(query.kind === "corridor" ? {} : { radiusMeters: query.radiusMeters }),
      };
      let candidates: readonly InterestingPlace[] = measured;
      for (const enricher of deps.enrichers ?? []) {
        // Only the leading bare places are worth the calls.
        const bare = rankPlaces(candidates, context)
          .filter((place) => place.wikidataId !== null && (place.image === null || place.description === null))
          .slice(0, ENRICH_TOP);
        if (bare.length === 0) continue;
        const enriched = await enricher.enrich(bare, signal, ENRICH_BUDGET_MS).catch(() => bare);
        const byId = new Map(enriched.map((place) => [place.id, place]));
        candidates = candidates.map((place) => byId.get(place.id) ?? place);
      }
      const ranked = rankPlaces(candidates, context);
      return { places: ranked.slice(0, limit), sources: reports, generatedAt: at };
    },
  };
}
