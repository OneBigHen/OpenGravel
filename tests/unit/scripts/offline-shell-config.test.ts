import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps a generated build identity stable when Next reloads config in a compiler worker", async () => {
  vi.stubEnv("OGV_BUILD_ID", undefined);
  vi.stubEnv("NEXT_PUBLIC_OGV_SHELL_BUILD_ID", undefined);
  const first = (await import("../../../next.config")).default;
  const buildId = await first.generateBuildId!();
  vi.resetModules();
  // Next's production compiler loads config again in a worker inheriting the
  // parent environment. It must embed the ID used by the parent's manifest.
  const compiler = (await import("../../../next.config")).default;
  expect(compiler.env?.NEXT_PUBLIC_OGV_SHELL_BUILD_ID).toBe(buildId);
  expect(await compiler.generateBuildId!()).toBe(buildId);
});

it("uses the deployment build ID for Next and the shell, accepting semver identifiers", async () => {
  vi.stubEnv("OGV_BUILD_ID", "release-1.2.3");
  vi.stubEnv("NEXT_PUBLIC_OGV_SHELL_BUILD_ID", undefined);
  const config = (await import("../../../next.config")).default;
  expect(await config.generateBuildId!()).toBe("release-1.2.3");
  expect(config.env?.NEXT_PUBLIC_OGV_SHELL_BUILD_ID).toBe("release-1.2.3");
});
