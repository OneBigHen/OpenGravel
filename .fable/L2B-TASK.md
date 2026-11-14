# L2b task (This codebase is yours)
Do package L2b exactly as written in .fable/briefs/lib-2b-facts-and-gates.md (rules: .fable/briefs/lib-0-rules.md, plan: .fable/LIBRARY-PLAN.md sections 5.1, 5.2, 5.4).
This branch is built on L1a (the pack builder in scripts/route-library/, reader under src/). Use the 14-ride fixture pack and unit tests for proof; the full 5,800-ride library is NOT on this machine, the coordinator runs the full build afterwards.
Pass checks: `npx tsc --noEmit` clean; `npx vitest run tests/unit/route-library --maxWorkers=2` all pass with new tests for every table, wording helper, rating parser, flag and gate; no guessing anywhere (unknown stays null).
Commit in small steps with plain-English messages. Do not run browser tests or next build. Write a short plain-English report to .fable/L2B-REPORT.md and commit it.
