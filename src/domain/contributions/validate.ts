import { deepFreeze } from "../util/freeze";
import {
  CONTRIBUTION_CONDITION_SEVERITIES,
  CONTRIBUTION_EVIDENCE_LEVELS,
  CONTRIBUTION_GATE_VALUES,
  CONTRIBUTION_KINDS,
  CONTRIBUTION_SURFACE_VALUES,
  type ContributionEnvelope,
  type ContributionKind,
  type ContributionConditionSeverity,
  type ContributionEvidenceLevel,
  type ContributionGateValue,
  type ContributionRoadRef,
  type ContributionSurfaceValue,
} from "./types";
import { asRoadEntityId, asRoadSpanId } from "../ride/ids";

export const CONTRIBUTION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const CONTRIBUTION_MAX_GPS_PRECISION_M = 1_000;
export const CONTRIBUTION_MAX_CONDITION_TAG_LENGTH = 80;
export const CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH = 500;
export const CONTRIBUTION_MAX_CLIENT_VERSION_LENGTH = 64;

export type ContributionValidationCode =
  | "invalid-shape"
  | "missing-field"
  | "invalid-road-ref"
  | "invalid-observed-at"
  | "future-observation"
  | "invalid-position-accuracy"
  | "invalid-value"
  | "invalid-provenance";

export interface ContributionValidationError {
  readonly code: ContributionValidationCode;
  readonly field: string;
  readonly message: string;
}

export type ContributionValidationResult =
  | { readonly ok: true; readonly value: ContributionEnvelope }
  | { readonly ok: false; readonly errors: readonly ContributionValidationError[] };

export interface ContributionValidationOptions {
  /** Reference clock used for the future-skew guard; defaults to Date.now(). */
  readonly now?: string | number | Date;
  readonly maxFutureSkewMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(
  code: ContributionValidationCode,
  field: string,
  message: string,
): ContributionValidationError {
  return { code, field, message };
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parsedTime(value: unknown): number | null {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > 64
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function referenceTime(value: string | number | Date | undefined): number {
  if (value === undefined) return Date.now();
  const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function validateRoadRef(value: unknown, issues: ContributionValidationError[]): void {
  if (!isRecord(value)) {
    issues.push(error("missing-field", "roadRef", "roadRef must contain a canonical roadId and spanId"));
    return;
  }
  if (typeof value.roadId !== "string" || !/^road_[A-Za-z0-9_-]{1,120}$/.test(value.roadId)) {
    issues.push(error("invalid-road-ref", "roadRef.roadId", "roadId must be a canonical road_ identifier"));
  }
  if (typeof value.spanId !== "string" || !/^span_[A-Za-z0-9_-]{1,120}$/.test(value.spanId)) {
    issues.push(error("invalid-road-ref", "roadRef.spanId", "spanId must be a canonical span_ identifier"));
  }
}

function validateProvenance(value: unknown, issues: ContributionValidationError[]): void {
  if (!isRecord(value)) {
    issues.push(error("missing-field", "provenance", "provenance is required"));
    return;
  }
  if (typeof value.contributorPseudoId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.contributorPseudoId)) {
    issues.push(error("invalid-provenance", "provenance.contributorPseudoId", "must be a UUID v4 pseudo-id"));
  }
  if (typeof value.clientVersion !== "string"
    || value.clientVersion.length === 0
    || value.clientVersion.length > CONTRIBUTION_MAX_CLIENT_VERSION_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value.clientVersion)) {
    issues.push(error("invalid-provenance", "provenance.clientVersion", "must be a bounded non-empty client version"));
  }
  if (!oneOf(value.evidenceLevel, CONTRIBUTION_EVIDENCE_LEVELS)) {
    issues.push(error("invalid-provenance", "provenance.evidenceLevel", `must be one of ${CONTRIBUTION_EVIDENCE_LEVELS.join(", ")}`));
  }
}

function validateValue(
  kind: ContributionKind,
  value: unknown,
  issues: ContributionValidationError[],
): void {
  if (kind === "surface") {
    if (!oneOf(value, CONTRIBUTION_SURFACE_VALUES)) {
      issues.push(error("invalid-value", "value", `surface must be one of ${CONTRIBUTION_SURFACE_VALUES.join(", ")}`));
    }
    return;
  }
  if (kind === "gate") {
    if (!oneOf(value, CONTRIBUTION_GATE_VALUES)) {
      issues.push(error("invalid-value", "value", `gate must be one of ${CONTRIBUTION_GATE_VALUES.join(", ")}`));
    }
    return;
  }
  if (!isRecord(value)) {
    issues.push(error("invalid-value", "value", "condition must contain a tag and severity"));
    return;
  }
  if (typeof value.tag !== "string"
    || value.tag.trim().length === 0
    || value.tag.length > CONTRIBUTION_MAX_CONDITION_TAG_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value.tag)) {
    issues.push(error("invalid-value", "value.tag", `condition tag must be 1-${CONTRIBUTION_MAX_CONDITION_TAG_LENGTH} printable characters`));
  }
  if (!oneOf(value.severity, CONTRIBUTION_CONDITION_SEVERITIES)) {
    issues.push(error("invalid-value", "value.severity", `severity must be one of ${CONTRIBUTION_CONDITION_SEVERITIES.join(", ")}`));
  }
  if (value.note !== undefined && (typeof value.note !== "string"
    || value.note.trim().length === 0
    || value.note.length > CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.note))) {
    issues.push(error("invalid-value", "value.note", `condition note must be 1-${CONTRIBUTION_MAX_CONDITION_NOTE_LENGTH} printable characters`));
  }
}

/** Returns typed issues and never repairs or persists untrusted input. */
export function validateContribution(
  input: unknown,
  options: ContributionValidationOptions = {},
): readonly ContributionValidationError[] {
  const issues: ContributionValidationError[] = [];
  if (!isRecord(input)) {
    return [error("invalid-shape", "body", "contribution must be an object")];
  }

  if (!oneOf(input.kind, CONTRIBUTION_KINDS)) {
    issues.push(error("invalid-value", "kind", `kind must be one of ${CONTRIBUTION_KINDS.join(", ")}`));
  }
  validateRoadRef(input.roadRef, issues);

  const observed = parsedTime(input.observedAt);
  if (observed === null) {
    issues.push(error("invalid-observed-at", "observedAt", "observedAt must be a valid ISO-8601 instant"));
  } else if (observed > referenceTime(options.now) + (options.maxFutureSkewMs ?? CONTRIBUTION_MAX_FUTURE_SKEW_MS)) {
    issues.push(error("future-observation", "observedAt", "observedAt cannot be materially in the future"));
  }

  if (typeof input.gps_precision_m !== "number"
    || !Number.isFinite(input.gps_precision_m)
    || input.gps_precision_m < 0
    || input.gps_precision_m > CONTRIBUTION_MAX_GPS_PRECISION_M) {
    issues.push(error("invalid-position-accuracy", "gps_precision_m", `gps_precision_m must be finite and in [0, ${CONTRIBUTION_MAX_GPS_PRECISION_M}]`));
  }

  validateProvenance(input.provenance, issues);
  if (oneOf(input.kind, CONTRIBUTION_KINDS)) validateValue(input.kind, input.value, issues);
  return issues;
}

function copyRoadRef(value: Record<string, unknown>): ContributionRoadRef {
  return {
    roadId: asRoadEntityId(value.roadId as string),
    spanId: asRoadSpanId(value.spanId as string),
  };
}

/** Validates and narrows a wire value, dropping unknown fields from the copy. */
export function parseContribution(
  input: unknown,
  options: ContributionValidationOptions = {},
): ContributionValidationResult {
  const errors = validateContribution(input, options);
  if (errors.length > 0) return { ok: false, errors };
  const value = input as Record<string, unknown>;
  const provenance = value.provenance as Record<string, unknown>;
  const base = {
    roadRef: copyRoadRef(value.roadRef as Record<string, unknown>),
    observedAt: value.observedAt as string,
    gps_precision_m: value.gps_precision_m as number,
    provenance: {
      contributorPseudoId: provenance.contributorPseudoId as string,
      clientVersion: provenance.clientVersion as string,
      evidenceLevel: provenance.evidenceLevel as ContributionEvidenceLevel,
    },
  };
  let envelope: ContributionEnvelope;
  switch (value.kind as ContributionKind) {
    case "surface":
      envelope = { ...base, kind: "surface", value: value.value as ContributionSurfaceValue };
      break;
    case "gate":
      envelope = { ...base, kind: "gate", value: value.value as ContributionGateValue };
      break;
    case "condition": {
      const condition = value.value as Record<string, unknown>;
      envelope = {
        ...base,
        kind: "condition",
        value: {
          tag: condition.tag as string,
          severity: condition.severity as ContributionConditionSeverity,
          ...(typeof condition.note === "string" ? { note: condition.note.trim() } : {}),
        },
      };
      break;
    }
    default:
      throw new Error("validateContribution accepted an unknown contribution kind");
  }
  return { ok: true, value: deepFreeze(envelope) };
}
