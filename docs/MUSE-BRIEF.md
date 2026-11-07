# Brief for an autonomous agent: make OpenGravel better

This is a self-contained brief for an autonomous coding agent with GitHub access (written for Muse, works for any agent). Paste the prompt below as the agent's task. Everything it needs is in this repository.

---

## The prompt

You are working on **OpenGravel** (https://github.com/OneBigHen/OpenGravel), an open-source (AGPL-3.0) motorcycle route planner. Riders use it to plan curvy, backroad and gravel rides, see them on a map, and ride them turn by turn. The owner does not read code. They judge your work by whether the app is nicer to use, has fewer bugs and still passes every check. Your job: **test the product hard, find real bugs and rough UX, and fix them with small, proven pull requests.**

### 1. Get oriented (do this first, no edits yet)

1. Clone the repo. Start from `main`. If PR #97 (`docs/native-iphone-plan`) is still open, read its files from that branch: `git fetch origin docs/native-iphone-plan`.
2. Read, in order:
   - `CLAUDE.md`: the core invariants and the local gates. These are binding.
   - `docs/architecture.md`
   - `docs/native-app/PLAN.md` and `docs/native-app/SPEC.md` (on the PR #97 branch): where the product is heading, the rider's needs and the copy and voice rules (SPEC section 10).
   - `.env.example`: every setting, and which are optional.
3. Install and run the baseline (Node 24+):
   ```bash
   npm ci
   npm run audit:env && npm run lint && npm run typecheck && npm test && npm run test:architecture && npm run build
   ```
   It was green in GitHub Actions on 2026-10-13. If something is red before you change anything, fixing it is your first PR.
4. Run the app without any external services, using the built-in fixtures:
   ```bash
   npm run dev:demo        # http://localhost:3000, fake router/weather/geocode/places
   ```
   Browser end-to-end suite (Playwright, production build, fixture mode):
   ```bash
   npx playwright install chromium   # skip this if the browsers are already installed
   npm run test:e2e:critical
   ```

### 2. What to do

Work in rounds. Each round: **explore → write down findings → fix the best few → prove → PR.**

**A. Explore like a rider.** Use Playwright (or a real browser) at desktop size (1440×900) and phone size (390×844, touch). Walk every flow end to end and take screenshots:
- plan a ride: start, destination or loop, ride style, compare route choices, drag to reshape, cancel mid-plan;
- Explore the route catalog and its filters;
- the library: save, rename, delete, GPX import and export, share links and the public share page;
- the ride / focus screen, recording, stops and places along the ride, weather;
- settings, offline behaviour, and what happens when a provider fails or is slow (the app must degrade gracefully, never crash or show a blank map);
- keyboard-only use, visible focus, screen-reader labels, colour contrast, `prefers-reduced-motion`.

Watch the browser console and network tab. Every console error, failed request, layout jump, overlapping element, clipped text, dead button, confusing label or slow interaction is a finding.

**B. Keep a findings log** in `docs/muse/FINDINGS.md`. One row per finding: id, where, what happens, what should happen, severity (crash / wrong data / broken flow / UX polish), screenshot path, and status (open / fixed in PR #N / won't fix + why). Commit it in your first PR and keep it updated.

**C. Fix in priority order:** crashes and data loss → wrong or misleading information → broken flows → accessibility → visual and UX polish → test gaps. For each fix:
- first write a test that fails because of the bug (unit test in `tests/unit`, or a Playwright spec in `tests/e2e/critical`), then make it pass;
- keep the change small and focused, ideally under about 300 changed lines;
- add tests for important flows that have none, even where you found no bug.

**D. Code-health passes** (only after the rider-facing bugs): flaky tests, dead code that tests prove is unused, oversized components split for readability (no behaviour change, tests prove it), slow pages (measure before and after).

### 3. Rules you must not break

- **Binding invariants from `CLAUDE.md`:** GraphHopper is the routing authority. Unknown or unavailable data is never shown as clear, open, legal, paved or safe. AI never sets route geometry, access, closures or surface. Discovery never changes a route without the rider acting. Optional providers fail on their own without breaking planning or navigation.
- **Don't fake verification.** Fixture mode is for tests. Never claim a live-provider feature works because a fixture passes, and never weaken a test, a lint rule or a type check to get to green.
- **The web app is the laptop planner.** Bug fixes, UX polish, accessibility and tests are all welcome. Don't start big new features or redesign whole screens. Propose those as GitHub issues with screenshots instead.
- **Stay out of these** (other agents own them, or they need the owner): `apps/ios/**`, `apps/iphone/**`, `tools/hermes/**`, `docs/native-app/**`, `infra/**`, deployment, and any production server or data. Don't touch other open PRs (#46, #97, the Dependabot PRs).
- **Dependencies:** no new runtime dependencies without a clear reason in the PR. Licences must be MIT, BSD, Apache-2.0 or ISC. Never copy code from GPL projects or decompiled apps.
- **No secrets** in code, commits, logs or screenshots.
- **Styling:** follow the existing styles and design tokens in `src/`. Keep the current fonts and colour variables. Background is never pure white. Any animation respects `prefers-reduced-motion`.
- **Copy:** short, plain words a rider understands at a glance (SPEC.md section 10).

### 4. Git and pull requests

- One branch and one PR per fix or theme, named `muse/<short-slug>`, based on current `main`. Rebase before asking for review.
- Before opening a PR, run all of these and make sure they pass:
  ```bash
  npm run audit:env && npm run lint && npm run typecheck && npm test && npm run test:architecture && npm run build
  npm run test:e2e:critical      # for anything that touches the UI
  ```
- The PR description is about 10 lines, in plain English for a non-programmer:
  - **What was wrong** (the finding id, plus a before screenshot);
  - **What changed** (an after screenshot for UI);
  - **How it was proven** (the test names and the gate results);
  - **Risk / not tested**.
- CI (`.github/workflows/ci.yml`) must be green on your final commit. Don't merge your own PRs. The owner or the reviewer merges.
- Two strikes: if the same problem defeats you twice, stop. Write up what you tried in the findings log and an issue, then move on.

### 5. When you finish a session

Update `docs/muse/FINDINGS.md`, and add a short `docs/muse/REPORT.md` that covers:
- PRs opened, each with one plain line;
- the top remaining problems;
- what you recommend next.

Plain English, no jargon. The owner reads this file, not the code.
