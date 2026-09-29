# Vendored MapLibre worker

`maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` are verbatim copies of the
files MapLibre GL v6 ships in `node_modules/maplibre-gl/dist/`.

They are served from here because MapLibre builds its worker URL from a dynamic
expression (`new URL(\`./${dev ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs"}\`,
import.meta.url)`), which no bundler can resolve statically:

- **Turbopack** emits the worker as a hashed asset under `_next/static/media` and
  leaves the worker's own `import "./maplibre-gl-shared.mjs"` unrewritten, so the
  worker 404s on its dependency.
- **webpack** resolves the URL to the page itself, so the worker never starts.

In both cases the failure is silent: the map paints its background and every
GeoJSON source — including OpenGravel's own routes, points and avoid areas —
stays unparsed forever. `src/infrastructure/map/maplibre/host.ts` therefore calls
`maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs")` before it
creates the map, and this directory provides the two files under the names the
worker's relative import expects.

Refresh them after changing the `maplibre-gl` version:

```sh
npm run vendor:maplibre
```

`tests/unit/infrastructure/maplibre/vendored-worker.test.ts` fails if these files
drift from the installed package, so a version bump cannot leave a stale worker
behind. The files are third-party build output and are excluded from lint
(`eslint.config.mjs`); the copies are checked for byte equality instead of being
reformatted.

License: MapLibre GL JS is BSD-3-Clause; the license header is retained in
`maplibre-gl-worker.mjs` and the package's own `LICENSE.txt` ships with the
dependency.
