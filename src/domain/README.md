# `src/domain` — pure domain layer

VNext architecture rule A (`contracts/architecture-rules.md`): this layer is
**framework-free**. Forbidden imports under `src/domain/**`:

- `react`, `next`
- `zustand`
- `mapbox-gl`, `maplibre-gl`
- `dexie`
- `posthog-*`
- anything under `src/ui/**`, `src/infrastructure/**`, `src/app/**`

Domain modules may import other domain modules and pure utilities only.

The domain owns the authored truth: `RideDocument`, typed commands, history,
evidence value semantics, route/road types. It must stay portable to a future
native shell (decision VNX-028).
