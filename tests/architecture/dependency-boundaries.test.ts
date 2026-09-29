import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  SRC_ROOT,
  countByRule,
  fixtureRoot,
  scanRoot,
  violationsForRule,
} from "./lib/harness";
import {
  RULE_IDS,
  advisorForbiddenReason,
  layerDirectionForbiddenReason,
  mapInfrastructureForbiddenReason,
} from "./lib/rules";

/**
 * Rule C (OGV-ARC-003) — map infrastructure cannot mutate ride state.
 * Rule D (OGV-ARC-008) — advisor infrastructure cannot mutate state or select
 * a route. Layer direction (02-ARCHITECTURE-CONTRACT §7) — application may
 * depend on domain, never the reverse.
 *
 * Every rule is asserted against the real `src/` tree and against fixture
 * trees with exact expected violation counts.
 */

const RULE_A = RULE_IDS.domainFrameworkFree;
const RULE_C = RULE_IDS.mapNoStateMutation;
const RULE_D = RULE_IDS.advisorNoStateMutation;
const LAYER_DIRECTION = RULE_IDS.layerDirection;

const DENIED_STATE_MODULE_SPECIFIERS = [
  "./stores/ride-document-store",
  "../../application/stores/ride-store",
  "@/application/planner-controller",
  "../plannerController",
  "./rideDocumentStore",
];

const ALLOWED_MAP_SPECIFIERS = [
  "./map-scene",
  "../routing/route-provider-port",
  "../../domain/ride-intent",
];

const ALLOWED_ADVISOR_SPECIFIERS = [
  "./ride-proposal",
  "../../domain/route-candidate",
  "../routing/route-provider-port",
];

const DENIED_ROUTE_SELECTION_SPECIFIERS = [
  "./route-selection/select-best-route",
  "../select-route",
  "@/application/routeSelection",
];

describe("Rule C — map infrastructure cannot mutate ride state (OGV-ARC-003)", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [RULE_C])).toEqual([]);
  });

  it.each(DENIED_STATE_MODULE_SPECIFIERS)(
    "rejects the store or controller module %s",
    (specifier) => {
      expect(mapInfrastructureForbiddenReason(specifier, `import x from "${specifier}";`)).not.toBeNull();
    },
  );

  it.each(ALLOWED_MAP_SPECIFIERS)("allows %s", (specifier) => {
    expect(
      mapInfrastructureForbiddenReason(specifier, `import x from "${specifier}";`),
    ).toBeNull();
  });

  it("rejects a store setter binding imported from a neutral path", () => {
    const reason = mapInfrastructureForbiddenReason(
      "../storage/ride-adapter",
      'import { setRideIntent } from "../storage/ride-adapter";',
    );

    expect(reason).toMatch(/ride-state setter/);
  });

  it("rejects a setter binding spread across a multiline declaration", () => {
    const declaration = [
      "import {",
      "  setRideIntent,",
      '} from "../../infrastructure/storage/ride-adapter";',
    ].join("\n");

    expect(
      mapInfrastructureForbiddenReason(
        "../../infrastructure/storage/ride-adapter",
        declaration,
      ),
    ).toMatch(/ride-state setter/);
    expect(
      advisorForbiddenReason(
        "../../infrastructure/storage/ride-adapter",
        declaration,
      ),
    ).toMatch(/ride-state setter/);
  });

  it.each(["applyCommand", "dispatchCommand"])(
    "rejects the generic mutation binding %s",
    (binding) => {
      expect(
        mapInfrastructureForbiddenReason(
          "../../application/ride-api",
          `import { ${binding} } from "../../application/ride-api";`,
        ),
      ).toMatch(/ride-state setter/);
      expect(
        advisorForbiddenReason(
          "../../application/ride-api",
          `import { ${binding} } from "../../application/ride-api";`,
        ),
      ).toMatch(/ride-state setter/);
    },
  );

  it("fails closed on unverifiable dynamic imports in map and advisor code", () => {
    expect(
      mapInfrastructureForbiddenReason("<dynamic>", 'await import(name);'),
    ).toMatch(/unverifiable-dynamic-import/);
    expect(
      advisorForbiddenReason("<dynamic>", 'await import(name);'),
    ).toMatch(/unverifiable-dynamic-import/);
  });

  it("flags the rule C fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("rule-c-map-store"), [RULE_C]);

    expect(countByRule(violations)).toEqual({ [RULE_C]: 4 });
    expect(violations.map((violation) => violation.specifier).sort()).toEqual([
      "../../application/planner-controller",
      "../../application/stores/ride-document-store",
      "../../infrastructure/storage/ride-adapter",
      "../../infrastructure/storage/ride-adapter",
    ]);
  });
});

describe("Rule D — advisor infrastructure cannot mutate or select (OGV-ARC-008)", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [RULE_D])).toEqual([]);
  });

  it.each([...DENIED_STATE_MODULE_SPECIFIERS, ...DENIED_ROUTE_SELECTION_SPECIFIERS])(
    "rejects %s",
    (specifier) => {
      expect(
        advisorForbiddenReason(specifier, `import x from "${specifier}";`),
      ).not.toBeNull();
    },
  );

  it.each(ALLOWED_ADVISOR_SPECIFIERS)("allows %s", (specifier) => {
    expect(
      advisorForbiddenReason(specifier, `import x from "${specifier}";`),
    ).toBeNull();
  });

  it("flags the rule D fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("rule-d-advisor-store"), [RULE_D]);

    expect(countByRule(violations)).toEqual({ [RULE_D]: 2 });
    expect(violations.map((violation) => violation.specifier).sort()).toEqual([
      "../../application/route-selection/select-best-route",
      "../../application/stores/route-document-store",
    ]);
  });
});

describe("Layer direction — domain never imports application", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [LAYER_DIRECTION])).toEqual([]);
  });

  it("rejects the application alias", () => {
    expect(
      layerDirectionForbiddenReason(
        SRC_ROOT,
        "@/application/planner-session",
        null,
      ),
    ).toMatch(/must not import application/);
  });

  it("rejects a resolved application import", () => {
    expect(
      layerDirectionForbiddenReason(
        SRC_ROOT,
        "../application/plan-route",
        path.join(SRC_ROOT, "application", "plan-route"),
      ),
    ).toMatch(/must not import application/);
  });

  it("flags the layer-direction fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("layer-direction"));

    // The same file is caught independently by the layer-direction rule and by
    // rule A's cross-layer check: two rules, one offending import.
    expect(countByRule(violations)).toEqual({
      [RULE_A]: 1,
      [LAYER_DIRECTION]: 1,
    });
    expect(
      violations.every(
        (violation) => violation.specifier === "../application/plan-route",
      ),
    ).toBe(true);
  });
});

describe("clean per-layer samples satisfy every boundary rule", () => {
  const CLEAN_ROOT = fixtureRoot("clean");

  it.each([RULE_C, RULE_D, LAYER_DIRECTION])(
    "accepts the clean fixture tree for %s",
    (ruleId) => {
      expect(scanRoot(CLEAN_ROOT, [ruleId])).toEqual([]);
    },
  );

  it("accepts the clean per-layer fixture tree for every rule", () => {
    expect(scanRoot(CLEAN_ROOT)).toEqual([]);
  });
});

describe("dependency fixtures stay non-vacuous", () => {
  const VIOLATING_FIXTURES: readonly { root: string; ruleId: string }[] = [
    { root: "rule-c-map-store", ruleId: RULE_C },
    { root: "rule-d-advisor-store", ruleId: RULE_D },
    { root: "layer-direction", ruleId: LAYER_DIRECTION },
  ];

  it.each(VIOLATING_FIXTURES)(
    "detects at least one deliberate violation for $ruleId in $root",
    ({ root, ruleId }) => {
      const violations = violationsForRule(scanRoot(fixtureRoot(root)), ruleId);

      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations.every((violation) => violation.ruleId === ruleId)).toBe(
        true,
      );
    },
  );
});
