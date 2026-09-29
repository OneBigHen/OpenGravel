import { describe, expect, it, vi } from "vitest";

import {
  ContributionSubmissionError,
  runContributionDevSmoke,
  submitContribution,
} from "@/application/contributions/client";
import { parseContribution, type ContributionEnvelope } from "@/domain/contributions";

const envelopeResult = parseContribution({
  kind: "gate",
  roadRef: { roadId: "road_main", spanId: "span_main" },
  observedAt: "2026-09-17T12:00:00.000Z",
  gps_precision_m: 10,
  value: "open",
  provenance: {
    contributorPseudoId: "123e4567-e89b-42d3-a456-426614174000",
    clientVersion: "0.1.0",
    evidenceLevel: "medium",
  },
}, { now: "2026-09-17T12:00:00.000Z" });

if (!envelopeResult.ok) throw new Error("test envelope should be valid");
const ENVELOPE: ContributionEnvelope = envelopeResult.value;

describe("contribution client", () => {
  it("posts a validated envelope and returns the server id", async () => {
    let seen: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init;
      return Response.json({ id: "contrib_test", contribution: ENVELOPE, receivedAt: "2026-09-17T12:00:01.000Z" }, { status: 201 });
    });

    const result = await submitContribution(ENVELOPE, { fetcher });

    expect(result.id).toBe("contrib_test");
    expect(fetcher).toHaveBeenCalledWith("/api/contributions", expect.objectContaining({ method: "POST" }));
    expect(seen?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(seen?.body as string)).toEqual(ENVELOPE);
  });

  it("surfaces typed server rejection without exposing a raw provider error", async () => {
    const fetcher = vi.fn(async () => Response.json({
      error: { code: "validation", message: "The contribution was rejected." },
    }, { status: 400 }));

    await expect(submitContribution(ENVELOPE, { fetcher })).rejects.toBeInstanceOf(ContributionSubmissionError);
    await expect(submitContribution(ENVELOPE, { fetcher })).rejects.toMatchObject({ status: 400 });
  });

  it("offers a dev-only smoke path and does not add a UI dependency", async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: "contrib_smoke",
      contribution: ENVELOPE,
      receivedAt: "2026-09-17T12:00:01.000Z",
    }, { status: 201 }));

    await expect(runContributionDevSmoke({ fetcher, now: "2026-09-17T12:00:00.000Z" })).resolves.toMatchObject({ id: "contrib_smoke" });
  });
});
