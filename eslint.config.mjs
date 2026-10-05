import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Generated output is never linted. The Playwright directories are produced by
  // `npm run test:e2e:critical` and contain the trace viewer's own bundles, and
  // `public/vendor/maplibre` holds MapLibre's own worker build verbatim (see
  // `scripts/vendor-maplibre-worker.mjs`) — vendored third-party bytes, kept
  // byte-identical by a test rather than reformatted to satisfy our style rules.
  globalIgnores([
    ".next/**",
    // Nested agent checkouts and browser artifacts are not this source tree.
    ".claude/worktrees/**",
    ".playwright-mcp/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "spec/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "public/vendor/**",
    // The native iOS shell is its own package (apps/ios/package.json) with its
    // own dependencies and a generated Xcode project; it holds no app code.
    "apps/**",
  ]),
]);

export default eslintConfig;
