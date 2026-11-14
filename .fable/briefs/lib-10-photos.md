# L10: See the road before you go (parked until the library has photos)

**Rider sentence:** "I see what the road looks like before I go."
**Worker:** Sonnet. **Size:** S. **Needs:** the library session delivers `media.photos` with credit and a
per-photo `host` or `link` rule (0 photos on 2026-11-13). Do not start before the pack report shows photos.
Rules: `.fable/briefs/lib-0-rules.md`. Plan sections 5.4 (item 5) and 8.

## Why
A photo is the fastest way to tell a rider what a road is. The record shape already has `media.photos[]`
(`url`, `credit`, `caption`) and `media.videos[]`. Nothing is collected yet, and photos carry their own rights,
separate from the track's.

## Build
1. **Builder:** copy at most 3 photos per ride into the pack only when the photo's rule is `host`: resize with
   `sharp` (already a dependency) to 960 px wide WebP, at most 120 KB each, stored as assets
   `photo/<id>/<n>`. A `link` photo is never copied and never hot-linked as an image; it becomes a text link,
   "Photos at <source>". Budget: the pack may grow to 400 MB at most; the gate fails above it.
2. **Endpoint:** `GET /api/route-library/<version>/photo/<id>/<n>.webp`, immutable cache.
3. **Ride page:** one photo strip above "About this ride": up to 3 photos, 4:3, swipe on a phone, each with its
   credit as a caption-sized line ("Photo by <name> · <source>"), lazy-loaded, fixed height so nothing jumps.
   Videos are a link row, "Video at <source>", never an embedded player.
4. **Cards and the map stay as they are:** no photo thumbnails in lists (one request per row is the cost the
   line-shape thumbnail avoids).
5. A photo with no credit is not shown. A photo that fails to load collapses its slot; the strip disappears
   when none load.

## Files
`scripts/route-library/build-pack.ts`, `src/app/api/route-library/[version]/photo/[id]/[file]/route.ts`,
`src/ui/explore/routes-detail/PhotoStrip.tsx`, `src/ui/explore/routes-detail.css` (at most 50 more lines).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/ui` passes, with cases: a `link` photo is absent from the
  pack and renders as a link; a photo without credit is dropped and counted in the report; more than 3 keeps
  the first 3; the strip is not rendered for a ride with no photos; the pack-size gate trips on a crafted fixture.
- Real build: paste photo counts (hosted, linked, dropped) and the new pack size against the 400 MB budget and
  the free space on docker-stable.
- Shots at 390 x 844 and 320 x 568, Day and Night: a ride page with 3 photos, with 1 photo, and with only a
  "Photos at <source>" link. No layout shift when photos arrive (state the measured shift).
- `npm run typecheck`, `npm run lint`, `npm run css:budget` pass.
