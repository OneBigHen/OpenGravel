# Production deployment capture

OpenGravel currently has CI in GitHub, but the live deployment topology is not yet represented in this repository.

This directory is the target home for the **verified, non-secret** production deployment definition.

Do not invent hostnames, paths, users, service names, ports or proxy configuration from memory. The first closeout run should inspect the actual running deployment and replace the placeholders below with what is really in use.

## Required topology record

Document:

- canonical public HTTPS origin;
- application host;
- Node version and installation method;
- application service/process manager;
- application listen address/port;
- reverse proxy/TLS owner;
- GraphHopper host/service/port;
- GraphHopper graph coverage and graph build version;
- persistent data root;
- environment/secret source;
- release root and current-release mechanism;
- backup target;
- rollback command;
- health/smoke commands.

Suggested checked-in files after discovery:

```
infra/deploy/
  README.md
  app.service.example          # or the actual non-secret systemd unit
  reverse-proxy.example        # Caddy/nginx/Cloudflare notes/config as applicable
  release.sh                   # deterministic release script
  rollback.sh                  # deterministic rollback script
  smoke.sh                     # public/private smoke checks
```

Use names matching the real runtime rather than creating these exact filenames mechanically.

## Persistent paths

Production should set explicit release-independent paths for mutable or generated state:

```
OGV_SHARE_DB_PATH=
COMMUNITY_DB_PATH=
OGV_FEEDBACK_DB_PATH=
OGV_OFFLINE_REGION_ROOT=
OGV_BASEMAP_ROOT=
OGV_DISCOVER_OSM_PLACES=
CURVATURE_DB_PATH=
GRAVEL_ATLAS_DB_PATH=
OGV_ROAD_AUTHORITY_CACHE_DIR=
```

If current production relies on the development defaults under the repo's `data/` directory, migrate only after making and verifying backups.

## Release contract

A release must be tied to one Git commit and one build ID.

Minimum sequence:

1. fetch reviewed `main`;
2. create an immutable release directory or equivalent atomic deployment unit;
3. load production environment from the secret/config source;
4. `npm ci`;
5. `npm run verify`;
6. run relevant real-router/provider smoke tests;
7. `npm run build`;
8. start candidate;
9. check `/api/health` and application smoke;
10. switch traffic/current pointer;
11. re-run public-origin smoke;
12. retain previous release for rollback.

Do not deploy directly from an uncommitted worktree.

## Rollback contract

The verified production documentation must contain an exact rollback operation that:

- points the service back to the previous release;
- does not overwrite persistent data;
- restarts/reloads the application safely;
- confirms health after rollback.

A rollback that requires rebuilding the previous source tree is not sufficient.

## Secrets

Never commit:

- API keys;
- Spotify session key;
- camera relay secrets;
- moderation token;
- private origin credentials;
- TLS private keys.

`.env.example` is the inventory of names and semantics, not a secret template to fill in and commit.

## Provider/data startup

Do not fail the entire web service because an optional provider is absent.

Do fail or block promotion when a release claims a core capability that is not actually configured. Provider-health work in the stack-closeout plan is intended to make that decision machine-readable.

## First production capture checklist

- [ ] locate the currently running OpenGravel process;
- [ ] record current Git SHA/build;
- [ ] record current environment variable names without printing secret values;
- [ ] record persistent file/directory paths;
- [ ] identify GraphHopper service and graph;
- [ ] identify reverse proxy/TLS;
- [ ] verify current backup exists;
- [ ] verify current rollback path;
- [ ] record restart command;
- [ ] record private health check;
- [ ] record public smoke check;
- [ ] commit the non-secret topology;
- [ ] only then automate releases.

See `docs/OPUS-PRODUCTION-HANDOFF.md` for the complete closeout flow.
