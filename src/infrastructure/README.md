# `src/infrastructure` — adapters implementing ports

Implements ports defined by the application layer. May depend on concrete
technologies: Mapbox GL, GraphHopper HTTP, Dexie/IndexedDB, server APIs,
telemetry SDKs.

Must **not** define product policy (no scoring, eligibility, role assignment,
or selection logic here), and must not import planner store setters or UI
components. Adapters translate; OpenGravel decides.

Key subdirectories (per `02-ARCHITECTURE-CONTRACT.md` §6):

- `routing/graphhopper`, `routing/valhalla`, `routing/tomtom`
- `map/mapbox`, `map/basic`
- `storage`, `identity`, `telemetry`, `weather`, `geocoding`, `workers`
