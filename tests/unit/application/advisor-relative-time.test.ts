import { describe, expect, it } from "vitest";
import { relativeAdvisorTime } from "@/application/advisor/advisor-relative-time";

describe("relative advisor duration", () => {
  it.each([
    ["Make it 30 minutes shorter", 120, 90],
    ["30 mins longer", 90, 120],
    ["Please make this route 1 hour shorter.", 180, 120],
  ])("does the arithmetic for %s", (prompt, baseline, minutes) => {
    expect(relativeAdvisorTime(prompt, baseline)).toEqual({ kind: "budget", minutes });
  });
  it("asks for a usable duration instead of guessing or silently clamping", () => {
    expect(relativeAdvisorTime("Make it 30 minutes shorter", undefined)).toEqual({ kind: "clarification" });
    expect(relativeAdvisorTime("Make it 30 minutes shorter", 35)).toEqual({ kind: "clarification" });
    expect(relativeAdvisorTime("Make it 30 minutes longer", 1440)).toEqual({ kind: "clarification" });
    expect(relativeAdvisorTime("Make it shorter than last week's ride", 120)).toEqual({ kind: "none" });
  });
});
