import { describe, expect, it } from "vitest";

import {
  ADVISOR_ERROR_CLASSES,
  advisorFailure,
  advisorRiderState,
} from "@/application/advisor";

/**
 * Error classes (10 §13) mapped to rider-safe states. Every class gets one
 * message and exactly one recovery affordance; a Retry appears only when a
 * later attempt can plausibly succeed, and a stale proposal offers Refresh
 * (10 §6) rather than a pointless Retry.
 */
describe("advisor error classes → rider-safe states (10 §13)", () => {
  it("covers every documented error class", () => {
    expect([...ADVISOR_ERROR_CLASSES]).toEqual([
      "unavailable",
      "timeout",
      "rate-limit",
      "invalid-request",
      "unsupported-action",
      "grounding-failed",
      "stale-revision",
    ]);
  });

  it("gives every class a sentence-case message with no provider or engine name", () => {
    for (const errorClass of ADVISOR_ERROR_CLASSES) {
      const state = advisorRiderState(errorClass);
      expect(state.errorClass).toBe(errorClass);
      expect(state.message.length).toBeGreaterThan(0);
      expect(state.message[0]).toBe(state.message[0]?.toUpperCase());
      expect(state.message).not.toMatch(
        /deepseek|openrouter|gemini|openai|anthropic|claude|gpt|llama|mistral/i,
      );
    }
  });

  it("offers Retry only when a later attempt can succeed", () => {
    for (const errorClass of ["unavailable", "timeout", "rate-limit", "grounding-failed"] as const) {
      expect(advisorRiderState(errorClass).recovery).toBe("retry");
    }
  });

  it("offers Refresh for a stale revision and nothing for a hard rejection", () => {
    expect(advisorRiderState("stale-revision").recovery).toBe("refresh");
    for (const errorClass of ["invalid-request", "unsupported-action"] as const) {
      expect(advisorRiderState(errorClass).recovery).toBe("none");
    }
  });

  it("builds a transport failure that mirrors the rider state", () => {
    for (const errorClass of ADVISOR_ERROR_CLASSES) {
      const state = advisorRiderState(errorClass);
      expect(advisorFailure(errorClass)).toEqual({
        ok: false,
        errorClass,
        retryable: state.recovery === "retry",
        message: state.message,
      });
    }
  });
});
