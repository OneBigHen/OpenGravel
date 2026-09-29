import { describe, expect, it } from "vitest";

import {
  CORE_CAPABILITIES,
  advisorCapability,
  noKeyParity,
} from "@/application/advisor";

/**
 * No-AI parity (10 §2). With zero model keys every core operation still works
 * and the advisor is simply, honestly off. The one guarantee this substrate can
 * enforce is that a model key gates the advisor and nothing else: `core` is a
 * constant set of capabilities that is identical whether or not a model is
 * configured, so a key can only ever turn the advisor on.
 */
describe("advisor no-key parity (10 §2)", () => {
  it("keeps every core capability available with zero model config", () => {
    const report = noKeyParity(false);
    expect(report.advisor.status).toBe("unavailable");
    expect(report.core).toHaveLength(CORE_CAPABILITIES.length);
    for (const entry of report.core) expect(entry.available).toBe(true);
  });

  it("names exactly the §2 core set and never gates it on model config", () => {
    expect([...CORE_CAPABILITIES]).toEqual([
      "planning",
      "route-editing",
      "route-explanation",
      "free-ride",
      "import-export",
    ]);
    // Core is byte-identical with and without a key: turning the advisor on can
    // never turn a core capability off.
    expect(noKeyParity(false).core).toEqual(noKeyParity(true).core);
  });

  it("reports an honest, key-free disabled state", () => {
    const capability = advisorCapability(false);
    expect(capability.status).toBe("unavailable");
    if (capability.status !== "unavailable") throw new Error("expected unavailable");
    expect(capability.message).toMatch(/not set up/i);
    // The disabled copy never names a vendor or a credential (VNX-007 / Rule E).
    expect(capability.message).not.toMatch(/deepseek|openrouter|gemini|openai|anthropic|api[ -]?key/i);
  });

  it("flips only the advisor to available when a model is configured", () => {
    expect(noKeyParity(true).advisor).toEqual({ status: "available" });
  });
});
