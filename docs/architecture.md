# Architecture overview

OpenGravel separates ride planning from the map and from the services that supply data.

- **`src/domain`** contains ride documents, planning rules, route evaluation, and ride-session behavior. It has no browser or provider SDK dependency.
- **`src/application`** coordinates typed ride commands, planning attempts, projections, and provider-neutral ports.
- **`src/infrastructure`** implements those ports: browser storage, map rendering, geocoding, routing, weather, and optional places/advisor services.
- **`src/ui`** renders the planner and ride views. Map events become typed intents; they do not save or select routes on their own.
- **`src/server`** validates requests and connects them to server-side providers. Credentials stay on the server.

Ride plans and saved rides live in the browser by default. A planning request goes through the same-origin API, where the configured routing service proposes candidates and the application evaluates them. Fixture mode is available for local demos and tests; its routes are explicitly marked as simulated.

Useful entry points:

- Planner page: `src/app/page.tsx`
- Domain and application types: `src/domain/` and `src/application/`
- Map rendering: `src/infrastructure/map/maplibre/`
- API routes: `src/app/api/`
- Tests: `tests/unit/`, `tests/integration/`, `tests/architecture/`, and `tests/e2e/`
