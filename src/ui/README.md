# `src/ui` — presentation

May import: application-facing view models/actions, shared domain types for
display.

May **not**:

- call GraphHopper/TomTom or any routing provider directly
- mutate storage directly
- perform ranking or decide eligibility
- write `RideDocument` fields outside command dispatch

The map is a renderer/interaction adapter: it consumes a declarative `MapScene`
and emits typed `MapIntent` events. It must never import RideDocument store
setters (architecture rule C).
