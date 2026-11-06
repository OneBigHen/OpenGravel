import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    {
      // node:sqlite is prefix-only and absent from Node's builtinModules list.
      // Vitest 5's client resolver otherwise tries to bundle it for jsdom.
      // node:net is the server rate limiter's address parser and hits the same
      // resolver path, so it is externalized too.
      name: "native-node-builtins",
      enforce: "pre",
      resolveId(id) {
        return id === "node:sqlite" || id === "node:net" ? { id, external: true } : null;
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: [
            "tests/unit/**/*.test.{ts,tsx}",
            "tests/integration/**/*.test.{ts,tsx}",
            "tests/contracts/**/*.test.{ts,tsx}",
          ],
          setupFiles: ["tests/setup.ts"],
          /*
           * Vitest's 5 s default is a deadline, not a measurement, and this repo
           * runs on shared 6-core hardware where other agents compete for CPU.
           * A full run on that host timed out six tests that each pass on their
           * own; the slowest legitimate one (a full planner render) measured
           * 4.3 s. Twenty seconds keeps every assertion exactly as written while
           * stopping quiet CPU contention from deciding the gate's colour. A
           * genuinely hung test still fails; it just fails after 20 s, not 5.
           */
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: "architecture",
          environment: "node",
          include: ["tests/architecture/**/*.test.{ts,tsx}"],
          passWithNoTests: true,
          /*
           * These rules walk and read the real `src/` tree. Rule B (UI never
           * imports providers) reads 276 files and measured 2.7 s of pure CPU
           * on an idle-ish host; inside a full-suite run on loaded hardware the
           * same scan crossed the 5 s default, so the static scan — which
           * asserts zero violations, never speed — went red on the clock alone.
           */
          testTimeout: 30_000,
        },
      },
    ],
  },
});
