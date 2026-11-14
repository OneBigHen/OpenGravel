# Fold the 5 open dependabot PRs into one tested branch (This codebase is yours)
PRs (OneBigHen/OpenGravel): #198 @playwright/test 1.63.0->1.64.1, #199 dexie 4.4.6->4.4.7, #200 @vitejs/plugin-react 6.1.1->6.1.2, #201 jsdom 30.1.3->31.0.0 (major), #202 eslint 9.39.5->10.14.0 (major).
Apply all five on this branch (npm install the exact versions; keep package-lock consistent). Read each major's migration notes (eslint 10 flat-config changes, jsdom 31) and fix whatever breaks. Do not disable lint rules or skip tests to get green; if a rule's meaning changed, adapt code or config the honest way and say so.
Pass: `npm run lint`, `npm run typecheck`, `npx vitest run --maxWorkers=4` all pass (paste summary lines). If @playwright/test bump needs new browsers, note it in the report (CI installs them).
Commit in small plain-English commits, then write .fable/DEPS-REPORT.md (what changed, anything risky) and commit it. Do not push.
