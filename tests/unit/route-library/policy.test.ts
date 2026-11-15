import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSourcesPolicy, policyForSource } from "@/application/route-library/policy";

const POLICY_PATH = path.resolve(import.meta.dirname, "../../../scripts/route-library/sources-policy.json");
const policy = parseSourcesPolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8")));

const BASIS = "owner-confirmed permission from MotorcycleRoads.com 2026-11-14";

describe("the shipped sources policy", () => {
  it("parses and gives every listed source a mode and a basis", () => {
    expect(policy.sources["ridebdr.com"]?.mode).toBe("link");
    expect(Object.values(policy.sources).every((entry) => entry.basis.trim() !== "")).toBe(true);
  });

  it("hosts MotorcycleRoads.com under the owner-confirmed permission, not its page terms", () => {
    for (const name of ["MotorcycleRoads.com", "MotorcycleRoads"]) {
      expect(policyForSource(policy, name)).toMatchObject({ mode: "host", basis: BASIS });
    }
    // The name is matched after trimming and lowercasing, so the two spellings in the library both land here.
    expect(policyForSource(policy, " MotoRcycleRoads.com ")).toMatchObject({ mode: "host", basis: BASIS });
    expect(policyForSource(policy, "MOTORCYCLEROADS")).toMatchObject({ mode: "host", basis: BASIS });
  });

  it("leaves the Backcountry Discovery Routes as links", () => {
    for (const name of ["ridebdr.com", "Backcountry Discovery Routes", "Backcountry Discovery Routes (ridebdr.com)"]) {
      expect(policyForSource(policy, name).mode).toBe("link");
    }
  });

  it("does not let a lookalike source inherit the MotorcycleRoads permission", () => {
    // GreatMotorcycleRoads.com is a different site with its own terms; it falls back to the default basis.
    const lookalike = policyForSource(policy, "GreatMotorcycleRoads.com");
    expect(lookalike).toBe(policy.default);
    expect(lookalike.basis).not.toBe(BASIS);
  });
});
