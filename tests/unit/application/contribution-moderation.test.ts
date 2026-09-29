import { describe, expect, it } from "vitest";

import {
  CONTRIBUTION_MAX_PAYLOAD_BYTES,
  reporterIdentityFor,
  type ContributionAbuseLimits,
  type ContributionEnvelope,
  type ContributionModerationRecord,
} from "@/domain/contributions";
import {
  decideContribution,
  listPendingContributions,
  submitContributionForModeration,
  type ContributionModerationPort,
} from "@/application/contributions/moderation";

const NOW = "2026-09-17T12:00:00.000Z";
const CONTRIBUTOR = "123e4567-e89b-42d3-a456-426614174000";

class FakeModerationPort implements ContributionModerationPort {
  public readonly records: ContributionModerationRecord[] = [];
  private sequence = 0;

  public constructor(private readonly clock: () => string) {}

  public append(envelope: ContributionEnvelope): ContributionModerationRecord {
    const record: ContributionModerationRecord = {
      id: `contrib_fake_${this.sequence++}`,
      envelope,
      reporter: reporterIdentityFor(envelope),
      receivedAt: this.clock(),
      state: "pending",
      decidedAt: null,
    };
    this.records.push(record);
    return record;
  }

  public find(id: string): ContributionModerationRecord | null {
    return this.records.find((record) => record.id === id) ?? null;
  }

  public recordDecision(
    id: string,
    decision: "accept" | "reject",
  ): ContributionModerationRecord | null {
    const index = this.records.findIndex((record) => record.id === id);
    const previous = this.records[index];
    if (index < 0 || previous === undefined) return null;
    const updated: ContributionModerationRecord = {
      ...previous,
      state: decision === "accept" ? "accepted" : "rejected",
      decidedAt: this.clock(),
    };
    this.records[index] = updated;
    return updated;
  }

  public listPending(limit: number): readonly ContributionModerationRecord[] {
    return this.records.filter((record) => record.state === "pending").slice(0, Math.max(0, limit));
  }

  public pendingCount(): number {
    return this.records.filter((record) => record.state === "pending").length;
  }

  public pendingCountFor(pseudoId: string): number {
    return this.records.filter(
      (record) => record.state === "pending" && record.reporter.pseudoId === pseudoId,
    ).length;
  }

  public recentSubmissionCount(pseudoId: string, windowMs: number): number {
    const cutoff = new Date(Date.parse(this.clock()) - Math.max(0, Math.trunc(windowMs))).toISOString();
    return this.records.filter(
      (record) => record.reporter.pseudoId === pseudoId && record.receivedAt >= cutoff,
    ).length;
  }
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "surface",
    roadRef: { roadId: "road_main", spanId: "span_main" },
    observedAt: NOW,
    gps_precision_m: 12,
    value: "maintained-gravel",
    provenance: {
      contributorPseudoId: CONTRIBUTOR,
      clientVersion: "0.1.0",
      evidenceLevel: "high",
    },
    ...overrides,
  };
}

function paddedInput(byteLength: number): Record<string, unknown> {
  const fixed = contributionBytes(input({ padding: "" }));
  return input({ padding: "x".repeat(Math.max(0, byteLength - fixed)) });
}

function contributionBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

const STRICT_LIMITS: ContributionAbuseLimits = {
  queueMaxPending: 2,
  maxPendingPerReporter: 2,
  maxSubmissionsPerWindow: 2,
};

describe("contribution submission boundary", () => {
  it("stores a pending submission with bounded reporter identity and a stripped envelope", () => {
    const port = new FakeModerationPort(() => NOW);
    const result = submitContributionForModeration(port, input({ internalNote: "must not persist" }), { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submission).toEqual({
      id: expect.stringMatching(/^contrib_/),
      envelope: expect.objectContaining({ kind: "surface" }),
      reporter: { pseudoId: CONTRIBUTOR },
      receivedAt: NOW,
      state: "pending",
      decidedAt: null,
    });
    expect(Object.keys(result.submission.reporter)).toEqual(["pseudoId"]);
    expect("internalNote" in result.submission.envelope).toBe(false);
  });

  it("returns a typed validation failure and stores nothing for invalid input", () => {
    const port = new FakeModerationPort(() => NOW);
    const result = submitContributionForModeration(port, input({ roadRef: undefined }), { now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("validation");
    expect(port.records).toEqual([]);
  });

  it("accepts a payload exactly at the byte bound and strips its padding", () => {
    const port = new FakeModerationPort(() => NOW);
    const padded = paddedInput(CONTRIBUTION_MAX_PAYLOAD_BYTES);
    expect(contributionBytes(padded)).toBe(CONTRIBUTION_MAX_PAYLOAD_BYTES);

    const result = submitContributionForModeration(port, padded, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("padding" in result.submission.envelope).toBe(false);
  });

  it("refuses a payload over the byte bound with a typed failure", () => {
    const port = new FakeModerationPort(() => NOW);
    const oversized = input({ padding: "x".repeat(CONTRIBUTION_MAX_PAYLOAD_BYTES) });

    const result = submitContributionForModeration(port, oversized, { now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("payload-too-large");
    expect(port.records).toEqual([]);
  });

  it("refuses a submission that would overflow the bounded queue", () => {
    let clockMs = Date.parse(NOW);
    const port = new FakeModerationPort(() => new Date(clockMs).toISOString());
    for (let index = 0; index < STRICT_LIMITS.queueMaxPending; index++) {
      clockMs += 1;
      expect(submitContributionForModeration(port, input(), {
        now: new Date(clockMs).toISOString(),
        limits: { ...STRICT_LIMITS, maxSubmissionsPerWindow: 100 },
      }).ok).toBe(true);
    }

    clockMs += 1;
    const result = submitContributionForModeration(port, input(), {
      now: new Date(clockMs).toISOString(),
      limits: { ...STRICT_LIMITS, maxSubmissionsPerWindow: 100 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("queue-full");
  });

  it("refuses a submission that would exceed the reporter pending cap", () => {
    let clockMs = Date.parse(NOW);
    const port = new FakeModerationPort(() => new Date(clockMs).toISOString());
    const otherReporter = "223e4567-e89b-42d3-a456-426614174000";
    const limits: ContributionAbuseLimits = {
      queueMaxPending: 100,
      maxPendingPerReporter: STRICT_LIMITS.maxPendingPerReporter,
      maxSubmissionsPerWindow: 100,
    };
    for (let index = 0; index < limits.maxPendingPerReporter; index++) {
      clockMs += 1;
      expect(submitContributionForModeration(port, input(), {
        now: new Date(clockMs).toISOString(),
        limits,
      }).ok).toBe(true);
    }
    clockMs += 1;
    expect(submitContributionForModeration(port, input({
      provenance: { contributorPseudoId: otherReporter, clientVersion: "0.1.0", evidenceLevel: "low" },
    }), {
      now: new Date(clockMs).toISOString(),
      limits,
    }).ok).toBe(true);

    clockMs += 1;
    const result = submitContributionForModeration(port, input(), {
      now: new Date(clockMs).toISOString(),
      limits,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("reporter-pending-cap");
  });

  it("refuses a submission that would exceed the reporter rate bound", () => {
    let clockMs = Date.parse(NOW);
    const port = new FakeModerationPort(() => new Date(clockMs).toISOString());
    const limits: ContributionAbuseLimits = { ...STRICT_LIMITS, queueMaxPending: 100, maxPendingPerReporter: 100 };
    for (let index = 0; index < STRICT_LIMITS.maxSubmissionsPerWindow; index++) {
      clockMs += 1;
      expect(submitContributionForModeration(port, input(), {
        now: new Date(clockMs).toISOString(),
        limits,
      }).ok).toBe(true);
    }

    clockMs += 1;
    const result = submitContributionForModeration(port, input(), {
      now: new Date(clockMs).toISOString(),
      limits,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("reporter-rate-exceeded");
  });

  it("stops counting submissions once they leave the rate window", () => {
    let clockMs = Date.parse(NOW);
    const port = new FakeModerationPort(() => new Date(clockMs).toISOString());
    const limits: ContributionAbuseLimits = {
      queueMaxPending: 100,
      maxPendingPerReporter: 100,
      maxSubmissionsPerWindow: 1,
    };
    clockMs += 1;
    expect(submitContributionForModeration(port, input(), {
      now: new Date(clockMs).toISOString(),
      limits,
    }).ok).toBe(true);

    clockMs += 60 * 60 * 1000 + 1;
    const result = submitContributionForModeration(port, input(), {
      now: new Date(clockMs).toISOString(),
      limits,
    });

    expect(result.ok).toBe(true);
  });
});

describe("contribution moderation decisions", () => {
  it("accepts a pending contribution and stamps the server decision instant", () => {
    const port = new FakeModerationPort(() => NOW);
    const submitted = submitContributionForModeration(port, input(), { now: NOW });
    if (!submitted.ok) throw new Error("submission must succeed");

    const result = decideContribution(port, submitted.submission.id, "accept");

    expect(result).toEqual({
      ok: true,
      submission: expect.objectContaining({
        id: submitted.submission.id,
        state: "accepted",
        decidedAt: NOW,
      }),
    });
  });

  it("rejects a pending contribution and stamps the server decision instant", () => {
    const port = new FakeModerationPort(() => NOW);
    const submitted = submitContributionForModeration(port, input(), { now: NOW });
    if (!submitted.ok) throw new Error("submission must succeed");

    const result = decideContribution(port, submitted.submission.id, "reject");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submission.state).toBe("rejected");
    expect(result.submission.decidedAt).toBe(NOW);
  });

  it.each([
    ["accept then reject", "accept", "reject"],
    ["reject then accept", "reject", "accept"],
  ] as const)("refuses to reopen a terminal decision: %s", (_name, first, second) => {
    const port = new FakeModerationPort(() => NOW);
    const submitted = submitContributionForModeration(port, input(), { now: NOW });
    if (!submitted.ok) throw new Error("submission must succeed");
    decideContribution(port, submitted.submission.id, first);

    const result = decideContribution(port, submitted.submission.id, second);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("already-decided");
    expect(port.find(submitted.submission.id)?.state).toBe(first === "accept" ? "accepted" : "rejected");
  });

  it("refuses to reapply the same terminal decision", () => {
    const port = new FakeModerationPort(() => NOW);
    const submitted = submitContributionForModeration(port, input(), { now: NOW });
    if (!submitted.ok) throw new Error("submission must succeed");
    decideContribution(port, submitted.submission.id, "accept");

    const result = decideContribution(port, submitted.submission.id, "accept");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("already-decided");
  });

  it("returns a typed failure for an unknown contribution id", () => {
    const port = new FakeModerationPort(() => NOW);

    const result = decideContribution(port, "contrib_missing", "accept");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("unknown-contribution");
  });

  it("returns a typed failure for an unrecognized decision token", () => {
    const port = new FakeModerationPort(() => NOW);
    const submitted = submitContributionForModeration(port, input(), { now: NOW });
    if (!submitted.ok) throw new Error("submission must succeed");

    const result = decideContribution(port, submitted.submission.id, "maybe");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("invalid-decision");
  });
});

describe("contribution moderation queue", () => {
  it("lists only pending submissions and clamps the requested limit", () => {
    const port = new FakeModerationPort(() => NOW);
    for (let index = 0; index < 3; index++) {
      const submitted = submitContributionForModeration(port, input(), { now: NOW });
      if (!submitted.ok) throw new Error("submission must succeed");
      if (index < 2) decideContribution(port, submitted.submission.id, index === 0 ? "accept" : "reject");
    }

    const queue = listPendingContributions(port, 1_000);

    expect(queue.map((record) => record.state)).toEqual(["pending"]);
    expect(listPendingContributions(port, 1)).toHaveLength(1);
  });
});
