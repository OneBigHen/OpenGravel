import { describe, expect, it } from "vitest";

import {
  CONTRIBUTION_ABUSE_LIMITS,
  CONTRIBUTION_MAX_PAYLOAD_BYTES,
  CONTRIBUTION_MAX_PENDING_PER_REPORTER,
  CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW,
  CONTRIBUTION_MODERATION_QUEUE_LIST_MAX,
  CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING,
  CONTRIBUTION_RATE_WINDOW_MS,
  applyModerationDecision,
  checkContributionAbuseBounds,
  contributionPayloadBytes,
  parseContribution,
  reporterIdentityFor,
  type ContributionAbuseCounts,
  type ContributionEnvelope,
} from "@/domain/contributions";

const NOW = "2026-09-17T12:00:00.000Z";
const CONTRIBUTOR = "123e4567-e89b-42d3-a456-426614174000";

function envelope(): ContributionEnvelope {
  const parsed = parseContribution({
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
  }, { now: NOW });
  if (!parsed.ok) throw new Error("fixture envelope must be valid");
  return parsed.value;
}

const CLEAR: ContributionAbuseCounts = {
  queuePending: 0,
  reporterPending: 0,
  reporterRecentSubmissions: 0,
};

describe("contribution moderation state machine", () => {
  it("moves a pending contribution to accepted on accept", () => {
    expect(applyModerationDecision("pending", "accept")).toEqual({
      ok: true,
      decision: "accept",
      state: "accepted",
    });
  });

  it("moves a pending contribution to rejected on reject", () => {
    expect(applyModerationDecision("pending", "reject")).toEqual({
      ok: true,
      decision: "reject",
      state: "rejected",
    });
  });

  it.each([
    ["accepted then reject", "accepted", "reject"],
    ["accepted then accept again", "accepted", "accept"],
    ["rejected then accept", "rejected", "accept"],
    ["rejected then reject again", "rejected", "reject"],
  ] as const)("refuses to reopen a terminal decision: %s", (_name, state, decision) => {
    const result = applyModerationDecision(state, decision);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("already-decided");
  });

  it.each([
    ["a state name mistaken for a decision", "accepted"],
    ["a made-up token", "maybe"],
    ["an empty token", ""],
    ["a non-string token", 42],
    ["a missing token", null],
  ] as const)("rejects %s as a decision", (_name, decision) => {
    const result = applyModerationDecision("pending", decision);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("invalid-decision");
  });

  it.each([
    ["a workflow flag", "flagged"],
    ["an archival label", "archived"],
    ["an empty state", ""],
    ["a missing state", null],
  ] as const)("refuses to decide on %s", (_name, state) => {
    const result = applyModerationDecision(state, "accept");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("unknown-state");
  });
});

describe("contribution abuse bounds", () => {
  it("keeps submissions inside every bound", () => {
    expect(checkContributionAbuseBounds({
      queuePending: CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING - 1,
      reporterPending: CONTRIBUTION_MAX_PENDING_PER_REPORTER - 1,
      reporterRecentSubmissions: CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW - 1,
    })).toBeNull();
    expect(checkContributionAbuseBounds(CLEAR)).toBeNull();
  });

  it.each([
    [
      "a full queue",
      { ...CLEAR, queuePending: CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING },
      "queue-full",
    ],
    [
      "a reporter pending cap",
      { ...CLEAR, reporterPending: CONTRIBUTION_MAX_PENDING_PER_REPORTER },
      "reporter-pending-cap",
    ],
    [
      "a reporter rate bound",
      { ...CLEAR, reporterRecentSubmissions: CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW },
      "reporter-rate-exceeded",
    ],
  ] as const)("refuses a submission at %s", (_name, counts, code) => {
    const failure = checkContributionAbuseBounds(counts);

    expect(failure).toEqual(expect.objectContaining({ code }));
  });

  it("reports the queue bound first when several bounds are exceeded at once", () => {
    const failure = checkContributionAbuseBounds({
      queuePending: CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING,
      reporterPending: CONTRIBUTION_MAX_PENDING_PER_REPORTER,
      reporterRecentSubmissions: CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW,
    });

    expect(failure?.code).toBe("queue-full");
  });

  it("honors explicitly configured limits", () => {
    const limits = {
      queueMaxPending: 2,
      maxPendingPerReporter: 1,
      maxSubmissionsPerWindow: 1,
    };

    expect(checkContributionAbuseBounds({ ...CLEAR, queuePending: 1 }, limits)).toBeNull();
    expect(checkContributionAbuseBounds({ ...CLEAR, queuePending: 2 }, limits)?.code).toBe("queue-full");
    expect(checkContributionAbuseBounds({ ...CLEAR, reporterPending: 1 }, limits)?.code).toBe("reporter-pending-cap");
    expect(checkContributionAbuseBounds({ ...CLEAR, reporterRecentSubmissions: 1 }, limits)?.code).toBe("reporter-rate-exceeded");
  });

  it("pins the published moderation abuse policy", () => {
    expect(CONTRIBUTION_ABUSE_LIMITS).toEqual({
      queueMaxPending: CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING,
      maxPendingPerReporter: CONTRIBUTION_MAX_PENDING_PER_REPORTER,
      maxSubmissionsPerWindow: CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW,
    });
    expect(CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING).toBe(250);
    expect(CONTRIBUTION_MODERATION_QUEUE_LIST_MAX).toBe(100);
    expect(CONTRIBUTION_MAX_PENDING_PER_REPORTER).toBe(15);
    expect(CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW).toBe(30);
    expect(CONTRIBUTION_RATE_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(CONTRIBUTION_MAX_PAYLOAD_BYTES).toBe(8 * 1024);
  });
});

describe("contribution payload bound", () => {
  it("measures the serialized payload in bytes", () => {
    expect(contributionPayloadBytes("abc")).toBe(5);
    expect(contributionPayloadBytes("é")).toBe(4);
  });

  it("measures a validated envelope as a bounded payload", () => {
    expect(contributionPayloadBytes(envelope())).toBeLessThan(CONTRIBUTION_MAX_PAYLOAD_BYTES);
  });
});

describe("reporter identity", () => {
  it("exposes only the bounded pseudonymous id", () => {
    const identity = reporterIdentityFor(envelope());

    expect(identity).toEqual({ pseudoId: CONTRIBUTOR });
    expect(Object.keys(identity)).toEqual(["pseudoId"]);
  });

  it("never invents identity beyond the validated provenance pseudonym", () => {
    const identity = reporterIdentityFor(envelope()) as unknown as Record<string, unknown>;

    expect(identity.email).toBeUndefined();
    expect(identity.accountId).toBeUndefined();
    expect(identity.displayName).toBeUndefined();
  });
});
