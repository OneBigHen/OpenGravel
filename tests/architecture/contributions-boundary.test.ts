import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SRC_ROOT } from "./lib/harness";
import { extractModuleSpecifiers, walkSourceFiles } from "./lib/scan";

describe("contribution architecture boundary", () => {
  it("keeps the contribution domain free of UI imports", () => {
    const root = path.join(SRC_ROOT, "domain", "contributions");
    const imports = walkSourceFiles(root).flatMap((file) =>
      extractModuleSpecifiers(readFileSync(file, "utf8")),
    );

    expect(imports.some((specifier) => specifier.includes("/ui/") || specifier.startsWith("react"))).toBe(false);
  });
});
