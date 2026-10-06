import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    {
      // node:sqlite is prefix-only and absent from Node's builtinModules list.
      // Vitest 5's client resolver otherwise tries to bundle it for jsdom.
      name: "native-node-sqlite",
      enforce: "pre",
      resolveId(id) {
        return id === "node:sqlite" ? { id, external: true } : null;
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
        },
      },
      {
        extends: true,
        test: {
          name: "architecture",
          environment: "node",
          include: ["tests/architecture/**/*.test.{ts,tsx}"],
          passWithNoTests: true,
        },
      },
    ],
  },
});
