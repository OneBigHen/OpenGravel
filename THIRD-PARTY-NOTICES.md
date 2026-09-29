# Third-party notices

## Route library and photos

`data/catalog/routes.json.gz` and `public/catalog-media/pa-adventure-bike-rides/` contain 112 motorcycle routes, trail notes, comments and photos shared by riders:

- **95 routes** from members of the [PA Adventure Bike Rides](https://www.facebook.com/groups/214850105910753/) community. Each route links to its original post.
- **17 routes** from the [Roost](https://roostlocker.com/) GPX locker.

Rider names, commenter names and people tagged in posts are removed. Close-up photos of people and screenshots showing member names are left out. Surface and curvature figures are OpenGravel estimates, not the authors' claims.

This content is **not** licensed under the project's AGPL. It remains the work of the riders who shared it, and the sources did not state a license. It is included so the app works out of the box with real rides; do not redistribute it separately. If you shared one of these routes or photos and want it credited differently or removed, open an issue or contact the maintainer through [SECURITY.md](SECURITY.md), and it will be taken out.

Ride at your own judgement. Some roads close seasonally, and gates, closures and conditions change.

## OpenStreetMap data in test fixtures

`tests/fixtures/offline-regions/lehigh-fixture/` and `tests/fixtures/basemap/lehigh-fixture.pmtiles` contain a small clipped Pennsylvania road and basemap fixture derived from OpenStreetMap data supplied by [Geofabrik](https://download.geofabrik.de/north-america/us/pennsylvania.html). The source snapshot date and coverage are recorded in the region manifest.

Attribution: **© OpenStreetMap contributors**. The fixture data is available under the [Open Database License 1.0 (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). It is included for automated tests; it is not a ride catalog or navigation recommendation. This data has its own license and is not relicensed under the project's AGPL.
