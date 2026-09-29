import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_DIR,
  FIXTURES_ROOT,
  REPO_ROOT,
  SRC_ROOT,
} from "./lib/harness";
import {
  DYNAMIC_SPECIFIER,
  checkBoundaryRules,
  extractModuleSpecifiers,
  findRepoRoot,
  findSpecifierOccurrences,
  findStringLiterals,
  resolveSpecifier,
  walkSourceFiles,
  type BoundaryRule,
} from "./lib/scan";

const ALL_IMPORT_FORMS = [
  'import Default from "./default-module";',
  'import { named } from "./named-module";',
  'import * as namespace from "./namespace-module";',
  'import "./side-effect-module";',
  'export { thing } from "./re-export-module";',
  'export * from "./star-export-module";',
  'type Lazy = typeof import("./type-import-module");',
  "const dynamic = await import('./dynamic-module');",
].join("\n");

const EXPECTED_SPECIFIERS = [
  "./default-module",
  "./named-module",
  "./namespace-module",
  "./side-effect-module",
  "./re-export-module",
  "./star-export-module",
  "./type-import-module",
  "./dynamic-module",
];

describe("scan: extractModuleSpecifiers", () => {
  it("extracts every supported import form in source order", () => {
    expect(extractModuleSpecifiers(ALL_IMPORT_FORMS)).toEqual(
      EXPECTED_SPECIFIERS,
    );
  });

  it("extracts a multi-line import statement", () => {
    const source = 'import {\n  alpha,\n  beta,\n} from "./multi-line-module";';

    expect(extractModuleSpecifiers(source)).toEqual(["./multi-line-module"]);
  });

  it("extracts CommonJS require() calls, including member access", () => {
    expect(extractModuleSpecifiers('const React = require("react");')).toEqual([
      "react",
    ]);
    expect(extractModuleSpecifiers("const legacy = require('legacy').default;")).toEqual([
      "legacy",
    ]);
  });

  it("keeps literal dynamic imports and marks non-literal ones as <dynamic>", () => {
    expect(extractModuleSpecifiers('const literal = await import("./literal");')).toEqual(
      ["./literal"],
    );
    expect(extractModuleSpecifiers("const lazy = await import(someVar);")).toEqual([
      DYNAMIC_SPECIFIER,
    ]);
    expect(extractModuleSpecifiers('const lazy = await import(`re${"act"}`);')).toEqual(
      [DYNAMIC_SPECIFIER],
    );
  });

  it("captures the whole declaration so a multiline import is analyzable", () => {
    const source = 'import {\n  setRideIntent,\n  other,\n} from "./ride-adapter";';

    const occurrences = findSpecifierOccurrences(source);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.declaration).toContain("setRideIntent");
    expect(occurrences[0]?.declaration).toContain('from "./ride-adapter"');
  });

  it("ignores commented-out, template-literal and in-string imports", () => {
    const source = [
      '// import "./line-comment";',
      '/* import "./block-comment"; */',
      "const snippet = `",
      'import "./template-module";',
      "`;",
      'const quoted = \'from "./quoted-through-string"\';',
      'const alsoQuoted = \'import "./string-only"\';',
      'import "./real-module";',
    ].join("\n");

    expect(extractModuleSpecifiers(source)).toEqual(["./real-module"]);
  });
});

describe("scan: findStringLiterals", () => {
  it("reports code string literals and skips comments and template bodies", () => {
    const source = [
      'const url = "https://api.tomtom.com/search/2/search/";',
      '// "https://api.graphhopper.com/route"',
      "/* 'https://valhalla.example/route' */",
      "const template = `https://api.tomtom.com/${suffix}`;",
      "const plain = 'single-quoted';",
    ].join("\n");

    expect(findStringLiterals(source).map((occurrence) => occurrence.literal)).toEqual([
      "https://api.tomtom.com/search/2/search/",
      "single-quoted",
    ]);
  });

  it("reports the source line of every literal", () => {
    const source = ['const first = "alpha";', 'const second = "beta";'].join(
      "\n",
    );

    expect(findStringLiterals(source).map((occurrence) => occurrence.line)).toEqual([
      1, 2,
    ]);
  });
});

describe("scan: resolveSpecifier", () => {
  const domainFile = path.join(SRC_ROOT, "domain", "ride", "types.ts");

  it("resolves the @/ alias against the repository src root", () => {
    expect(findRepoRoot(domainFile)).toBe(REPO_ROOT);
    expect(resolveSpecifier(domainFile, "@/ui/planner/PlannerWorkspace")).toBe(
      path.join(SRC_ROOT, "ui", "planner", "PlannerWorkspace"),
    );
  });

  it("resolves relative specifiers against the importing file directory", () => {
    expect(resolveSpecifier(domainFile, "./ids")).toBe(
      path.join(SRC_ROOT, "domain", "ride", "ids"),
    );
    expect(resolveSpecifier(domainFile, "../../application/planner-session")).toBe(
      path.join(SRC_ROOT, "application", "planner-session"),
    );
  });

  it("returns null for bare package specifiers", () => {
    expect(resolveSpecifier(domainFile, "react")).toBeNull();
    expect(resolveSpecifier(domainFile, "mapbox-gl")).toBeNull();
    expect(resolveSpecifier(domainFile, "@graphhopper/client")).toBeNull();
  });
});

describe("scan: walkSourceFiles", () => {
  it("walks .mts and .cts fixtures alongside .ts/.tsx", () => {
    const ruleAFixture = path.join(FIXTURES_ROOT, "rule-a-domain-framework");
    const files = walkSourceFiles(ruleAFixture);
    const domainDir = path.join(ruleAFixture, "domain");

    expect(files).toContain(path.join(domainDir, "imports-react.mts"));
    expect(files).toContain(path.join(domainDir, "requires-react.cts"));
    expect(
      files.every((file) =>
        [".ts", ".tsx", ".mts", ".cts"].includes(path.extname(file)),
      ),
    ).toBe(true);
  });

  it("finds the real source tree, sorted, without build or dependency dirs", () => {
    const files = walkSourceFiles(SRC_ROOT);

    expect(files).toContain(path.join(SRC_ROOT, "app", "page.tsx"));
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toEqual([...files].sort());
    expect(
      files.every((file) => !file.includes(`${path.sep}node_modules${path.sep}`)),
    ).toBe(true);
  });

  it("skips node_modules and .next anywhere under the scanned root", () => {
    const files = walkSourceFiles(REPO_ROOT);

    expect(files.length).toBeGreaterThan(0);
    expect(
      files.every(
        (file) =>
          !file.includes(`${path.sep}node_modules${path.sep}`) &&
          !file.includes(`${path.sep}.next${path.sep}`),
      ),
    ).toBe(true);
  });

  it("honours an explicit fixtures exclusion", () => {
    const files = walkSourceFiles(ARCHITECTURE_DIR, [FIXTURES_ROOT]);

    expect(files).toContain(path.join(ARCHITECTURE_DIR, "scan.test.ts"));
    expect(files.some((file) => file.startsWith(FIXTURES_ROOT))).toBe(false);
  });
});

describe("scan: checkBoundaryRules", () => {
  const fixtureFile = path.join(
    FIXTURES_ROOT,
    "rule-a-domain-framework",
    "domain",
    "imports-react.ts",
  );

  const probeRule: BoundaryRule = {
    id: "probe-rule",
    description: "scanner contract probe",
    appliesTo: (file) => file === fixtureFile,
    forbidden: (specifier) =>
      specifier === "react" ? "probe reason" : null,
  };

  it("reports ruleId, file, specifier and reason for a matching import", () => {
    expect(checkBoundaryRules([fixtureFile], [probeRule])).toEqual([
      {
        ruleId: "probe-rule",
        file: fixtureFile,
        specifier: "react",
        reason: "probe reason",
      },
    ]);
  });

  it("only evaluates rules whose appliesTo matches the file", () => {
    const neverApplies: BoundaryRule = { ...probeRule, appliesTo: () => false };

    expect(checkBoundaryRules([fixtureFile], [neverApplies])).toEqual([]);
  });

  it("runs a rule's literal hook over the file's string literals", () => {
    const urlFixture = path.join(
      FIXTURES_ROOT,
      "rule-b-ui-provider",
      "ui",
      "embeds-provider-url.ts",
    );
    const literalRule: BoundaryRule = {
      id: "literal-probe",
      description: "literal contract probe",
      appliesTo: (file) => file === urlFixture,
      forbidden: () => null,
      forbiddenLiteral: (literal) =>
        literal.includes("tomtom") ? "provider URL literal" : null,
    };

    expect(checkBoundaryRules([urlFixture], [literalRule])).toEqual([
      {
        ruleId: "literal-probe",
        file: urlFixture,
        specifier: "https://api.tomtom.com/search/2/search/",
        reason: "provider URL literal",
      },
    ]);
  });
});
