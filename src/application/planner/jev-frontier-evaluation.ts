/** Blinded held-out scoring. Baseline agreement is deliberately kept in diagnostics. */
import {
  isExactReplayObject,
  isReplayKey,
  isReplayObject,
  type JevReplayRecord,
} from "./jev-frontier-replay";

export type JevEvaluationVariant = "A" | "B" | "C" | "D";
export interface JevReplayLabel {
  readonly caseId: string;
  readonly corridorKey: string;
  readonly rideSessionKey: string;
  readonly riderKey: string;
  readonly phase: "pre-ride" | "post-ride";
  readonly partition: "calibration" | "test";
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly preferredCandidateId: string | null;
  readonly pair: {
    readonly leftId: string;
    readonly rightId: string;
    readonly preferredId: string;
  } | null;
  readonly meaningfulImprovement: boolean | null;
}
interface Prediction {
  readonly label: JevReplayLabel;
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly selected: string | null;
  readonly topChoice: string | null;
  readonly noul: number | null;
}
export interface ReliabilityBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  readonly meanProbability: number | null;
  readonly observedFrequency: number | null;
}
export interface JevEvaluationMetrics {
  readonly labelCount: number;
  readonly scoredCount: number;
  readonly predictionCoverage: number;
  readonly topChoiceAccuracy: number | null;
  readonly logLoss: number | null;
  readonly brierScore: number | null;
  readonly ece: number | null;
  readonly reliability: readonly ReliabilityBin[];
  readonly coverage: number;
  readonly abstentionCoverage: number;
  readonly selectiveAccuracy: number | null;
  readonly noulLabelCount: number;
  readonly noulBrierScore: number | null;
  readonly noulLogLoss: number | null;
  readonly noulEce: number | null;
  readonly noulReliability: readonly ReliabilityBin[];
}
const VARIANTS = ["A", "B", "C", "D"] as const;
const CLIP = 1e-15;
function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((s, v) => s + v, 0) / values.length;
}
function target(label: JevReplayLabel): string {
  return label.preferredCandidateId ?? label.pair!.preferredId;
}
function loss(p: Readonly<Record<string, number>>, label: JevReplayLabel) {
  const id = target(label);
  return {
    logLoss: -Math.log(Math.max(CLIP, Math.min(1, p[id]!))),
    brierScore: Object.entries(p).reduce(
      (s, [k, v]) => s + (v - Number(k === id)) ** 2,
      0,
    ),
  };
}
function uniqueMaximum(p: Readonly<Record<string, number>>): string | null {
  const max = Math.max(...Object.values(p));
  const winners = Object.keys(p).filter((k) => Math.abs(p[k]! - max) < 1e-9);
  return winners.length === 1 ? winners[0]! : null;
}
function calibration(
  events: readonly { probability: number; correct: number }[],
) {
  const bins = Array.from({ length: 10 }, (_, index) => {
    const rows = events.filter(
      (e) => Math.min(9, Math.floor(e.probability * 10)) === index,
    );
    return {
      lower: index / 10,
      upper: (index + 1) / 10,
      count: rows.length,
      meanProbability: average(rows.map((e) => e.probability)),
      observedFrequency: average(rows.map((e) => e.correct)),
    };
  });
  return {
    bins,
    ece:
      events.length === 0
        ? null
        : bins.reduce(
            (s, b) =>
              s +
              (b.count / events.length) *
                Math.abs((b.meanProbability ?? 0) - (b.observedFrequency ?? 0)),
            0,
          ),
  };
}
function metrics(predictions: readonly Prediction[]): JevEvaluationMetrics {
  const scored = predictions.filter((p) => p.probabilities !== null);
  const losses = scored.map((p) => loss(p.probabilities!, p.label));
  const selective = predictions.filter((p) => p.selected !== null);
  const reliability = calibration(
    scored.map((p) => {
      const id = uniqueMaximum(p.probabilities!);
      return {
        probability: Math.max(...Object.values(p.probabilities!)),
        correct: Number(id === target(p.label)),
      };
    }),
  );
  const nouls = predictions.filter(
    (p) => p.noul !== null && p.label.meaningfulImprovement !== null,
  );
  const noulCalibration = calibration(
    nouls.map((p) => ({
      probability: p.noul!,
      correct: Number(p.label.meaningfulImprovement),
    })),
  );
  const coverage =
    predictions.length === 0 ? 0 : selective.length / predictions.length;
  return {
    labelCount: predictions.length,
    scoredCount: scored.length,
    predictionCoverage:
      predictions.length === 0 ? 0 : scored.length / predictions.length,
    topChoiceAccuracy: average(
      scored.map((p) => Number(p.topChoice === target(p.label))),
    ),
    logLoss: average(losses.map((l) => l.logLoss)),
    brierScore: average(losses.map((l) => l.brierScore)),
    ece: reliability.ece,
    reliability: reliability.bins,
    coverage,
    abstentionCoverage: 1 - coverage,
    selectiveAccuracy: average(
      selective.map((p) => Number(p.selected === target(p.label))),
    ),
    noulLabelCount: nouls.length,
    noulBrierScore: average(
      nouls.map((p) => (p.noul! - Number(p.label.meaningfulImprovement)) ** 2),
    ),
    noulLogLoss: average(
      nouls.map(
        (p) =>
          -Math.log(
            Math.max(
              CLIP,
              p.label.meaningfulImprovement ? p.noul! : 1 - p.noul!,
            ),
          ),
      ),
    ),
    noulEce: noulCalibration.ece,
    noulReliability: noulCalibration.bins,
  };
}
export function validateJevReplayLabels(
  v: unknown,
): v is readonly JevReplayLabel[] {
  if (!Array.isArray(v)) return false;
  return v.every((l) => {
    if (
      !isExactReplayObject(l, [
        "caseId",
        "corridorKey",
        "rideSessionKey",
        "riderKey",
        "phase",
        "partition",
        "fingerprints",
        "preferredCandidateId",
        "pair",
        "meaningfulImprovement",
      ]) ||
      ![l.caseId, l.corridorKey, l.rideSessionKey, l.riderKey].every(
        isReplayKey,
      ) ||
      !["pre-ride", "post-ride"].includes(String(l.phase)) ||
      !["calibration", "test"].includes(String(l.partition)) ||
      !isReplayObject(l.fingerprints) ||
      !Object.keys(l.fingerprints).every(isReplayKey) ||
      !Object.values(l.fingerprints).every(isReplayKey) ||
      (l.meaningfulImprovement !== null &&
        typeof l.meaningfulImprovement !== "boolean")
    )
      return false;
    if (l.pair === null)
      return (
        isReplayKey(l.preferredCandidateId) &&
        Object.hasOwn(l.fingerprints, l.preferredCandidateId)
      );
    if (
      l.preferredCandidateId !== null ||
      !isExactReplayObject(l.pair, ["leftId", "rightId", "preferredId"]) ||
      ![l.pair.leftId, l.pair.rightId, l.pair.preferredId].every(isReplayKey)
    )
      return false;
    return (
      l.pair.leftId !== l.pair.rightId &&
      [l.pair.leftId, l.pair.rightId].includes(l.pair.preferredId) &&
      Object.hasOwn(l.fingerprints, l.pair.leftId as string) &&
      Object.hasOwn(l.fingerprints, l.pair.rightId as string)
    );
  });
}
function prediction(
  record: JevReplayRecord,
  label: JevReplayLabel,
  variant: JevEvaluationVariant,
): Prediction {
  const v = variant === "D" ? null : record.variants[variant];
  let probabilities =
    v === null
      ? record.control.probabilitiesByCandidateId
      : v.probabilitiesByCandidateId === null
        ? null
        : { ...v.probabilitiesByCandidateId, NONE: v.noneProbability! };
  let selected =
    v === null ? record.control.choiceCandidateId : v.choiceCandidateId;
  // Audit verdicts, never argmax of conflicting average probabilities, establish top Choice.
  const stableAudits = v?.audits.filter((a) => a !== null) ?? [];
  let topChoice =
    v === null
      ? selected
      : stableAudits.length === v.audits.length &&
          stableAudits.every(
            (a) =>
              !a.orderDependent &&
              a.stableChoiceCandidateId ===
                stableAudits[0]!.stableChoiceCandidateId,
          )
        ? (stableAudits[0]?.stableChoiceCandidateId ?? null)
        : null;
  if (label.pair !== null) {
    const { leftId, rightId } = label.pair;
    if (probabilities !== null) {
      const total = probabilities[leftId]! + probabilities[rightId]!;
      probabilities =
        total > 0
          ? {
              [leftId]: probabilities[leftId]! / total,
              [rightId]: probabilities[rightId]! / total,
            }
          : null;
    }
    // Pairwise labels cannot certify a selected excluded candidate or an order-biased result.
    if (selected !== leftId && selected !== rightId) selected = null;
    if (topChoice !== leftId && topChoice !== rightId) topChoice = null;
  }
  return {
    label,
    probabilities,
    selected,
    topChoice,
    noul: v?.meaningfulImprovementProbability ?? null,
  };
}
function section(
  records: ReadonlyMap<string, JevReplayRecord>,
  labels: readonly JevReplayLabel[],
) {
  const predictions = Object.fromEntries(
    VARIANTS.map((v) => [
      v,
      labels.map((l) => prediction(records.get(l.caseId)!, l, v)),
    ]),
  ) as Record<JevEvaluationVariant, Prediction[]>;
  const pooled = Object.fromEntries(
    VARIANTS.map((v) => [v, metrics(predictions[v])]),
  ) as Record<JevEvaluationVariant, JevEvaluationMetrics>;
  const riderKeys = [...new Set(labels.map((l) => l.riderKey))].sort();
  const byRider = Object.fromEntries(
    riderKeys.map((r) => [
      r,
      Object.fromEntries(
        VARIANTS.map((v) => [
          v,
          metrics(predictions[v].filter((p) => p.label.riderKey === r)),
        ]),
      ),
    ]),
  ) as Record<string, Record<JevEvaluationVariant, JevEvaluationMetrics>>;
  const incrementalAgainstD = Object.fromEntries(
    ["A", "B", "C"].map((v) => {
      const treatment = predictions[v as JevEvaluationVariant];
      const pairs = treatment.flatMap((p, i) =>
        p.probabilities !== null && predictions.D[i]!.probabilities !== null
          ? [{ p, d: predictions.D[i]! }]
          : [],
      );
      return [
        v,
        {
          pairedCount: pairs.length,
          logLossDelta: average(
            pairs.map(
              ({ p, d }) =>
                loss(p.probabilities!, p.label).logLoss -
                loss(d.probabilities!, d.label).logLoss,
            ),
          ),
          brierDelta: average(
            pairs.map(
              ({ p, d }) =>
                loss(p.probabilities!, p.label).brierScore -
                loss(d.probabilities!, d.label).brierScore,
            ),
          ),
          accuracyDelta: average(
            pairs.map(
              ({ p, d }) =>
                Number(p.topChoice === target(p.label)) -
                Number(d.topChoice === target(d.label)),
            ),
          ),
        },
      ];
    }),
  ) as Record<
    "A" | "B" | "C",
    {
      pairedCount: number;
      logLossDelta: number | null;
      brierDelta: number | null;
      accuracyDelta: number | null;
    }
  >;
  // Flag leakage only when C has greater baseline agreement and no improvement over both B and D on the SAME labeled sets.
  const paired = labels
    .map((_, i) => ({
      b: predictions.B[i]!,
      c: predictions.C[i]!,
      d: predictions.D[i]!,
    }))
    .filter(
      (p) =>
        p.b.probabilities !== null &&
        p.c.probabilities !== null &&
        p.d.probabilities !== null,
    );
  const agreementDelta = average(
    paired.map(({ b, c }) => {
      const baseline = records.get(b.label.caseId)!.deterministicBaselineId;
      return (
        Number(c.topChoice === baseline) - Number(b.topChoice === baseline)
      );
    }),
  );
  const noGain = (other: "b" | "d") =>
    (average(
      paired.map(
        (p) =>
          loss(p.c.probabilities!, p.c.label).logLoss -
          loss(p[other].probabilities!, p[other].label).logLoss,
      ),
    ) ?? -1) >= 0 &&
    (average(
      paired.map(
        (p) =>
          loss(p.c.probabilities!, p.c.label).brierScore -
          loss(p[other].probabilities!, p[other].label).brierScore,
      ),
    ) ?? -1) >= 0 &&
    (average(
      paired.map(
        (p) =>
          Number(p.c.topChoice === target(p.c.label)) -
          Number(p[other].topChoice === target(p[other].label)),
      ),
    ) ?? 1) <= 0;
  return {
    pooled,
    byRider,
    incrementalAgainstD,
    leakageDiagnostic: {
      pairedCount: paired.length,
      status:
        paired.length === 0
          ? "unavailable"
          : (agreementDelta ?? 0) > 0 && noGain("b") && noGain("d")
            ? "baseline-leakage"
            : "not-established",
    },
  };
}

export function evaluateJevFrontierReplay(
  records: readonly JevReplayRecord[],
  labels: readonly JevReplayLabel[],
) {
  if (!validateJevReplayLabels(labels)) throw Error("Invalid blinded labels");
  const byCase = new Map(records.map((r) => [r.caseId, r]));
  if (byCase.size !== records.length) throw Error("Duplicate replay case");
  const corridors = new Map<string, string>(),
    sessions = new Map<string, string>(),
    duplicateLabels = new Set<string>();
  for (const label of labels) {
    const record = byCase.get(label.caseId);
    if (
      record === undefined ||
      record.corridorKey !== label.corridorKey ||
      record.rideSessionKey !== label.rideSessionKey
    )
      throw Error("Label case/corridor/session mismatch");
    const fingerprints = Object.fromEntries(
      record.candidates.map((c) => [c.id, c.fingerprint]),
    );
    if (
      Object.keys(label.fingerprints).length !== record.candidates.length ||
      Object.entries(fingerprints).some(
        ([id, fp]) => label.fingerprints[id] !== fp,
      )
    )
      throw Error("Label fingerprint mismatch");
    const observation = [
      label.caseId,
      label.riderKey,
      label.phase,
      label.pair === null
        ? "top"
        : [label.pair.leftId, label.pair.rightId].sort().join(":"),
    ].join("|");
    if (duplicateLabels.has(observation))
      throw Error("Duplicate blinded label");
    duplicateLabels.add(observation);
    for (const [map, key] of [
      [corridors, label.corridorKey],
      [sessions, label.rideSessionKey],
    ] as const) {
      if (map.has(key) && map.get(key) !== label.partition)
        throw Error("Corridor/ride-session partition leakage");
      map.set(key, label.partition);
    }
  }
  const partitions: Record<
    "test" | "calibration",
    Partial<Record<"pre-ride" | "post-ride", ReturnType<typeof section>>>
  > = { test: {}, calibration: {} };
  for (const partition of ["test", "calibration"] as const)
    for (const phase of ["pre-ride", "post-ride"] as const) {
      const subset = labels.filter(
        (l) => l.partition === partition && l.phase === phase,
      );
      if (subset.length > 0)
        partitions[partition][phase] = section(byCase, subset);
    }
  const diagnostics = Object.fromEntries(
    ["A", "B", "C"].map((variant) => {
      const variants = records.map(
        (r) => r.variants[variant as "A" | "B" | "C"],
      );
      const runs = variants.flatMap((v) => v.runs);
      const valid = runs.filter((r) => r.result.status === "ok");
      const latency = runs.map((r) => r.result.latencyMs).sort((a, b) => a - b);
      const percentile = (p: number) =>
        latency.length === 0
          ? null
          : latency[
              Math.min(latency.length - 1, Math.ceil(p * latency.length) - 1)
            ]!;
      return [
        variant,
        {
          caseCount: records.length,
          requestCount: runs.length,
          failedOrInvalidRate:
            runs.length === 0
              ? null
              : runs.filter(
                  (r) =>
                    r.result.status === "failed" ||
                    r.result.status === "invalid",
                ).length / runs.length,
          skippedCount: runs.filter((r) => r.result.status === "skipped")
            .length,
          baselineAgreement: average(
            records.flatMap((r) => {
              const v = r.variants[variant as "A" | "B" | "C"];
              return v.audits.flatMap((a) =>
                a !== null && !a.orderDependent
                  ? [
                      Number(
                        a.stableChoiceCandidateId === r.deterministicBaselineId,
                      ),
                    ]
                  : [],
              );
            }),
          ),
          orderFlipRate: average(
            variants.flatMap((v) =>
              v.audits.flatMap((a) => (a === null ? [] : [a.flipRate])),
            ),
          ),
          repeatedRequestStability: average(
            variants.flatMap((v) =>
              v.repeatedRequestStability === null
                ? []
                : [v.repeatedRequestStability],
            ),
          ),
          latencyP50Ms: percentile(0.5),
          latencyP95Ms: percentile(0.95),
          reportedCost:
            valid.length === 0 ||
            valid.some(
              (r) => r.result.status !== "ok" || r.result.usage?.cost == null,
            )
              ? null
              : valid.reduce(
                  (s, r) =>
                    s + (r.result.status === "ok" ? r.result.usage!.cost! : 0),
                  0,
                ),
        },
      ];
    }),
  ) as Record<
    "A" | "B" | "C",
    {
      caseCount: number;
      requestCount: number;
      failedOrInvalidRate: number | null;
      skippedCount: number;
      baselineAgreement: number | null;
      orderFlipRate: number | null;
      repeatedRequestStability: number | null;
      latencyP50Ms: number | null;
      latencyP95Ms: number | null;
      reportedCost: number | null;
    }
  >;
  return {
    schemaVersion: 1,
    labelCount: labels.length,
    riderCount: new Set(labels.map((l) => l.riderKey)).size,
    promotionReady: false,
    logLossClip: CLIP,
    calibration: partitions.calibration,
    test: partitions.test,
    diagnostics,
  };
}
