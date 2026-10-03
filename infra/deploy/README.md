# Production deployment

Captured from the running host on 2026-10-03. Secrets live only in the environment file; names are in `.env.example`.

## Topology

| Item | Value |
| --- | --- |
| Public origin | `https://opengravel.henning.rodeo` via Cloudflare Tunnel: container `legacy-shared-services-cloudflared-1` → `http://172.23.0.1:3200` (the unit's ExecStartPre opens 3200 to 172.23.0.0/16 and the LAN) |
| Application host | homelab `docker-dev` (Proxmox LXC, 8 GB RAM) |
| Node | 24.x, unpacked at `/opt/opengravel-node24` |
| Process manager | systemd `ogv.service` + drop-in `/etc/systemd/system/ogv.service.d/opengravel.conf` |
| Listen | `0.0.0.0:3200` (`next start`) |
| GraphHopper | `http://127.0.0.1:8989` on the same host (PA/NJ graph) |
| Environment / secrets | `/etc/opengravel/ogv.env` (`EnvironmentFile`, also sourced at build time for `NEXT_PUBLIC_*`) |
| Persistent data | `/var/lib/opengravel` (shares, community, feedback SQLite, release pointer), `/root/Vibe/opengravel-data` (offline regions, basemap, Discover index, road-authority cache) |
| Release root | `/root/Vibe/wt/og-release-<sha12>`: one git worktree per commit of `OneBigHen/OpenGravel`, each with its own `node_modules` and `.next` |
| Current release | the drop-in's `WorkingDirectory`; previous one in `/var/lib/opengravel/previous-release` |

## Commands

```bash
infra/deploy/release.sh origin/main   # build, candidate smoke on :3299, promote, smoke, auto-rollback on failure
infra/deploy/rollback.sh              # back to /var/lib/opengravel/previous-release, no rebuild
infra/deploy/smoke.sh https://opengravel.henning.rodeo
```

Run them from any checkout on the host; they act on the release directories, never on the checkout itself.

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
