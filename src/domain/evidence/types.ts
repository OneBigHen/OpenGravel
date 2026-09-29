/**
 * Evidence value semantics (03-DOMAIN-MODEL §18, 07-ROAD-INTELLIGENCE §2).
 *
 * Integrity rule 2: **absence is never negative evidence**. A missing value is
 * `unknown`, never `false`, `0`, or `""` — and nothing in this module promotes
 * an absent value into a known-ish state. Consumers that need a conservative
 * decision make it from policy, not by reading a fabricated negative out of an
 * empty value.
 */

import type { GeometryRef } from "../ride/ids";
import { asRouteSpanRef, type RouteSpanRef } from "../route/ids";
import { unitIntervalIssue } from "./validate";

/**
 * Span identity is owned by the route module (OGV-D-141); this re-export keeps
 * the evidence module's public surface unchanged for existing call sites.
 */
export { asRouteSpanRef };
export type { RouteSpanRef };

export type EvidenceStatus =
  | "known"
  | "estimated"
  | "unknown"
  | "unavailable"
  | "stale";

export type EvidenceCategory =
  | "routing"
  | "osm"
  | "survey"
  | "rider"
  | "traffic"
  | "weather"
  | "derived"
  | "other";

/** What an evidence value applies to (03-DOMAIN-MODEL §18, 07 §2). */
export type EvidenceScope = GeometryRef | RouteSpanRef;

/** One source that can support (or decline to support) a value. */
export interface EvidenceSource {
  readonly id: string;
  readonly label: string;
  readonly category: EvidenceCategory;
  /** ISO-8601 instant of the observation, for time-sensitive evidence. */
  readonly observedAt?: string;
  /** Evidence aspects this source is authoritative for (e.g. `"surface"`). */
  readonly authoritativeFor?: readonly string[];
}

/** A value with its status, confidence, coverage and provenance. */
export interface EvidenceValue<T> {
  readonly value: T | null;
  readonly status: EvidenceStatus;
  /** Finite `0..1`, or `null` when the source did not state one. */
  readonly confidence: number | null;
  /** Share of the relevant span/area this value actually covers, 0..1. */
  readonly coverage?: number;
  /** The geometry or road span this value is about (07 §2). */
  readonly appliesTo?: EvidenceScope;
  /** ISO-8601 instant the value was observed. */
  readonly observedAt?: string;
  readonly provenance: readonly EvidenceSource[];
  /**
   * Why the value is absent. Explanation metadata for copy and diagnostics
   * only: it carries no evidence weight, is not a source, and never changes
   * `status`.
   */
  readonly reason?: string;
}

/**
 * The unknown-first default: no value, no confidence, no sources. Use this
 * wherever evidence was requested but not obtained — never a `false`-like
 * stand-in value. `appliesTo` still records the span/geometry the question was
 * about, so absence stays scoped.
 */
export function unknownEvidence<T>(
  reason?: string,
  appliesTo?: EvidenceScope,
): EvidenceValue<T> {
  const base: EvidenceValue<T> = {
    value: null,
    status: "unknown",
    confidence: null,
    provenance: [],
  };
  const withReason = reason === undefined ? base : { ...base, reason };
  return appliesTo === undefined ? withReason : { ...withReason, appliesTo };
}

/**
 * Evidence that a source declined to provide at all (provider offline, span
 * outside coverage). Distinct from `unknown`: nothing was asked of the data.
 */
export function unavailableEvidence<T>(
  appliesTo?: EvidenceScope,
): EvidenceValue<T> {
  const base: EvidenceValue<T> = {
    value: null,
    status: "unavailable",
    confidence: null,
    provenance: [],
  };
  return appliesTo === undefined ? base : { ...base, appliesTo };
}

/**
 * Evidence a source actually reported. `confidence` is validated rather than
 * stored blindly: a non-finite or out-of-range number throws a `TypeError`, so
 * no consumer can read an infinite confidence out of an otherwise usable value.
 */
export function knownEvidence<T>(
  value: T,
  source: EvidenceSource,
  confidence?: number,
  appliesTo?: EvidenceScope,
): EvidenceValue<T> {
  if (confidence !== undefined) {
    const issue = unitIntervalIssue("knownEvidence confidence", confidence);
    if (issue !== null) throw new TypeError(issue);
  }
  const evidence: EvidenceValue<T> = {
    value,
    status: "known",
    confidence: confidence ?? null,
    provenance: [source],
  };
  return appliesTo === undefined ? evidence : { ...evidence, appliesTo };
}

/**
 * True only for `known` or `estimated` evidence that carries a value.
 *
 * Anything else — `unknown`, `unavailable`, `stale`, or a known-valued status
 * with a null value — is **not** usable. `isUsableEvidence(...) === false`
 * means "we do not know", never "the answer is no".
 */
export function isUsableEvidence<T>(evidence: EvidenceValue<T>): boolean {
  if (evidence.value === null) return false;
  return evidence.status === "known" || evidence.status === "estimated";
}
