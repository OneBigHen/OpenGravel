# `src/application` — use-case orchestration

The application layer coordinates domain state with infrastructure ports.

May import: `src/domain/**`, port interfaces (`src/application/**` or
`src/infrastructure/**/ports`).

May **not** import:

- React components
- concrete Mapbox implementation
- concrete provider secrets / concrete routing adapters
- direct IndexedDB APIs

This layer owns `PlanningSession`, `RideSession` (application facets), the
planner controller, view-model builders, and the candidate pipeline policy
(normalization → eligibility → enrichment → scoring → diversity → roles).
OpenGravel owns decisions here; providers only propose.
