# Jev 1.13 transport identity and complete candidate-order audit

Base: `acac4f159f144c9956ba3e6dc9376850edc4325d` (draft PR #51).
This follow-up keeps frontier judgments offline and advisory-only.

## Correct pinned provider IDs

Direct TypeSafe documents `jev-1.13.0`, including acceptance of versioned IDs
that do not appear in its alias-only model catalog. OpenRouter documents
`typesafe/jev-1.13`. The previous direct pilot sent `jev-1.13`; its HTTP 400
does not establish whether the correctly spelled pinned release is reachable.
Sources: [TypeSafe Models](https://docs.typesafe.ai/models),
[OpenRouter Jev API](https://openrouter.ai/typesafe/jev-1.13/api).

The application port owns one shared set of frozen model identities in
`ports/jev-model-identity.ts`; infrastructure owns request pin selection and
provider-specific response checks in `jev-models.ts`. The direct route-character
classifier shares the same pin. Replay validation requires the exact direct
release or a namespaced OpenRouter release; bare `jev-1.13` identities are
rejected in both transport and injected replay results. Provider selection, key isolation,
fixed URLs, 1,500 ms deadline, zero retries, and aggregate-only state remain.
Moving aliases, other patch releases, and cross-provider response identities
are rejected. A single isolated request using the existing server credential
returned `jev-1.13.0` and passed the adapter's full answer validation in about
288 ms, with one HTTP attempt, 1,478 input tokens and 85 output tokens.
Only synthetic two-candidate derived facts were sent. The aggregate evidence
is in [jev-pinned-transport.json](../experiments/2026-10-01-jev-pinned-transport.json).
This proves that pin is reachable; it supplies no rider-quality or accuracy evidence.
An OpenRouter credential was unavailable, so that transport remains mock-verified.

## Why all six orders are required

The old three cyclic permutations balance each candidate's presentation slot,
but omit the three reverse orders. A synthetic judge that chooses route 2 in
the forward cycle and route 3 in the reverse cycle previously produced a
stable `alternative` verdict. The regression first failed with that verdict;
the complete audit now abstains and reports pairwise flip rate `9 / 15 = 0.6`.
This is a synthetic failure-mode proof, not a measured Jev bias rate.

Three candidates now use all six orders; two still use AB and BA. Exact
permutation IDs, uniqueness, completeness, and probability/choice consistency
are required before an audit can produce a stable result. Each candidate
occupies every slot twice in the three-candidate case. Seeded starting order
and local stable-ID remapping remain reproducible.
Replay freezes every permutation and nested slot assignment before dispatch;
an injected judge cannot rewrite the retained experimental design.

Each request still batches Choice, per-candidate Score, and independent Noul.
For A/B/C and `r` repeats, the complete replay reserves `18r` model requests
for three candidates and `6r` for two. The record's
`orderDesign: "complete-factorial-v1"` prevents a new replay from being
mistaken for the earlier cyclic design. Existing evidence remains historical.

This follows the position-bias evaluation concern described in
[Shi et al., IJCNLP-AACL 2025](https://aclanthology.org/2025.ijcnlp-long.18/).
Full enumeration is small enough at the existing two-to-three-candidate bound;
no dynamic escalation or new production routing hook is introduced.

## Acceptance and remaining evidence

Regression tests cover the reversal-sensitive judge, all six unique orders,
two appearances per slot, exact model IDs, provider-specific model drift,
request counts, metadata, and malformed/partial audits. Existing shadow tests
retain disabled/failure/timeout/cancellation and routing-authority isolation.

Required repository gates and exact outcomes are recorded in the final handoff.
No production merge/deployment, held-out multi-rider labels or calibrated
thresholds are claimed. The live result above is a transport smoke check.
RideDocument, PlanningSession,
RideSession, eligibility, canonical scores, route roles, and PlannerWorkspace
retain their existing ownership.
