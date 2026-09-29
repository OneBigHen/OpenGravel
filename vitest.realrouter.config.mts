import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Real-router suite (17-IMPLEMENTATION-PLAN Task 2.2).
 *
 * Deliberately separate from the default projects: these tests need a live
 * local GraphHopper and must never run in the unit or architecture jobs, where
 * an unreachable engine would look like a product failure. Run with
 * `npm run test:real-router` on a host that has the router up (docker-dev:
 * `http://127.0.0.1:8989`).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    name: "real-router",
    environment: "node",
    include: ["tests/real-router/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
