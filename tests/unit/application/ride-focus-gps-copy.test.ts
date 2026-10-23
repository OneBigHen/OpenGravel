/** Rider copy for a missing or old GPS fix says what is happening in plain words, never "stale". */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GPS wait copy", () => {
  const source = readFileSync("src/application/ride-session/ride-focus-view-model.ts", "utf8");
  it("never tells a rider their GPS is stale", () => {
    expect(source).not.toMatch(/GPS is stale/);
    expect(source).toContain("Waiting for a GPS fix…");
    expect(source).toContain("Weak GPS signal (");
  });
});
