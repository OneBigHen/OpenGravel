import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SRC_ROOT } from "./lib/harness";

/**
 * Explore's list must not carry the route page's weight. The detail page owns
 * the map host and the preparation providers, so it loads through
 * `next/dynamic` and the wrapper (`ExploreRouteDetail`) supplies the providers
 * that only that page needs.
 */

const read = (relative: string): string => readFileSync(path.join(SRC_ROOT, relative), "utf8");

describe("Explore detail load split", () => {
  it("loads the route detail page lazily instead of importing it into the list", () => {
    const client = read("app/ExploreClient.tsx");

    expect(client).toContain('import dynamic from "next/dynamic"');
    expect(client).toContain('import("./ExploreRouteDetail")');
    // A static import would drag the detail page and its providers back into
    // the Explore list's first interaction.
    expect(client).not.toMatch(/from ["']@\/ui\/explore\/RouteDetail["']/);
    expect(client).not.toMatch(/from ["']@\/app\/preparation-providers["']/);
  });

  it("creates the detail page's preparation providers inside the lazy wrapper", () => {
    const wrapper = read("app/ExploreRouteDetail.tsx");

    expect(wrapper).toMatch(/from ["']@\/app\/preparation-providers["']/);
    expect(wrapper).toContain("createAppPreparationProviders()");
    expect(wrapper).toContain("preparationProviders={preparationProviders}");
  });
});
