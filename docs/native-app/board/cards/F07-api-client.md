---
id: F07
title: OGAPI: generated Swift client and OpenGravelAPI facade
assignee: ogv-builder
parents: [F02, F06]
priority: 80
max_runtime: 2h
---
# F07 · Swift API client

## Read first
ENGINEERING §5, `contracts/openapi/opengravel-app.yaml`.

## Build
- OGAPI uses the swift-openapi-generator build plugin, with `openapi-generator-config.yaml` (types plus client, `accessModifier: package`) and a symlink or copy step that keeps the package reading `contracts/openapi/opengravel-app.yaml`. If a symlink breaks the plugin, use a pre-build script that copies the file and fails if it is out of date.
- `OpenGravelAPI` (public facade, `@MainActor`-free, `Sendable`):
  - one async method per v1 endpoint, returning OGCore domain models (add the models to OGCore: `RoutePlan`, `RouteCandidate`, `Evidence`, `Place`, `CatalogRoute`, `WeatherGlance` and so on), not generated types;
  - base URL from `ServerConfig` (default production origin, override in settings);
  - timeouts 15 s, 30 s for route-plan;
  - typed `APIError` with `offline`, `timeout`, `server(status)`, `decoding`, `rateLimited`.
- Mapping tests decode `apps/iphone/fixtures/api/*.json`, recorded from the server's fixture mode by `scripts/record-fixtures.sh`, which you write.

## Acceptance checks
- [ ] `gate.sh --ci` passes on CI (the F04 check).
- [ ] Each v1 endpoint has a mapping test from a recorded fixture.
- [ ] Offline (`URLError.notConnectedToInternet`) maps to `APIError.offline`, covered by a test.
