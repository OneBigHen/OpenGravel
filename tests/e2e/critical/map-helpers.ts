/**
 * Shared browser-gate helpers for the planner map (05 §2–§9).
 *
 * ## How a click on the map becomes a coordinate
 *
 * The renderer is MapLibre now, so a pixel is only meaningful against the camera
 * that is on screen at that moment. The host therefore publishes the camera it
 * actually fitted as `data-map-extent="minLon,minLat,maxLon,maxLat"` (updated on
 * every `moveend`), and this module inverts that rectangle exactly the way the
 * renderer's own projection does:
 *
 * ```text
 * data-map-extent ──Mercator in y, linear in x──► lon/lat
 *   lon = minLon + fractionX · (maxLon − minLon)
 *   lat = mercatorLat(mercY(maxLat) − fractionY · (mercY(maxLat) − mercY(minLat)))
 * ```
 *
 * Longitude is linear in a Mercator view, so that half is exact. Latitude is
 * linear in *Mercator y*, and **not** in latitude: reading it linearly — which this
 * helper used to do, on the claim that the error was below the gate's tolerance —
 * is off by ~0.012° over the baseline region's ~1.5° span, i.e. ~8 px at this
 * viewport. That is larger than the 0.01° the assertions allow, and it is what made
 * a placement land a few pixels away from the coordinate the click asked for. The
 * inverse is therefore computed in Mercator, and the round trip through a real
 * click is exact to a pixel (~0.003°).
 *
 * So the gate never clicks "somewhere on the map": it reads the rendered extent,
 * clicks a documented fraction of it, and asserts the coordinate the app derived
 * from that fraction.
 *
 * ## Why the extent has to settle first
 *
 * The camera animates (a mounted fit, a committed route, "Show whole ride"), and
 * `data-map-extent` changes while it does. `settledExtent` waits for the value to
 * stop changing before a click is measured against it, and `data-map-camera`
 * (a counter bumped on every completed move) is the cheap way to wait for a moved
 * camera.
 *
 * Settling alone is still not enough under CPU pressure: "two equal consecutive
 * reads" can both be of a frame that has not begun its committed fit, so the
 * question "does this camera show the coordinate I am about to click" is asked
 * **repeatedly, for a bounded time** — `settledExtentShowing` — rather than once.
 * The assertion keeps its meaning (a drifted camera still fails) and loses only
 * its instant in time.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export interface Coordinate {
  readonly lon: number;
  readonly lat: number;
}

export interface Extent {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface Fraction {
  readonly x: number;
  readonly y: number;
}

/** Attribute names the host publishes; they are the gate's contract with it. */
export const MAP_EXTENT_ATTRIBUTE = "data-map-extent";
export const MAP_CAMERA_ATTRIBUTE = "data-map-camera";
export const MAP_SCENE_ATTRIBUTE = "data-map-scene";
/**
 * The renderer's own failure attribute: a comma-separated list of machine-readable
 * kinds (`worker`, `style`, `source`, `tile`, `renderer`, `webgl-unavailable`, …)
 * the host writes when MapLibre reports a failure (05 §22, 4.0 review finding 1).
 */
export const MAP_ERROR_ATTRIBUTE = "data-map-error";
/**
 * The renderer's own load health (4.0s): `loading` | `ready` | `retrying` |
 * `failed`. The gate waits for the *map*, not for a timeout: `ready` means the
 * style loaded and the renderer produced data for it.
 */
export const MAP_LOAD_ATTRIBUTE = "data-map-load";
/** Why the load is pending or failed, as a machine-readable kind (4.0s). */
export const MAP_LOAD_REASON_ATTRIBUTE = "data-map-load-reason";
/**
 * The class of the container child one renderer attempt owns (4.0s).
 *
 * A recovery replaces the renderer in place, in a fresh child, so counting these
 * is how a gate proves a retry never stacked a second canvas.
 */
export const MAP_ATTEMPT_CLASS = "og-map__attempt";

/**
 * The two vendored MapLibre modules, at the paths the host registers.
 *
 * MapLibre builds its worker URL from a dynamic expression, so no bundler emits a
 * loadable worker chunk and the app serves these two files itself. A 404 here is
 * the silent failure the review found: the map draws its background, publishes
 * `data-basemap` and `data-map-scene`, and every GeoJSON source stays unparsed.
 */
export const VENDORED_MAP_MODULES = [
  "/vendor/maplibre/maplibre-gl-worker.mjs",
  "/vendor/maplibre/maplibre-gl-shared.mjs",
] as const;

/** The design tokens the cartography draws routes with (12 §9, 05 §11). */
export const EMBER = "#d65a36";
export const EMBER_STRONG = "#bf4829";
export const SLATE = "#68716f";
export const PAPER = "#fbf9f4";

export function plannerMap(page: Page): Locator {
  return page.getByTestId("planner-map");
}

/** The extent the renderer is currently showing, or `null` before it has one. */
async function readExtentOrNull(page: Page): Promise<Extent | null> {
  const raw = await plannerMap(page).getAttribute(MAP_EXTENT_ATTRIBUTE);
  if (raw === null) return null;
  const [minLon, minLat, maxLon, maxLat] = raw.split(",").map(Number);
  if (
    minLon === undefined ||
    minLat === undefined ||
    maxLon === undefined ||
    maxLat === undefined ||
    [minLon, minLat, maxLon, maxLat].some((value) => Number.isNaN(value))
  ) {
    throw new Error(`"${raw}" is not a rendered extent`);
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** The extent the renderer is currently showing. */
export async function readExtent(page: Page): Promise<Extent> {
  const extent = await readExtentOrNull(page);
  if (extent === null) {
    throw new Error(`the map has not published ${MAP_EXTENT_ATTRIBUTE}`);
  }
  return extent;
}

function sameExtent(a: Extent, b: Extent): boolean {
  return (
    a.minLon === b.minLon && a.minLat === b.minLat && a.maxLon === b.maxLon && a.maxLat === b.maxLat
  );
}

/** A rendered box, in CSS pixels: what a click's pixel position is measured in. */
interface Box {
  readonly width: number;
  readonly height: number;
}

/** Sub-pixel layout churn is not a camera move, so the box is compared at 0.5 px. */
function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/**
 * Waits until the renderer has published a camera **and its own box has stopped
 * changing**, then returns the extent it settled on.
 *
 * The extent alone is not enough evidence that a click is meaningful, and the
 * gate learned that the hard way: the planner's composition measures itself and
 * re-fits, and the sheet's content (the object list, the avoid-area list) settles
 * over the first second or two after load. While the *map's own rectangle* is
 * still growing, a fixed zoom means the published latitude span grows with it — two
 * equal consecutive reads of the extent can therefore both be true and both stale,
 * and a click measured against them lands one or two pixels of layout away from
 * the geography it asked for.
 *
 * So the settle condition is the pair: the same extent *and* the same rendered box
 * across consecutive samples. The attribute does not exist at all until the
 * renderer has loaded its style and finished its opening fit, which is the other
 * half of the same question.
 */
export async function settledExtent(page: Page): Promise<Extent> {
  let previous: { readonly extent: Extent; readonly box: Box } | null = null;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const extent = await readExtentOrNull(page);
    const measured = await plannerMap(page).boundingBox();
    const box =
      measured === null ? null : { width: measured.width, height: measured.height };
    if (
      extent !== null &&
      box !== null &&
      previous !== null &&
      sameExtent(extent, previous.extent) &&
      sameBox(box, previous.box)
    ) {
      return extent;
    }
    previous = extent === null || box === null ? null : { extent, box };
    await page.waitForTimeout(60);
  }
  throw new Error("the map camera never settled");
}

export interface MapLoadReport {
  readonly state: string | null;
  readonly reason: string | null;
}

/** What the renderer says about its own load, right now. */
export async function readMapLoad(page: Page): Promise<MapLoadReport> {
  const map = plannerMap(page);
  return {
    state: await map.getAttribute(MAP_LOAD_ATTRIBUTE),
    reason: await map.getAttribute(MAP_LOAD_REASON_ATTRIBUTE),
  };
}

/**
 * Waits until the map's load has settled: `ready` or `failed` (4.0s).
 *
 * Deliberately *not* a wait for `ready`: a load that fails honestly is a pass for
 * this helper and a fact for the caller, which is what makes "the map is blank and
 * says nothing" — a state that used to last forever — into a timeout the gate
 * reports.
 */
export async function settledMapLoad(page: Page, timeoutMs = 30_000): Promise<MapLoadReport> {
  const deadline = Date.now() + timeoutMs;
  let last: MapLoadReport = { state: null, reason: null };
  while (Date.now() < deadline) {
    last = await readMapLoad(page);
    if (last.state === "ready" || last.state === "failed") return last;
    await page.waitForTimeout(200);
  }
  throw new Error(
    `the map never settled its load within ${timeoutMs}ms (last state: ${JSON.stringify(last)})`,
  );
}

/**
 * How many renderer attempts are mounted in the map container (4.0s).
 *
 * At most one, ever: a self-healing host replaces its renderer inside a fresh
 * child rather than adding a second map beside the first.
 */
export async function rendererAttemptCount(page: Page): Promise<number> {
  return plannerMap(page).evaluate(
    (element, className: string) => element.querySelectorAll(`.${className}`).length,
    MAP_ATTEMPT_CLASS,
  );
}

/** The camera counter, which changes on every completed move. */
export async function cameraGeneration(page: Page): Promise<number> {
  const raw = await plannerMap(page).getAttribute(MAP_CAMERA_ATTRIBUTE);
  return raw === null ? 0 : Number(raw);
}

/** The Mercator y of a latitude, in the same units MapLibre's projection uses. */
function mercatorY(latitude: number): number {
  const clamped = Math.max(-85.051129, Math.min(85.051129, latitude));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

/** The latitude a Mercator y means: the inverse the renderer's `unproject` uses. */
function latitudeAtMercatorY(y: number): number {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);
}

/** The coordinate a fraction of the rendered extent means. */
export function coordinateAt(extent: Extent, fraction: Fraction): Coordinate {
  const top = mercatorY(extent.maxLat);
  const bottom = mercatorY(extent.minLat);
  return {
    lon: extent.minLon + fraction.x * (extent.maxLon - extent.minLon),
    lat: latitudeAtMercatorY(top - fraction.y * (top - bottom)),
  };
}

/** The fraction of the rendered extent that shows one coordinate. */
export function fractionOf(extent: Extent, coordinate: Coordinate): Fraction {
  const top = mercatorY(extent.maxLat);
  const bottom = mercatorY(extent.minLat);
  return {
    x: (coordinate.lon - extent.minLon) / (extent.maxLon - extent.minLon),
    y: (top - mercatorY(coordinate.lat)) / (top - bottom),
  };
}

/** Is a fraction inside the rendered rectangle? */
function insideExtent(fraction: Fraction): boolean {
  return fraction.x >= 0 && fraction.x <= 1 && fraction.y >= 0 && fraction.y <= 1;
}

/**
 * How long a settled camera is given to show a coordinate, and how often it is
 * asked while the gate waits (see `settledExtentShowing`).
 *
 * The *typical* wait is short — measured 8/8 at 0.2–1.7 s for the explore round
 * trip (2026-09-18) — but the budget is not the typical case. The host publishes
 * `data-map-extent` on `moveend` only (`host.ts`), and a fit animates
 * (`FIT_DURATION_MS = 450`, and much longer on a starved renderer), so a camera
 * that is still fitting leaves the *previous* extent in the attribute and reads as
 * settled. A 5 s bound produced a red in a full run after never seeing the
 * coordinate; 10 s keeps the bound honest for a fit that is still arriving, while
 * a camera that never shows the coordinate still fails with the same message.
 */
const SHOWING_TIMEOUT_MS = 10_000;
const SHOWING_POLL_MS = 200;

/** A settled camera that really shows the coordinate, and where it is on it. */
interface ShownCoordinate {
  readonly extent: Extent;
  readonly fraction: Fraction;
}

/**
 * Waits, bounded, for a **settled** camera that shows `coordinate`.
 *
 * The guard is unchanged and is deliberately still a failure: a camera that has
 * drifted somewhere else must not be clicked through. What changed is *when* the
 * gate asks. Asking once, instantly, is what made this the critical suite's load
 * flake: under CPU pressure (parallel agent lanes on one host) `settledExtent`
 * can honestly report two equal consecutive reads of a frame that has not begun
 * its committed fit yet — both samples true and both pre-fit — and the coordinate
 * is then "outside" a camera that is about to move onto it. So the camera is
 * re-asked every `SHOWING_POLL_MS` until it shows the coordinate, inside
 * `SHOWING_TIMEOUT_MS` (10 s: long enough for a fit that is still reaching the
 * renderer, bounded all the same). A camera that never shows it is the same
 * failure this helper has always reported, with the same message; nothing about
 * the check itself was relaxed.
 */
async function settledExtentShowing(
  page: Page,
  coordinate: Coordinate,
  timeoutMs = SHOWING_TIMEOUT_MS,
): Promise<ShownCoordinate> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const extent = await settledExtent(page);
    const fraction = fractionOf(extent, coordinate);
    if (insideExtent(fraction)) return { extent, fraction };
    if (Date.now() >= deadline) {
      throw new Error(
        `${coordinate.lat}, ${coordinate.lon} is outside the rendered extent — the camera no longer shows it`,
      );
    }
    await page.waitForTimeout(SHOWING_POLL_MS);
  }
}

/** Clicks `fraction` of the map box, against an extent the caller has settled. */
async function clickFractionOfExtent(
  page: Page,
  extent: Extent,
  fraction: Fraction,
): Promise<{ readonly coordinate: Coordinate; readonly extent: Extent }> {
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");

  await map.click({
    position: { x: Math.round(fraction.x * box.width), y: Math.round(fraction.y * box.height) },
  });
  return { coordinate: coordinateAt(extent, fraction), extent };
}

/**
 * Clicks one fraction of the visible map and returns the coordinate that fraction
 * means in the extent the camera had when the click was placed.
 */
export async function clickMapAtFraction(
  page: Page,
  fraction: Fraction,
): Promise<{ readonly coordinate: Coordinate; readonly extent: Extent }> {
  return clickFractionOfExtent(page, await settledExtent(page), fraction);
}

/**
 * Clicks the pixel currently showing `coordinate`.
 *
 * Used where the *geography* of the tap matters rather than its position on the
 * screen — e.g. placing a ride inside the area the fixture's canned geometry
 * occupies. The fraction is derived from the rendered extent, so the click is
 * exact whatever camera the tier opened with.
 *
 * The camera the click is measured against is the very one the coordinate was
 * verified on. The click used to re-settle the camera a second time, so a camera
 * that moved in between was validated against one extent and clicked against
 * another — a second, smaller race in the same pixel.
 */
export async function clickMapAtCoordinate(
  page: Page,
  coordinate: Coordinate,
): Promise<void> {
  const { extent, fraction } = await settledExtentShowing(page, coordinate);
  await clickFractionOfExtent(page, extent, fraction);
}

/**
 * Drags the map by `(dx, dy)` CSS pixels from `fraction` of its box.
 *
 * 05 §4: a drag is a camera gesture, and it must not place a point — which is
 * only testable by dragging and then asking the composer whether anything was
 * authored.
 */
export async function dragMap(
  page: Page,
  fraction: Fraction,
  delta: { readonly dx: number; readonly dy: number },
): Promise<void> {
  const map = plannerMap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the planner map has no measured box");

  const start = {
    x: Math.round(fraction.x * box.width),
    y: Math.round(fraction.y * box.height),
  };
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + start.x + delta.dx, box.y + start.y + delta.dy, { steps: 8 });
  await page.mouse.up();
}

/** What the renderer says it drew: `routes:2,points:2,selected:<id>,…`. */
export async function readDrawnScene(page: Page): Promise<Record<string, string>> {
  const raw = await plannerMap(page).getAttribute(MAP_SCENE_ATTRIBUTE);
  if (raw === null) throw new Error(`the map has not published ${MAP_SCENE_ATTRIBUTE}`);
  return Object.fromEntries(
    raw.split(",").map((entry) => {
      const [key, value] = entry.split(":");
      return [key ?? "", value ?? ""];
    }),
  );
}

/**
 * Waits until the renderer's published scene agrees with `expected`.
 *
 * The scene is applied in a React effect, which runs after the DOM the rider sees
 * — so a card can be on screen a frame before the renderer has been handed the
 * route. Polling is the honest way to assert on it, exactly as it is for a camera
 * that is still animating.
 */
export async function expectDrawnScene(
  page: Page,
  expected: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [key, value] of Object.entries(expected)) {
    await expect
      .poll(async () => (await readDrawnScene(page))[key], { timeout: 10_000 })
      .toBe(value);
  }
}

/**
 * Asserts no overlay layer failed to load.
 *
 * 05 §22: a custom-layer failure must mark only that layer unavailable — but a
 * gate should still see it. A rejected layer is silently absent for the rest of
 * the session (MapLibre refuses a layer whose source does not exist yet), which is
 * exactly the sort of failure a pixel assertion can miss.
 */
export async function expectNoLayerErrors(page: Page): Promise<void> {
  await expect(plannerMap(page)).not.toHaveAttribute("data-layer-error", /.*/);
}

/**
 * Asserts the renderer never reported a failure at all (05 §22).
 *
 * The layer-error attribute only covers a rejected `addLayer`; a worker, style,
 * source or tile failure arrives through MapLibre's own `error` event, which is
 * why the host publishes a second, machine-readable attribute. Without this
 * assertion the gate could pass on a map that draws nothing: absent overlays look
 * exactly like an empty ride.
 */
export async function expectNoMapErrors(page: Page): Promise<void> {
  await expect(plannerMap(page)).not.toHaveAttribute(MAP_ERROR_ATTRIBUTE, /.*/);
}

/** The renderer failure kinds the host has reported, or an empty list. */
export async function readMapErrorKinds(page: Page): Promise<readonly string[]> {
  const raw = await plannerMap(page).getAttribute(MAP_ERROR_ATTRIBUTE);
  return raw === null ? [] : raw.split(",");
}

/** Both halves of "the map is drawing": no layer error and no renderer error. */
export async function expectHealthyMap(page: Page): Promise<void> {
  await expectNoLayerErrors(page);
  await expectNoMapErrors(page);
}

/**
 * Fetches both vendored renderer modules and requires them to be served.
 *
 * The browser gate has to ask for the files itself: a failing worker request is
 * invisible to the DOM (the map simply never finishes loading its sources), and a
 * prefixed deployment can serve the page while 404ing every asset under the
 * worker's relative path. A `200` whose body is the app's HTML shell is a 404
 * wearing a different status code, so the body is checked too.
 */
export async function expectVendoredModulesServed(page: Page): Promise<void> {
  for (const modulePath of VENDORED_MAP_MODULES) {
    const response = await page.request.get(modulePath);
    expect(response.status(), `${modulePath} must be served`).toBe(200);
    const body = await response.text();
    expect(body.length, `${modulePath} must be a real module`).toBeGreaterThan(500);
    expect(body, `${modulePath} must not be the app shell`).not.toContain("<!DOCTYPE html>");
  }
}

/**
 * Counts the pixels of a screenshot that match each colour within a tolerance.
 *
 * This is real visual evidence that the cartography uses the design tokens — the
 * selected route is Ember over an Ember-Strong casing, which no DOM assertion can
 * prove now that the drawing is a WebGL canvas. The screenshot is decoded in the
 * page (an `Image` plus a 2D canvas), so the gate needs no image dependency.
 * Element screenshots are clipped page screenshots, so overlapping planner
 * controls are still composited over the canvas. Pass those controls in `masks`
 * when the census should describe map ink alone.
 *
 * Two measured details matter, and both are why the tolerance and the *order* of
 * `colors` are part of the call:
 *
 * - **First match wins**, so the tighter colour goes first. The casing is drawn
 *   under the selected line at 0.9 opacity, which blends it toward the paper
 *   background: at a 20-per-channel tolerance the casing and the Ember line are
 *   still separable (measured: ~1.4k casing vs ~1.6k Ember over the fixture
 *   route), while at 25 the casing swallows the line entirely.
 * - The tolerance is per channel and deliberately loose enough to absorb that
 *   blend and any screenshot colour management, and tight enough that the paper
 *   background never counts.
 */
export async function countColors(
  screenshotTarget: Locator,
  colors: Readonly<Record<string, string>>,
  tolerance = 20,
  masks: Locator[] = [],
): Promise<Record<string, number>> {
  const shot = await screenshotTarget.screenshot({
    ...(masks.length === 0 ? {} : { mask: masks, maskColor: "#00ff00" }),
  });
  return screenshotTarget.evaluate(
    async (
      element: HTMLElement,
      payload: { readonly png: string; readonly colors: Readonly<Record<string, string>>; readonly tolerance: number },
    ): Promise<Record<string, number>> => {
      void element;
      const image = new Image();
      image.src = `data:image/png;base64,${payload.png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("the page could not decode the screenshot");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;

      const channels = (hex: string): readonly number[] => [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
      ];
      const targets = Object.entries(payload.colors).map(
        ([name, hex]) => [name, channels(hex)] as const,
      );
      const counts: Record<string, number> = Object.fromEntries(
        Object.keys(payload.colors).map((name) => [name, 0]),
      );
      for (let index = 0; index < data.length; index += 4) {
        for (const [name, target] of targets) {
          if (
            Math.abs((data[index] ?? 0) - (target[0] ?? 0)) <= payload.tolerance &&
            Math.abs((data[index + 1] ?? 0) - (target[1] ?? 0)) <= payload.tolerance &&
            Math.abs((data[index + 2] ?? 0) - (target[2] ?? 0)) <= payload.tolerance
          ) {
            counts[name] = (counts[name] ?? 0) + 1;
            break;
          }
        }
      }
      return counts;
    },
    { png: shot.toString("base64"), colors, tolerance },
  );
}

/**
 * The second candidate's Plum (`#7b4fa0`) at 80% opacity over its paper casing
 * — how an alternative is drawn since route lines are colour-matched to their
 * cards (UX rework phase 2b).
 */
export const MUTED_ALTERNATIVE = "#9571b1";

/** Asserts a rendered coordinate is the one the click asked for (0.01° ≈ 1 km). */
export function expectCoordinateNear(actual: Coordinate, expected: Coordinate): void {
  expect(actual.lat).toBeCloseTo(expected.lat, 2);
  expect(actual.lon).toBeCloseTo(expected.lon, 2);
}

/** The label a placed, unnamed point renders as (`planner-view-model.ts`). */
export const DROPPED_PIN_LABEL = "Dropped pin";

/** The coordinate a placed point records at four decimals (`planner-view-model.ts`). */
export function pointLabel(coordinate: Coordinate): string {
  return `${coordinate.lat.toFixed(4)}, ${coordinate.lon.toFixed(4)}`;
}

export function parseCoordinate(label: string): Coordinate {
  const [lat, lon] = label.split(",").map((part) => Number.parseFloat(part.trim()));
  if (lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error(`"${label}" is not a rendered coordinate`);
  }
  return { lat, lon };
}

/**
 * Asserts the coordinate a value cell recorded, and that the cell names the point
 * rather than wearing the number as its name.
 *
 * The value cell shows two things now: the point's name (the rider's own, or
 * `Dropped pin`) and, beneath it, the coordinate at four decimals. The coordinate
 * is also written to the cell's `data-coordinate`, which is what these gates read
 * — parsing the visible text would only work while no name was present, and the
 * whole point of the defect fix is that a name is always present.
 */
export async function expectPointValue(
  page: Page,
  testId: string,
  coordinate: Coordinate,
): Promise<void> {
  const cell = page.getByTestId(testId);
  await expect(cell).toHaveAttribute("data-coordinate", pointLabel(coordinate));
  await expect(cell).toContainText(DROPPED_PIN_LABEL);
}

/** The `lat, lon` a value cell's coordinate attribute records. */
export async function readCoordinate(page: Page, testId: string): Promise<Coordinate> {
  const cell = page.getByTestId(testId);
  const recorded = await cell.getAttribute("data-coordinate");
  if (recorded !== null) return parseCoordinate(recorded);
  return parseCoordinate((await cell.textContent()) ?? "");
}

/**
 * Opens the "Refine route" disclosure (stops, avoid areas, road spans, draw) if
 * it is not already open. Idempotent: an armed tool holds it open and disables
 * the toggle, so an expanded section is left alone.
 */
export async function openRefine(page: Page): Promise<void> {
  const toggle = page.getByTestId("refine-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
