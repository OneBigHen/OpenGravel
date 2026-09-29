/**
 * Surface taxonomy and confidence aggregation (07 §4–§7; Wave 6 task 6.3).
 *
 * This module intentionally knows nothing about a provider, clock, storage or
 * UI. A caller supplies the reference instant when it wants age/expiry applied.
 * Raw provider and legacy labels are reduced to four rider-safe classes; an
 * unrecognised label is unknown rather than pavement.
 */

export const SURFACE_CLASSES = ["paved", "gravel", "dirt", "unknown"] as const;
export type SurfaceClass = (typeof SURFACE_CLASSES)[number];
/** Compatibility spelling for callers that use "kind" for a taxonomy value. */
export type SurfaceKind = SurfaceClass;
export type SurfaceBand = "confirmed" | "likely" | "possible" | "unknown";

/** One immutable report before it is reduced into an assessment. */
export interface SurfaceEvidence {
  readonly id: string;
  /** Canonical or legacy/raw source value; the adapter canonicalises it. */
  readonly value?: string | null;
  /** Legacy/provider spelling accepted at the taxonomy boundary. */
  readonly surface?: string | null;
  readonly kind?: string | null;
  readonly source: string;
  /** Optional auditable actor/source identity for independence checks. */
  readonly sourceKey?: string;
  readonly sourceLabel?: string;
  readonly observedAt?: string;
  /** Source reliability, before report confidence is applied. */
  readonly weight?: number;
  /** The source's stated confidence; null means it did not state one. */
  readonly confidence?: number | null;
  /** One of these expiration declarations is enough to make age auditable. */
  readonly stalenessWindowDays?: number;
  readonly stalenessWindowMs?: number;
  readonly staleAfterDays?: number;
  readonly staleAfterMs?: number;
  readonly expiresAt?: string;
  /** Useful for already-snapshotted evidence; callers may still pass options.asOf. */
  readonly asOf?: string;
}

export interface SurfaceProvenance {
  readonly evidenceId: string;
  readonly source: string;
  readonly sourceLabel: string;
  readonly value: SurfaceClass;
  readonly observedAt: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
  readonly weight: number;
  readonly confidence: number | null;
}

export interface SurfaceConflict {
  readonly values: readonly SurfaceClass[];
  readonly evidenceIds: readonly string[];
  readonly sources: readonly string[];
}

export interface SurfaceAssessment {
  readonly value: SurfaceClass;
  readonly band: SurfaceBand;
  readonly conflicts: readonly SurfaceConflict[];
  readonly provenance: readonly SurfaceProvenance[];
  readonly evidenceCount: number;
  readonly sourceDiversity: number;
  readonly stale: boolean;
}

export interface SurfaceAggregationOptions {
  /** Reference time for expiration. Omit to use each report's own snapshot time. */
  readonly asOf?: string;
  /** Alias accepted by application adapters that call the reference "now". */
  readonly now?: string;
}

/** Source defaults are deliberately conservative and keep generated routes at zero. */
export const DEFAULT_SURFACE_SOURCE_WEIGHTS: Readonly<Record<string, number>> = {
  official: 1,
  "official-authority": 1,
  survey: 1,
  "state-survey": 1,
  "gravel-atlas": 0.9,
  osm: 0.75,
  rider: 0.8,
  "recorded-ride": 0.8,
  import: 0.2,
  "route-corpus": 0.2,
  "generated-route": 0,
};

const MS_PER_DAY = 86_400_000;

function clamp(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizedLabel(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("en-US").replace(/[_\s]+/g, "-")
    : "";
}

/** Maps detailed OSM/legacy labels without ever treating an unknown as paved. */
export function adaptLegacySurface(value: unknown): SurfaceClass {
  const label = normalizedLabel(value);
  if (label.length === 0 || label === "unknown" || label === "other" || label === "none") {
    return "unknown";
  }
  if (label === "paved" || label === "paved-smooth" || label === "paved-rough"
    || label === "chip-seal" || label === "asphalt" || label === "concrete"
    || label === "sett" || label === "cobblestone" || label === "cobble") {
    return "paved";
  }
  if (label === "gravel" || label === "maintained-gravel" || label === "loose-gravel"
    || label === "fine-gravel" || label === "compacted" || label === "pebblestone") {
    return "gravel";
  }
  if (label === "dirt" || label === "rough-track" || label === "track" || label === "earth"
    || label === "ground" || label === "sand" || label === "mud" || label === "mud-prone"
    || label === "rock") {
    return "dirt";
  }
  return "unknown";
}

/** Compatibility alias for legacy adapters that call this a taxonomy mapper. */
export const surfaceFromLegacy = adaptLegacySurface;

function parseInstant(value: string | undefined): number | null {
  if (value === undefined) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function sourceWeight(record: SurfaceEvidence): number {
  // A generated path can never acquire evidence by supplying a larger weight.
  if (record.source === "generated-route") return 0;
  const configured = record.weight ?? DEFAULT_SURFACE_SOURCE_WEIGHTS[record.source] ?? 0.5;
  return clamp(configured, 0);
}

function reportConfidence(record: SurfaceEvidence): number {
  // Missing confidence is not a negative report, but it is not strong enough to
  // reach confirmed: uncertainty is represented by the possible ceiling.
  return record.confidence === null || record.confidence === undefined
    ? 0.25
    : clamp(record.confidence, 0);
}

function stalenessWindowMs(record: SurfaceEvidence): number | null {
  const configuredMs = record.stalenessWindowMs ?? record.staleAfterMs;
  if (configuredMs !== undefined && Number.isFinite(configuredMs)) {
    return Math.max(0, configuredMs);
  }
  const configuredDays = record.stalenessWindowDays ?? record.staleAfterDays;
  if (configuredDays !== undefined && Number.isFinite(configuredDays)) {
    return Math.max(0, configuredDays) * MS_PER_DAY;
  }
  return null;
}

function reportFreshness(
  record: SurfaceEvidence,
  options: SurfaceAggregationOptions,
): { readonly ageDays: number | null; readonly stale: boolean } {
  const observedAt = parseInstant(record.observedAt);
  const reference = parseInstant(options.asOf ?? options.now ?? record.asOf ?? record.observedAt);
  const expiresAt = parseInstant(record.expiresAt);
  if (reference === null) return { ageDays: null, stale: false };
  const ageMs = observedAt === null || reference < observedAt ? null : reference - observedAt;
  const windowMs = stalenessWindowMs(record);
  return {
    ageDays: ageMs === null ? null : Math.floor(ageMs / MS_PER_DAY),
    stale: (ageMs !== null && windowMs !== null && ageMs > windowMs)
      || (expiresAt !== null && reference > expiresAt),
  };
}

function bandRank(band: SurfaceBand): number {
  switch (band) {
    case "unknown": return 0;
    case "possible": return 1;
    case "likely": return 2;
    case "confirmed": return 3;
  }
}

function bandAtMost(left: SurfaceBand, right: SurfaceBand): SurfaceBand {
  return bandRank(left) <= bandRank(right) ? left : right;
}

function lowerBand(band: SurfaceBand): SurfaceBand {
  switch (band) {
    case "confirmed": return "likely";
    case "likely": return "possible";
    case "possible":
    case "unknown": return "unknown";
  }
}

function baseBand(
  records: readonly SurfaceEvidence[],
  signals: ReadonlyMap<string, number>,
): SurfaceBand {
  const total = Math.min(1, [...signals.values()].reduce((sum, signal) => sum + signal, 0));
  const maximum = Math.max(...signals.values(), 0);
  const hasExplicitSourceKeys = records.some((record) => record.sourceKey !== undefined);
  const independentSources = new Set(records.map((record) => record.sourceKey ?? record.source)).size;
  const hasStatedConfidence = records.some((record) => record.confidence !== null && record.confidence !== undefined);
  if (!hasStatedConfidence) return "possible";
  if ((!hasExplicitSourceKeys || independentSources >= 2) && (maximum >= 0.9
    || (independentSources >= 2 && maximum >= 0.5 && total >= 0.95))) {
    return "confirmed";
  }
  if (maximum >= 0.5 || total >= 0.55) return "likely";
  return "possible";
}

function compareProvenance(left: SurfaceProvenance, right: SurfaceProvenance): number {
  return (right.observedAt ?? "").localeCompare(left.observedAt ?? "")
    || left.evidenceId.localeCompare(right.evidenceId);
}

/**
 * Reduces categorical surface reports without averaging incompatible values.
 * Conflicts retain their records, force the value back to unknown, and cap the
 * display band at possible. A stale winning report loses exactly one band.
 */
export function aggregateSurface(
  evidence: readonly SurfaceEvidence[],
  options: SurfaceAggregationOptions = {},
): SurfaceAssessment {
  const provenance = evidence.map((record) => {
    const value = adaptLegacySurface(record.value ?? record.surface ?? record.kind);
    const freshness = reportFreshness(record, options);
    return {
      evidenceId: record.id,
      source: record.source,
      sourceLabel: record.sourceLabel ?? record.source,
      value,
      observedAt: record.observedAt ?? null,
      ageDays: freshness.ageDays,
      stale: freshness.stale,
      weight: sourceWeight(record),
      confidence: record.confidence === undefined ? null : record.confidence,
    } satisfies SurfaceProvenance;
  }).sort(compareProvenance);

  const known = evidence
    .map((record, index) => ({
      record,
      provenance: provenance.find((entry) => entry.evidenceId === record.id) ?? provenance[index]!,
      value: adaptLegacySurface(record.value ?? record.surface ?? record.kind),
    }))
    .filter((entry) => entry.value !== "unknown" && entry.provenance.weight > 0);
  const values = [...new Set(known.map((entry) => entry.value))].sort();
  const sourceDiversity = new Set(known.map((entry) => entry.record.sourceKey ?? entry.record.source)).size;
  const conflicts: readonly SurfaceConflict[] = values.length > 1
    ? [{
        values,
        evidenceIds: known.map((entry) => entry.record.id).sort(),
        sources: [...new Set(known.map((entry) => entry.record.source))].sort(),
      }]
    : [];

  const signals = new Map<string, number>();
  for (const entry of known) {
    const signal = sourceWeight(entry.record) * reportConfidence(entry.record);
    signals.set(entry.value, (signals.get(entry.value) ?? 0) + signal);
  }

  const selectedValue = values.length === 1 ? values[0]! : "unknown";
  const selectedRecords = known.filter((entry) => entry.value === selectedValue);
  const hasStaleWinner = selectedRecords.some((entry) => entry.provenance.stale);
  let band = values.length === 0
    ? "unknown"
    : baseBand(selectedRecords.map((entry) => entry.record), new Map([[selectedValue, signals.get(selectedValue) ?? 0]]));
  if (hasStaleWinner) band = lowerBand(band);
  if (conflicts.length > 0) band = bandAtMost(band, "possible");
  const value: SurfaceClass = band === "unknown" || conflicts.length > 0 ? "unknown" : selectedValue;

  return {
    value,
    band,
    conflicts,
    provenance,
    evidenceCount: known.length,
    sourceDiversity,
    stale: provenance.some((entry) => entry.stale),
  };
}
