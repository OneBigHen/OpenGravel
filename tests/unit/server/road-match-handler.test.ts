/**
 * The `/api/road-match` handler (23-API-CONTRACTS §3, §14–§15).
 *
 * The handler's contract is small and exact: map the service's outcome onto a
 * status, always with `private, no-store`, and never leak a raw failure. These
 * tests drive the injectable match seam so no transport is involved.
 */

import { describe, expect, it } from "vitest";

import {
  handleRoadMatchRequest,
  httpStatusForMatchErrorCode,
  ROAD_MATCH_RESPONSE_HEADERS,
} from "@/server/road-matching/match-handler";
import type { RoadMatchResult } from "@/server/road-matching/match-service";
import { unknownEvidence } from "@/domain/evidence/types";

const SUCCESS: RoadMatchResult = {
  ok: true,
  match: {
    matchedGeometry: [
      { lon: -75.44, lat: 40.14 },
      { lon: -75.43, lat: 40.14 },
    ],
    distanceMeters: 850,
    durationSeconds: 70,
    maxDriftMeters: 2.5,
    confidence: "exact",
    accessEvidence: unknownEvidence("The router did not report motorcycle access."),
  },
};

describe("handleRoadMatchRequest", () => {
  it("answers 200 with the flat match body and private, no-store", async () => {
    const result = await handleRoadMatchRequest(
      { anchors: [{ lon: -75.44, lat: 40.14 }, { lon: -75.43, lat: 40.14 }] },
      { match: async () => SUCCESS },
    );
    expect(result.status).toBe(200);
    expect(result.headers).toEqual(ROAD_MATCH_RESPONSE_HEADERS);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.body).toMatchObject({
      distanceMeters: 850,
      durationSeconds: 70,
      maxDriftMeters: 2.5,
      confidence: "exact",
    });
    const body = result.body as { readonly accessEvidence: { readonly status: string } };
    expect(body.accessEvidence.status).toBe("unknown");
  });

  it("maps every error code onto the documented status", async () => {
    expect(httpStatusForMatchErrorCode("validation")).toBe(400);
    expect(httpStatusForMatchErrorCode("no-match")).toBe(422);
    expect(httpStatusForMatchErrorCode("no-route")).toBe(422);
    expect(httpStatusForMatchErrorCode("outside-coverage")).toBe(422);
    expect(httpStatusForMatchErrorCode("provider-timeout")).toBe(504);
    expect(httpStatusForMatchErrorCode("provider-unavailable")).toBe(502);
    expect(httpStatusForMatchErrorCode("cancelled")).toBe(499);
    expect(httpStatusForMatchErrorCode("something-new")).toBe(500);
  });

  it("forwards a service failure as the §3 error object with its status", async () => {
    const result = await handleRoadMatchRequest(
      { anchors: [] },
      {
        match: async () => ({
          ok: false,
          error: {
            code: "validation",
            message: "Road matching needs between two and eight valid points.",
            recoverable: false,
          },
        }),
      },
    );
    expect(result.status).toBe(400);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.body).toEqual({
      error: {
        code: "validation",
        message: "Road matching needs between two and eight valid points.",
        recoverable: false,
      },
    });
  });

  it("turns a thrown match call into a bounded outage, never a leaked stack", async () => {
    const result = await handleRoadMatchRequest(
      { anchors: [] },
      {
        match: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1:8989");
        },
      },
    );
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain("8989");
  });

  it("relays the caller's abort signal to the match seam", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await handleRoadMatchRequest({ anchors: [] }, {
      match: async (_input, deps) => {
        seen = deps.signal;
        return SUCCESS;
      },
    }, controller.signal);
    expect(seen).toBe(controller.signal);
  });
});
