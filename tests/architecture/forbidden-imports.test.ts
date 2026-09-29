import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REPO_ROOT,
  SRC_ROOT,
  countByRule,
  fixtureRoot,
  scanRoot,
  violationsForRule,
} from "./lib/harness";
import {
  DENIED_DOMAIN_IMPORT_PATTERNS,
  DENIED_UI_PROVIDER_SPECIFIER_PATTERN,
  RULE_IDS,
  domainForbiddenReason,
  providerUrlLiteralReason,
  routingForbiddenReason,
  uiForbiddenReason,
  uiInfrastructureForbiddenReason,
} from "./lib/rules";

/**
 * Rule A (OGV-ARC-004) — domain is framework-free; Rule B (OGV-ARC-002
 * partial) — UI never reaches providers; Rule E (OGV-ARC-008) — provider
 * adapters never import the decision UI.
 *
 * The real `src/` tree is asserted for every rule. Because the wave-0 tree is
 * still mostly empty, each rule is also proven against a deliberately
 * violating fixture tree, with exact expected violation counts, so a silently
 * broken scanner fails here instead of passing vacuously.
 */

const RULE_A = RULE_IDS.domainFrameworkFree;
const RULE_B = RULE_IDS.uiNoProviderImports;
const RULE_E = RULE_IDS.providerNoUiDecision;
const RULE_UI_INFRA = RULE_IDS.uiNoInfrastructure;

/* Denylist rows that cannot live in fixtures: importing an uninstalled
 * package would need `@ts-expect-error`, which becomes a hard TS2578 error
 * (or a latent time bomb) the moment the package resolves. The pure rule
 * predicate is exercised per package instead. */
const DENIED_DOMAIN_PACKAGES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "next",
  "next/link",
  "next/font",
  "zustand",
  "zustand/vanilla",
  "mapbox-gl",
  "maplibre-gl",
  "dexie",
  "posthog",
  "posthog-js",
];

const ALLOWED_DOMAIN_IMPORTS = [
  "./geometry-ref",
  "../ride/ids",
  "@/domain/ride/types",
  "zod",
  "date-fns",
  "reactivity-utils",
];

const DENIED_DOMAIN_LAYER_ESCAPES = [
  "@/ui/planner/PlannerWorkspace",
  "@/infrastructure/routing/graphhopper-adapter",
  "@/application/planner-session",
  "@/app/page",
];

const DENIED_UI_PROVIDER_SPECIFIERS = [
  "graphhopper-js",
  "@graphhopper/client",
  "tomtom-sdk",
  "@tomtom/maps",
  "valhalla-client",
  "MY-VALHALLA-ADAPTER",
];

const ALLOWED_UI_IMPORTS = [
  "../application/planner-session",
  "../domain/ride-intent",
  "./route-card",
  "react",
  "@tanstack/react-query",
];

describe("Rule A — src/domain stays framework-free (OGV-ARC-004)", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [RULE_A])).toEqual([]);
  });

  it.each(DENIED_DOMAIN_PACKAGES)("rejects the bare package %s", (specifier) => {
    expect(domainForbiddenReason(SRC_ROOT, specifier, null)).not.toBeNull();
    expect(
      DENIED_DOMAIN_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier)),
    ).toBe(true);
  });

  it.each(ALLOWED_DOMAIN_IMPORTS)("allows %s", (specifier) => {
    expect(domainForbiddenReason(SRC_ROOT, specifier, null)).toBeNull();
  });

  it.each(DENIED_DOMAIN_LAYER_ESCAPES)(
    "rejects the cross-layer alias %s",
    (specifier) => {
      expect(domainForbiddenReason(SRC_ROOT, specifier, null)).toMatch(
        /must not import the .* layer/,
      );
    },
  );

  it.each(["~/ui/thing", "#ui/thing", "#internal/planner"])(
    "rejects the unconfigured local alias %s",
    (specifier) => {
      expect(domainForbiddenReason(SRC_ROOT, specifier, null)).toMatch(
        /unresolvable-local-specifier/,
      );
    },
  );

  it("rejects a non-literal dynamic import in the domain", () => {
    expect(domainForbiddenReason(SRC_ROOT, "<dynamic>", null)).toMatch(
      /unverifiable-dynamic-import/,
    );
  });

  it("rejects a relative escape out of the domain layer", () => {
    const reason = domainForbiddenReason(
      SRC_ROOT,
      "../shared/labels",
      path.join(REPO_ROOT, "tests", "shared", "labels"),
    );

    expect(reason).toMatch(/escapes src\/domain/);
  });

  it("flags the rule A fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("rule-a-domain-framework"), [
      RULE_A,
    ]);
    const specifiers = violations.map((violation) => violation.specifier);

    expect(countByRule(violations)).toEqual({ [RULE_A]: 9 });
    // Three files reach `react` through three vectors: a static import, an
    // `.mts` extension and a CommonJS `require`.
    expect(specifiers.filter((specifier) => specifier === "react")).toHaveLength(
      3,
    );
    expect(specifiers).toContain("next/link");
    expect(specifiers).toContain("@/app/page");
    expect(specifiers).toContain("../infrastructure/routing/route-adapter");
    expect(specifiers).toContain("../shared/fixture-label");
  });

  it("fails closed on unverifiable dynamic imports in the domain", () => {
    const violation = scanRoot(fixtureRoot("rule-a-domain-framework"), [
      RULE_A,
    ]).find((entry) => entry.specifier === "<dynamic>");

    expect(violation?.reason).toMatch(/unverifiable-dynamic-import/);
  });

  it("rejects a `~/` alias the repository does not configure", () => {
    const violation = scanRoot(fixtureRoot("rule-a-domain-framework"), [
      RULE_A,
    ]).find((entry) => entry.specifier === "~/ui/thing");

    expect(violation?.reason).toMatch(/unresolvable-local-specifier/);
  });
});

describe("Rule B — src/ui never imports providers (OGV-ARC-002 partial)", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [RULE_B])).toEqual([]);
  });

  it.each(DENIED_UI_PROVIDER_SPECIFIERS)(
    "rejects the provider specifier %s",
    (specifier) => {
      expect(uiForbiddenReason(SRC_ROOT, specifier, null)).not.toBeNull();
    },
  );

  it.each(ALLOWED_UI_IMPORTS)("allows %s", (specifier) => {
    expect(uiForbiddenReason(SRC_ROOT, specifier, null)).toBeNull();
    expect(DENIED_UI_PROVIDER_SPECIFIER_PATTERN.test(specifier)).toBe(false);
  });

  it("rejects an alias import of the routing layer", () => {
    expect(
      uiForbiddenReason(SRC_ROOT, "@/infrastructure/routing/graphhopper", null),
    ).toMatch(/infrastructure\/routing/);
  });

  it("rejects a resolved import of the routing layer", () => {
    expect(
      uiForbiddenReason(
        SRC_ROOT,
        "../infrastructure/routing/route-adapter",
        path.join(SRC_ROOT, "infrastructure", "routing", "route-adapter"),
      ),
    ).toMatch(/infrastructure\/routing/);
  });

  it("rejects a provider URL string literal in UI copy", () => {
    expect(
      providerUrlLiteralReason("https://api.tomtom.com/search/2/search/"),
    ).toMatch(/provider-url-literal/);
    expect(providerUrlLiteralReason("https://api.graphhopper.com/route")).not.toBeNull();
    expect(providerUrlLiteralReason("https://valhalla.example/route")).not.toBeNull();
    expect(providerUrlLiteralReason("https://example.com/route")).toBeNull();
    expect(providerUrlLiteralReason("no url here")).toBeNull();
  });

  it("flags the rule B fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("rule-b-ui-provider"), [RULE_B]);
    const specifiers = violations.map((violation) => violation.specifier);

    expect(countByRule(violations)).toEqual({ [RULE_B]: 4 });
    expect(specifiers).toContain("../infrastructure/providers/tomtom-places");
    expect(specifiers).toContain("../infrastructure/routing/graphhopper-adapter");
    expect(specifiers).toContain("https://api.tomtom.com/search/2/search/");
    // The app layer is guarded by the same rule, not only `src/ui`.
    expect(specifiers).toContain("https://api.graphhopper.com/route");
  });
});

describe("Rule E — provider adapters do not decide (OGV-ARC-008)", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [RULE_E])).toEqual([]);
  });

  it.each(["@/ui/labels/best-ride", "@/app/planner-page"])(
    "rejects the decision-layer alias %s",
    (specifier) => {
      expect(routingForbiddenReason(SRC_ROOT, specifier, null)).not.toBeNull();
    },
  );

  it("rejects a resolved import of the ui layer", () => {
    expect(
      routingForbiddenReason(
        SRC_ROOT,
        "../../ui/labels/best-ride",
        path.join(SRC_ROOT, "ui", "labels", "best-ride"),
      ),
    ).toMatch(/src\/ui/);
  });

  it("allows a port-relative import inside the adapter layer", () => {
    expect(
      routingForbiddenReason(
        SRC_ROOT,
        "./route-provider-port",
        path.join(
          SRC_ROOT,
          "infrastructure",
          "routing",
          "route-provider-port",
        ),
      ),
    ).toBeNull();
  });

  it("allows application imports that resolve to a port module", () => {
    expect(
      routingForbiddenReason(SRC_ROOT, "@/application/routing/ports/route-provider", null),
    ).toBeNull();
    expect(
      routingForbiddenReason(
        SRC_ROOT,
        "../../application/routing/route-provider",
        path.join(SRC_ROOT, "application", "routing", "route-provider"),
      ),
    ).toBeNull();
    expect(
      routingForbiddenReason(
        SRC_ROOT,
        "@/application/geocoding-ports/geocode-port",
        null,
      ),
    ).toBeNull();
  });

  it("rejects application decision policy imported by a provider adapter", () => {
    expect(
      routingForbiddenReason(SRC_ROOT, "@/application/planner/roles", null),
    ).toMatch(/provider-imports-decision-policy/);
    expect(
      routingForbiddenReason(
        SRC_ROOT,
        "@/application/planner/route-explanation",
        null,
      ),
    ).toMatch(/provider-imports-decision-policy/);
  });

  it("flags the rule E fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("rule-e-routing-ui"), [RULE_E]);
    const specifiers = violations.map((violation) => violation.specifier);

    expect(countByRule(violations)).toEqual({ [RULE_E]: 4 });
    expect(specifiers).toContain("../../app/planner-page");
    expect(specifiers).toContain("../../ui/labels/best-ride-label");
    expect(specifiers).toContain("../../application/planner/roles");
    expect(specifiers).toContain("../../application/planner/route-explanation");
  });
});

/**
 * UI → infrastructure (4.0 review finding 8; 02-ARCHITECTURE-CONTRACT §7).
 *
 * The map host seam was real for tests and decorative for the scanner: `PlannerMap`
 * imported `maplibre-gl/dist/maplibre-gl.css` and the concrete `createMapLibreHost`
 * while also accepting an injected factory. The renderer and its stylesheet now
 * belong to the composition root (`src/app/PlannerClient.tsx`), and this rule is
 * what keeps them there: `src/ui` imports **zero** infrastructure modules, so the
 * seam needs no allowlist.
 */
describe("UI → infrastructure — the composition seam (4.0 review finding 8)", () => {
  it("accepts the real src tree", () => {
    expect(scanRoot(SRC_ROOT, [RULE_UI_INFRA])).toEqual([]);
  });

  it("flags the fixture tree with exact violations", () => {
    const violations = scanRoot(fixtureRoot("rule-ui-no-infrastructure"), [
      RULE_UI_INFRA,
    ]);
    const specifiers = violations.map((violation) => violation.specifier);

    expect(countByRule(violations)).toEqual({ [RULE_UI_INFRA]: 4 });
    expect(specifiers).toContain("@/infrastructure/map/maplibre/host");
    expect(specifiers).toContain("maplibre-gl/dist/maplibre-gl.css");
    expect(specifiers).toContain("@/infrastructure/storage/ride-repository");
    // A relative escape into the layer is the same violation as the alias form,
    // and the fixture resolves to a module that really exists.
    expect(specifiers).toContain("../infrastructure/map/host");
  });

  it("rejects the renderer package by name, stylesheet included", () => {
    expect(uiInfrastructureForbiddenReason(SRC_ROOT, "maplibre-gl", null)).toMatch(
      /renderer package/,
    );
    expect(
      uiInfrastructureForbiddenReason(SRC_ROOT, "maplibre-gl/dist/maplibre-gl.css", null),
    ).toMatch(/renderer package/);
  });

  it("allows the port, which is what keeps the renderer swappable", () => {
    expect(
      uiInfrastructureForbiddenReason(SRC_ROOT, "@/application/map/map-host", null),
    ).toBeNull();
    expect(uiInfrastructureForbiddenReason(SRC_ROOT, "react", null)).toBeNull();
    expect(
      uiInfrastructureForbiddenReason(
        SRC_ROOT,
        "./route-card",
        path.join(SRC_ROOT, "ui", "planner", "route-card"),
      ),
    ).toBeNull();
  });

  it("does not guess at lookalikes", () => {
    expect(uiInfrastructureForbiddenReason(SRC_ROOT, "maplibre-gl-utils", null)).toBeNull();
    // A domain/application module whose name merely contains the word is not the
    // layer: the rule compares paths, not substrings.
    expect(
      uiInfrastructureForbiddenReason(SRC_ROOT, "@/application/infrastructure-view", null),
    ).toBeNull();
  });
});

describe("clean per-layer samples satisfy the parser and layer rules", () => {
  it.each([RULE_A, RULE_B, RULE_E, RULE_UI_INFRA])(
    "accepts the clean fixture tree for %s",
    (ruleId) => {
      expect(scanRoot(fixtureRoot("clean"), [ruleId])).toEqual([]);
    },
  );
});

describe("architecture fixtures stay non-vacuous", () => {
  const VIOLATING_FIXTURES: readonly { root: string; ruleId: string }[] = [
    { root: "rule-a-domain-framework", ruleId: RULE_A },
    { root: "rule-b-ui-provider", ruleId: RULE_B },
    { root: "rule-e-routing-ui", ruleId: RULE_E },
    { root: "rule-ui-no-infrastructure", ruleId: RULE_UI_INFRA },
  ];

  it.each(VIOLATING_FIXTURES)(
    "detects at least one deliberate violation for $ruleId in $root",
    ({ root, ruleId }) => {
      const violations = violationsForRule(scanRoot(fixtureRoot(root)), ruleId);

      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations.every((violation) => violation.ruleId === ruleId)).toBe(
        true,
      );
      expect(violations[0]?.reason).toBeTruthy();
    },
  );
});
