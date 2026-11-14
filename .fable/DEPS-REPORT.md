# Dependency bumps — 2026-11-14

Branch: `deps/bumps-2026-11-14`. Nothing pushed.

## What changed

| Package | From | To | Result |
| --- | --- | --- | --- |
| `@playwright/test` | 1.63.0 | **1.64.1** | Applied |
| `dexie` | 4.4.6 | **4.4.7** | Already at 4.4.7 on this branch (package.json and lock) |
| `@vitejs/plugin-react` | 6.1.1 | **6.1.2** | Already at 6.1.2 on this branch (package.json and lock) |
| `jsdom` | 30.1.3 | **31.0.0** (major) | Applied |
| `eslint` | 9.39.5 | **10.14.0** (major) | Applied |

`npm install` regenerated `package-lock.json`; `npm ci --dry-run` reports the
lock is up to date. No application code needed changing for either major.

## Lint and type check

```
$ npm run lint
✖ 6 problems (0 errors, 6 warnings)      # all in .fable/phonefirst-shot.mjs, pre-existing
lint_exit=0

$ npm run typecheck
> tsc --noEmit
typecheck_exit=0
```

## Full test suite

```
$ npx vitest run --maxWorkers=4

 Test Files  611 passed | 1 skipped (612)
      Tests  7183 passed | 3 skipped (7186)
   Duration  630.13s
```

This is the full unit, integration, contract, architecture and ride-simulation
suite against the bumped dependencies.

## Major-version notes and what was checked

### ESLint 10

- The repo already uses flat config (`eslint.config.mjs`) only. There is no
  `.eslintrc`, no `eslint-env` comment, and no local custom rule using removed
  `context`/`SourceCode` members, so the ESLint 10 removals do not apply.
- ESLint 10 now tracks JSX references. No new unused-import or undefined-name
  reports appeared.
- `eslint-config-next` does not enable `eslint:recommended`, so its three new
  v10 rules (`no-unassigned-vars`, `no-useless-assignment`,
  `preserve-caught-error`) are not switched on here. Nothing was disabled.
- Sanity probe: a throwaway JSX file still produced `react/jsx-key`,
  `react-hooks/set-state-in-effect`, `react-hooks/exhaustive-deps` and
  `@typescript-eslint/no-unused-vars`, so the Next.js config and its plugins are
  loading and executing rules under v10.
- Only warnings remain (six, in `.fable/phonefirst-shot.mjs`, unchanged by this
  branch). No lint rule was turned off or downgraded.

### jsdom 31

- The repo does not construct `JSDOM` directly; Vitest's `jsdom` environment
  owns parsing. No test listens for `load` on `document` (jsdom 31 now fires
  page-completion `load` only on `window`), and the tests that need it use
  `window.addEventListener("load", ...)`.
- The jsdom 31 canvas backend change (`@napi-rs/canvas`) is irrelevant here:
  `tests/setup.ts` deliberately returns `null` from `getContext()` to exercise
  the documented no-canvas path.
- jsdom 31 replaces its CSS engine and parsing pipeline. Its old CSS packages
  left the lock file and the integrated ones arrived; the full suite passed, so
  no selector/computed-style behaviour the tests rely on changed.

### Playwright 1.64.1

- 1.64.1 resolves Chromium 1248, Chromium headless shell 1248, WebKit 2370 and
  ffmpeg 1013. Chromium 1248 and ffmpeg 1013 are already cached on this host, so
  the default `critical-chromium` gate needs no download.
- **WebKit 2370 is not cached here.** The optional `critical-webkit` project
  needs `npx playwright install webkit` once on a host that wants to run it. CI
  installs its browsers, so this is not a gate change.
- `playwright.config.ts` and `scripts/og-shots/README.md` still named Playwright
  1.61.1 / the old browser revisions; both were updated to 1.64.1 and the real
  revisions.

## Risks / follow-ups

- **Peer-dependency warnings (not failures).** `eslint-config-next@16.4.1`
  bundles `eslint-plugin-react@7.37.5`, `eslint-plugin-import@2.32.0` and
  `eslint-plugin-jsx-a11y@6.10.2`, whose declared peers stop at ESLint 9.
  `npm install`/`npm ci` succeed with warnings, and the probe above shows their
  rules still run. These plugins have no newer release with an ESLint 10 peer
  yet; expect the warnings to disappear in a future `eslint-config-next`
  release. Watch CI for a config-loading failure if npm changes peer handling.
- **Pre-existing audit advisory.** `npm audit` reports 2 moderate issues, both
  from `eslint@10.14.0` depending on `minimatch@10.2.6`. The same
  `minimatch@10.2.6` was in the lock file before this branch; the fix is
  `eslint@10.15.0`, outside the requested bump. Dev-only.
- No secrets, production data, or frozen-area code touched. No push performed.
