# Exploratory lane — TestZeus Hercules (scaffolding)

This directory is the exploratory lane from the acceptance architecture. It is
**scaffolding, not a working integration**: Hercules is not vendored, no model
is wired, and nothing here runs in CI yet.

The design, when wired:

- Hercules receives the exact same Gherkin missions in
  `acceptance/features/` as its test charter — Gherkin in, behavior out.
- It runs on a **dirt-cheap model** against a deployed build (never the
  fixture-mode gate; exploratory needs the real app).
- It performs agentic UI/API/accessibility/visual exploration and emits JUnit.
- `scripts/qa/aggregate.mjs --hercules hercules-report.xml` folds its findings
  into `QA_CAMPAIGN.json` under each mission's `exploratory` key.
- **Exploratory findings never flip a deterministic mission's status.** A
  finding becomes a candidate deterministic Playwright/Maestro regression
  test; only the deterministic lane can turn a mission red or green.

`hercules.yaml` is a sketch of the intended configuration — model tier,
mission glob, JUnit output path, and the guardrails that keep the bot in the
exploratory lane (no mission execution, no deterministic re-runs).
