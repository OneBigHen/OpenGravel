/**
 * Deterministic route explanation (Wave-3 task 3.4; 04 §13, 06 §9–§10,
 * 07 §2/§5, `OGV-RIG-005`).
 *
 * `Why this ride?` is assembled from the score's own structured fields — the
 * component inputs, their evidence status, and the distance/time deltas against
 * the same-constraint fastest reference — and from nothing else. There is no
 * model in this path (06 §10): the same input always produces byte-identical
 * copy, which is what makes the sentence checkable against the evidence that
 * produced it.
 *
 * ## The two copy rules
 *
 * 1. **The headline states the trade.** With a fastest reference it says what
 *    the detour costs and, when a component measured an improvement over that
 *    reference, what the rider buys with it ("a curvier line", "lower
 *    traffic"). Without a reference it says there is no comparison instead of
 *    inventing one.
 * 2. **The bullets are an evidence ledger.** A bullet exists only for a
 *    component that measured something (`input != null`, `06 §10`) plus the
 *    explicit unknowns a rider has to know about before trusting the rest.
 *    Absence is never dressed as a fact (03 §18, 07 §2 rule 2).
 *
 * ## What is deliberately not here yet
 *
 * - **No geography names.** "lower-traffic county roads" needs road naming
 *   (RoadEntity), which is Wave 6/7 work; until then the benefit clauses are
 *   honest generic phrasing rather than an invented place (`OGV-D-250`).
 * - **No raw score.** Neither the component contributions nor `RouteScore.total`
 *   are printed: an opaque 0–100 number is exactly what 06 §17 forbids as a
 *   reason. The prose is qualitative and the digits that do appear are miles
 *   measured on the route.
 * - **No provider names.** A candidate's `provider` is provenance, never copy
 *   (VNX-007, Rule E).
 * - **No route warnings.** A `RouteWarning` carries authored copy but no
 *   evidence status, so a bullet for one would have to re-derive the pipeline's
 *   own provenance semantics in the UI. It stays out until the warning record
 *   carries the status itself (`OGV-D-250`).
 *
 * ## Bullet vocabulary (stable keys)
 *
 * | key                        | when                                            |
 * | -------------------------- | ----------------------------------------------- |
 * | `component.confidence`     | always — the declared-evidence coverage          |
 * | `surface.coverage`         | always — verified vs unverified route mileage    |
 * | `component.<axis>`         | the axis measured something, or (traffic and    |
 * |                            | closure only) it is unknown, which a rider must |
 * |                            | see before trusting the rest                    |
 *
 * The axes are listed here in `ROUTE_SCORE_COMPONENT_KEYS` order, so the bullet
 * list reads the same for every route, and `timeCost`/`confidence` never appear
 * as their own bullet: the detour is the headline and the coverage is
 * `component.confidence`.
 */

import {
  isRoutePolicy,
  type RoutePolicy,
  type RouteScoreComponentKey,
  type RouteScoreWeights,
} from "@/domain/route/policy";
import type { EvidenceStatus } from "@/domain/evidence/types";
import type { RideIntent, RoadCharacterIntent } from "@/domain/ride/types";
import type {
  RouteCandidate,
  RouteEvidence,
  ScoreComponent,
} from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";
import { unverifiedSurfaceMeters } from "@/application/roads/surface-evidence";
import { curvatureLabel, surfaceMixLabel } from "@/application/roads/engine-road-evidence";
import { namedRoadsSentence, verifiedGravelSentence } from "@/application/roads/known-roads";
import { formatDistance, isKnownMeasurement } from "./measurements";

/**
 * The smallest improvement on a normalized 0–1 component input worth a
 * sentence. It is deliberately *not* the role materiality margin
 * (`ROLE_MATERIALITY_VNEXT_1`): a role is a claim about which route to pick, so
 * it needs a wide margin, while a headline benefit only has to be a difference
 * the rider's line actually shows. Five points of the same normalized metric is
 * far above the float noise of two measurements of one line (`OGV-D-250`).
 */
export const EXPLANATION_MATERIALITY = 0.05;

/** How many benefits the headline names before it stops being a sentence. */
export const MAX_HEADLINE_BENEFITS = 2;

/** Floating-point tolerance on the materiality comparison (`OGV-D-203`). */
const MATERIALITY_EPSILON = 1e-9;

/** The character the rider did not state (`06 §6`), as scoring reads it. */
const NEUTRAL_CHARACTER: RoadCharacterIntent = "balanced";

/** One line of the explanation ledger. */
export interface ExplanationBullet {
  /** Stable key the surfaces and tests resolve copy by; never a sentence. */
  readonly key: string;
  readonly text: string;
  /** The status of the evidence the bullet is about (07 §2). */
  readonly evidenceStatus: EvidenceStatus;
}

/** The deterministic answer to "Why this ride?" (04 §13). */
export interface RouteExplanation {
  readonly headline: string;
  readonly bullets: readonly ExplanationBullet[];
}

export interface RouteExplanationInput {
  readonly candidate: RouteCandidate;
  /** The authored intent, read only for the rider's road-character weights. */
  readonly intent: RideIntent;
  readonly policy: RoutePolicy;
  /**
   * The same-constraint fastest reference and the added minutes it costs this
   * candidate (`06 §13`, `OGV-D-204`). `null` means there is no honest
   * comparison — a lone candidate, or unmeasurable durations — and the
   * explanation says so rather than comparing across constraint sets.
   */
  readonly fastest?: { readonly candidate: RouteCandidate; readonly addedMinutes: number } | null;
}

/** The axes that carry a fact bullet; `timeCost`/`confidence` are elsewhere. */
const FACT_AXES = [
  "curvature",
  "backroad",
  "surfaceFit",
  "elevation",
  "traffic",
  "junctionFriction",
  "novelty",
  "closureRisk",
] as const satisfies readonly RouteScoreComponentKey[];

type FactAxis = (typeof FACT_AXES)[number];

/** A measured axis, in the neutral phrasing that claims only the measurement. */
const MEASURED_FACTS: Readonly<Record<FactAxis, string>> = {
  curvature: "Curvature is measured for this route.",
  backroad: "Back-road character is measured for this route.",
  surfaceFit: "Surface match is measured for this route.",
  elevation: "Elevation variation is measured for this route.",
  traffic: "Traffic cost is measured for this route.",
  junctionFriction: "Junction friction is measured for this route.",
  novelty: "Novelty is measured for this route.",
  closureRisk: "Closure risk is measured for this route.",
};

/**
 * The two unknowns a rider must see. Traffic and closure are the axes whose
 * absence changes a decision (06 §12: "unavailable traffic is unknown, not
 * zero"; a hard closure is a gate), so they are stated. Every other unmeasured
 * axis is summarized by `component.confidence` instead of producing eight
 * bullets a rider would have to read past.
 */
const UNKNOWN_FACTS: Partial<Readonly<Record<FactAxis, string>>> = {
  traffic: "Traffic is unknown for this route, so no delay is claimed.",
  closureRisk: "Closure risk is unknown for this route.",
};

/**
 * The curvature reader is the only component whose provenance differs from the
 * rest in Wave 3: `scoreCandidate` substitutes a measured twistiness of the
 * returned line where road evidence does not exist yet (`OGV-D-191`). The
 * component's own `explanationKey` says which one happened (06 §10), so the
 * bullet never has to guess (compare the legacy `routeCharacterSummary`).
 */
const CURVATURE_GEOMETRY_PROXY_KEY = "score.curvature.smoothed-geometry-proxy";
const CURVATURE_GEOMETRY_PROXY =
  "Curvature is estimated from the returned route line, not from mapped road data.";

/** One improvement a candidate buys over the reference on a component input. */
interface BenefitSpec {
  readonly axis: FactAxis;
  /** A cost axis improves by going down; a quality axis by going up. */
  readonly lowerIsBetter: boolean;
  readonly phrase: string;
}

const BENEFITS: readonly BenefitSpec[] = [
  { axis: "curvature", lowerIsBetter: false, phrase: "a curvier line" },
  { axis: "backroad", lowerIsBetter: false, phrase: "more back-road character" },
  { axis: "surfaceFit", lowerIsBetter: false, phrase: "a closer surface match" },
  { axis: "elevation", lowerIsBetter: false, phrase: "more elevation change" },
  { axis: "traffic", lowerIsBetter: true, phrase: "lower traffic" },
  { axis: "junctionFriction", lowerIsBetter: true, phrase: "fewer junctions" },
  { axis: "novelty", lowerIsBetter: false, phrase: "more new-to-you road" },
  { axis: "closureRisk", lowerIsBetter: true, phrase: "a lower closure risk" },
];

function riderWeights(intent: RideIntent, policy: RoutePolicy): RouteScoreWeights {
  const character: RoadCharacterIntent | undefined = intent.roadCharacter;
  return policy.characterWeights[character ?? NEUTRAL_CHARACTER];
}

/**
 * The improvements this candidate measured over the fastest reference, ordered
 * by how much the rider's own road character cares about them (06 §6) and then
 * by the §19 component order, so the headline names what *this* rider bought.
 */
function benefitPhrases(
  candidate: RouteCandidate,
  fastest: RouteCandidate,
  weights: RouteScoreWeights,
): readonly string[] {
  const ranked: { readonly phrase: string; readonly weight: number; readonly order: number }[] = [];
  for (const [order, spec] of BENEFITS.entries()) {
    const mine = candidate.score.components[spec.axis].input;
    const reference = fastest.score.components[spec.axis].input;
    if (mine === null || reference === null) continue;
    const gain = spec.lowerIsBetter ? reference - mine : mine - reference;
    if (gain < EXPLANATION_MATERIALITY - MATERIALITY_EPSILON) continue;
    ranked.push({ phrase: spec.phrase, weight: weights[spec.axis], order });
  }
  ranked.sort((left, right) => right.weight - left.weight || left.order - right.order);
  return ranked.slice(0, MAX_HEADLINE_BENEFITS).map((entry) => entry.phrase);
}

/** The extra distance the candidate runs compared with the reference, or `null`. */
function extraDistanceMeters(
  candidateMeters: number,
  referenceMeters: number,
): number | null {
  if (!isKnownMeasurement(candidateMeters) || !isKnownMeasurement(referenceMeters)) {
    return null;
  }
  const delta = candidateMeters - referenceMeters;
  return delta > 0 ? delta : null;
}

function joinPhrases(phrases: readonly string[]): string {
  return phrases.length === 1 ? phrases[0] ?? "" : `${phrases[0]} and ${phrases[1]}`;
}

function headlineFor(
  input: RouteExplanationInput,
  weights: RouteScoreWeights,
): string {
  const fastest = input.fastest ?? null;
  if (fastest === null) return "No faster route to compare this ride against.";
  // Zero (or a nonsensical negative from a cross-constraint comparison) is not a
  // cost: the candidate is as fast as the reference, which is what it says.
  if (fastest.addedMinutes <= 0) return "Matches the fastest option in time.";

  const minutes = Math.round(fastest.addedMinutes);
  const extraMeters = extraDistanceMeters(
    input.candidate.distanceMeters,
    fastest.candidate.distanceMeters,
  );
  const distanceClause =
    extraMeters === null ? "" : ` and ${formatDistance(extraMeters)} more`;
  const phrases = benefitPhrases(input.candidate, fastest.candidate, weights);
  const benefitClause =
    phrases.length === 0 ? " over the fastest option" : ` for ${joinPhrases(phrases)}`;
  return `Adds ${minutes} minutes${distanceClause}${benefitClause}.`;
}

/** The declared-evidence coverage bullet: how much of §18 is actually known. */
function coverageBullet(component: ScoreComponent): ExplanationBullet {
  return {
    key: "component.confidence",
    text:
      component.input === null
        ? "No road-metric evidence is available for this route yet."
        : `Ride evidence covers ${Math.round(component.input * 100)}% of the tracked road metrics.`,
    evidenceStatus: component.evidenceStatus,
  };
}

/**
 * The surface bullet: how many of the route's miles have no verified surface.
 * The mileage comes from the surface evidence's own `coverage` share, never
 * from a guess, and an unmeasurable share is reported as unmeasured (07 §5).
 */
function surfaceBullet(
  evidence: RouteEvidence,
  distanceMeters: number,
): ExplanationBullet {
  const entry = evidence["surfaceMix"];
  const evidenceStatus: EvidenceStatus = entry === undefined ? "unknown" : entry.status;
  const unverifiedMeters = unverifiedSurfaceMeters(entry, distanceMeters);
  if (unverifiedMeters === null) {
    return {
      key: "surface.coverage",
      text: "How much of this route's surface is verified is not measured.",
      evidenceStatus,
    };
  }
  if (unverifiedMeters === 0) {
    return {
      key: "surface.coverage",
      text: "Surface evidence covers this route's full length.",
      evidenceStatus,
    };
  }
  return {
    key: "surface.coverage",
    text: `Surface is unverified on ${formatDistance(unverifiedMeters)} of this route.`,
    evidenceStatus,
  };
}

/**
 * The rider-worded fact an engine measurement supports (M3, OGV-D-263), or
 * `null` when the evidence is not an engine measurement and the neutral
 * "is measured" phrasing has to stand in.
 */
function engineFact(axis: FactAxis, evidence: RouteEvidence): string | null {
  switch (axis) {
    case "curvature": {
      const label = curvatureLabel(evidence["curvature"]);
      if (label === null) return null;
      return label === "Few curves"
        ? "Few curves: the road geometry is mostly straight."
        : `${label.replace(" of curves", "")} of this route is on curving road.`;
    }
    case "backroad": {
      const share = evidence["roadClassMix"]?.value;
      return typeof share === "number" && Number.isFinite(share)
        ? `${Math.round(share * 100)}% of this route is off highways and main roads.`
        : null;
    }
    case "surfaceFit": {
      const label = surfaceMixLabel(evidence["surfaceMix"]);
      return label === null ? null : `Surface: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
    }
    default:
      return null;
  }
}

/** The measured fact for one axis, with the one provenance special case. */
function measuredFact(axis: FactAxis, component: ScoreComponent, evidence: RouteEvidence): string {
  if (axis === "curvature" && component.explanationKey === CURVATURE_GEOMETRY_PROXY_KEY) {
    return CURVATURE_GEOMETRY_PROXY;
  }
  return engineFact(axis, evidence) ?? MEASURED_FACTS[axis];
}

/** One axis bullet, or `null` when the axis measured nothing and says nothing. */
function axisBullet(
  axis: FactAxis,
  component: ScoreComponent,
  evidence: RouteEvidence,
): ExplanationBullet | null {
  if (component.input !== null) {
    return {
      key: `component.${axis}`,
      text: measuredFact(axis, component, evidence),
      evidenceStatus: component.evidenceStatus,
    };
  }
  const unknown = UNKNOWN_FACTS[axis];
  return unknown === undefined
    ? null
    : {
        key: `component.${axis}`,
        text: unknown,
        evidenceStatus: component.evidenceStatus,
      };
}

/**
 * Builds the explanation. Pure, total and fail-closed: a policy the reader
 * cannot trust throws (as `scoreCandidate` does) rather than producing
 * plausible copy from a policy nobody versioned, and every other input —
 * missing evidence, an unmeasurable distance, no reference — degrades to an
 * explicit unknown.
 */
export function buildRouteExplanation(input: RouteExplanationInput): RouteExplanation {
  if (!isRoutePolicy(input.policy)) {
    throw new TypeError("Invalid route policy");
  }
  const weights = riderWeights(input.intent, input.policy);
  const components = input.candidate.score.components;
  const bullets: ExplanationBullet[] = [
    coverageBullet(components.confidence),
    surfaceBullet(input.candidate.evidence, input.candidate.distanceMeters),
  ];
  for (const axis of FACT_AXES) {
    const bullet = axisBullet(axis, components[axis], input.candidate.evidence);
    if (bullet !== null) bullets.push(bullet);
  }
  // The roads by name, and surveyed gravel: facts a rider recognizes (OGV-D-264).
  const evidence = input.candidate.evidence;
  const named = namedRoadsSentence(evidence["namedRoads"]);
  if (named !== null) {
    bullets.push({ key: "roads.named", text: named, evidenceStatus: evidence["namedRoads"]?.status ?? "estimated" });
  }
  const gravel = verifiedGravelSentence(evidence["verifiedGravel"]);
  if (gravel !== null) {
    bullets.push({ key: "surface.verified-gravel", text: gravel, evidenceStatus: evidence["verifiedGravel"]?.status ?? "known" });
  }
  return deepFreeze<RouteExplanation>({
    headline: headlineFor(input, weights),
    bullets,
  });
}
