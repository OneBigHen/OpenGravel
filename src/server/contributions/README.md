# Contribution foundation store

This foundation uses Node 24's built-in `node:sqlite` `DatabaseSync`; the
runtime in this worktree is Node 24.15.0, so no SQLite dependency or JSONL
fallback is needed. The default file is `data/community.sqlite`, overridable
with `COMMUNITY_DB_PATH`. `OGV_CONTRIBUTIONS_DB_PATH` remains a compatibility
alias when `COMMUNITY_DB_PATH` is unset; the database is gitignored.

The `contributions` table is append-only by module contract. It stores:

| Column | Meaning |
| --- | --- |
| `id` | Server-minted opaque `contrib_...` id |
| `road_id`, `span_id` | Canonical bounded evidence scope |
| `kind` | `surface`, `gate`, or `condition` |
| `observed_at` | Client observation instant |
| `gps_precision_m` | Bounded location accuracy metadata; no geometry is stored |
| `value_json` | The kind-specific value |
| `contributor_pseudo_id` | Local UUID v4 pseudonym, not PII |
| `client_version` | Bounded client build/version string |
| `evidence_level` | `low`, `medium`, or `high` |
| `envelope_json` | Validated round-trip envelope |
| `received_at` | Server receipt instant |

The `contribution_moderation` table is the append-only decision log:

| Column | Meaning |
| --- | --- |
| `id` | Contribution id; the primary key allows at most one decision ever |
| `decision` | `accept` or `reject` |
| `decided_at` | Server decision instant |

The moderation state (`pending`, `accepted`, `rejected`) is a projection of
this log, so a terminal decision can never be silently rewritten or reopened.

The submission foundation has no account, report-delete workflow, profile, or
social feed. Abuse bounds (payload size, queue size, per-reporter pending, and
submission rate) are enforced at the application boundary — not by UI or API
callers — and every moderation decision is typed and explicit. The moderation
queue and decision endpoints require `Authorization: Bearer <token>` using
`OGV_MODERATION_TOKEN`; they return `503` while that server setting is absent
and `401` for a missing or incorrect token. Hosted deployment must still add
the remaining controls before broader community exposure. The API accepts only
a road/span reference and evidence; it does not accept a full ride trace or raw
route geometry.

`GET /api/contributions?roadRef=road_<id>/span_<id>&limit=100` returns at most
100 records for that exact road/span. Responses are marked `private, no-store`
to prevent shared caching. Contribution submission remains anonymous and
bounded; moderation access is restricted as described above.

`GET /api/contributions/moderation?limit=100` lists at most 100 pending
submissions for the moderation queue when authorized. `POST
/api/contributions/moderation` applies exactly one typed decision (`{"id":
"contrib_...", "decision": "accept" | "reject"}`); a second decision on a
terminal record fails with `409 conflict` and leaves the stored state untouched.

Catalog ratings are stored separately in `catalog_route_ratings` and aggregated
by route. A browser-generated UUID v4 pseudonym is used as the per-device key;
no account or contact detail is required. Ratings are rate-limited to 10 writes
per device per 10 minutes. Catalog comments and road-condition reports are
condition contributions with the catalog route's synthetic road/span scope;
they use the same validation, abuse limits and moderation queue above. A comment
is returned by `/api/catalog/<id>/community` only after an explicit accept
decision, and uses `value.note` (maximum 500 printable characters). Both catalog
ratings and contributions share the `COMMUNITY_DB_PATH` SQLite file by default.
