/**
 * Deployment wiring for the fun-route generator family.
 *
 * `OGV_FUN_GENERATORS` decides what the family may do in a live plan:
 *
 * - `off` (default, also any unknown value): never runs;
 * - `shadow`: runs **after** the plan answered, detached from the rider's
 *   request, and only records a diagnostic report — the bundle, its roles and
 *   its winner are exactly what they would have been;
 * - `on`: runs before the bundle is built and merges the eligible generated
 *   routes into the canonical ranking. Research only; it spends extra provider
 *   calls and has not earned rider-visible use (see the 2026-10-03 lane report).
 *
 * Budget knobs: `OGV_FUN_GENERATORS_CALLS` (default 2, max 8),
 * `OGV_FUN_GENERATORS_DEADLINE_MS` (default 12000, max 30000) and
 * `OGV_FUN_GENERATORS_ALLOCATION` (`fixed` | `adaptive`, default `fixed`).
 */

import {
  MAX_FUN_GENERATOR_CALLS,
  MAX_FUN_GENERATOR_DEADLINE_MS,
  type FunGeneratorAllocation,
  type FunGeneratorBudget,
  type FunGeneratorReport,
} from "@/application/planner/fun-generators";
import type { LibraryRide } from "@/application/planner/fun-generator-sources";

export type FunGeneratorMode = "off" | "shadow" | "on";

export interface FunGeneratorSettings {
  readonly mode: FunGeneratorMode;
  readonly budget: FunGeneratorBudget;
  readonly allocation: FunGeneratorAllocation;
}

export const DEFAULT_FUN_GENERATOR_CALLS = 2;
export const DEFAULT_FUN_GENERATOR_DEADLINE_MS = 12_000;

function boundedInteger(raw: string | undefined, fallback: number, maximum: number): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : fallback;
}

export function funGeneratorSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): FunGeneratorSettings {
  const raw = env["OGV_FUN_GENERATORS"]?.trim().toLowerCase();
  const mode: FunGeneratorMode = raw === "shadow" || raw === "on" ? raw : "off";
  const allocation: FunGeneratorAllocation =
    env["OGV_FUN_GENERATORS_ALLOCATION"]?.trim().toLowerCase() === "adaptive" ? "adaptive" : "fixed";
  return {
    mode,
    allocation,
    budget: {
      maxProviderCalls: boundedInteger(env["OGV_FUN_GENERATORS_CALLS"], DEFAULT_FUN_GENERATOR_CALLS, MAX_FUN_GENERATOR_CALLS),
      deadlineMs: boundedInteger(env["OGV_FUN_GENERATORS_DEADLINE_MS"], DEFAULT_FUN_GENERATOR_DEADLINE_MS, MAX_FUN_GENERATOR_DEADLINE_MS),
    },
  };
}

let libraryRides: Promise<readonly LibraryRide[]> | null = null;

/**
 * The curated route library as corridor sources, loaded once and only when the
 * family actually runs (the catalogue is a gzip read at import time).
 */
export function deploymentLibraryRides(): Promise<readonly LibraryRide[]> {
  libraryRides ??= import("@/server/explore/catalog-data").then(
    (module) => module.serverCatalogEntries.map((entry) => ({ id: entry.id, geometry: entry.geometry })),
    () => [],
  );
  return libraryRides;
}

/**
 * The server log line for one run: counts and measurements only, never
 * geometry, coordinates or provider text.
 */
export function funGeneratorLogLine(mode: FunGeneratorMode, requestId: string, report: FunGeneratorReport): string {
  return `[ogv-fun-generators] ${JSON.stringify({
    mode,
    requestId,
    allocation: report.allocation,
    calls: report.providerCallsUsed,
    budget: report.budget.maxProviderCalls,
    elapsedMs: Math.round(report.elapsedMs),
    proposals: report.proposals,
    probes: report.probes.map((probe) => ({
      generator: probe.generator,
      status: probe.status,
      calls: probe.providerCalls,
      note: probe.note,
      adherence: probe.adherence === null ? null : Number(probe.adherence.toFixed(2)),
      bend: probe.measurement?.bendShare ?? null,
      backroad: probe.measurement?.backroadShare ?? null,
      minutes: probe.measurement === undefined ? null : Math.round(probe.measurement.durationSeconds / 60),
    })),
  })}`;
}
