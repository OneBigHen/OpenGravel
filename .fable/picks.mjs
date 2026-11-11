// Owner picks: side-by-side prototypes over production (read-only; CSS and the
// night style are swapped in this browser only). Run from the worktree:
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node .fable/picks.mjs OUTDIR
import { chromium } from "@playwright/test";

const out = process.argv[2];
const base = "https://opengravel.henning.rodeo";
const STATE_COLLEGE = { latitude: 40.7934, longitude: -77.86 };
const ROTHROCK = { latitude: 40.72, longitude: -77.78 };

// P1: selected segments neutral (raised surface, ink text); green only on the action.
const P1 = `
.og-style__chip input:checked + span,
.og-phone-style__chip input:checked + span,
.og-settings__segment[aria-checked="true"],
.og-rides__segment[aria-pressed="true"],
.og-layers__option[aria-pressed="true"] {
  background: var(--og-surface) !important;
  color: var(--og-ink) !important;
  box-shadow: 0 0 0 1px var(--og-line-strong), 0 1px 3px hsl(155 35% 7% / 18%) !important;
  font-weight: 700 !important;
}`;

// P3: glass only over the map. Pages without a map go solid on the topo backdrop.
const P3 = `
:root, :root[data-theme] { --og-glass: var(--og-surface) !important; --og-glass-dense: var(--og-surface) !important; }
*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`;

// P2: our own dark terrain night map, prototyped by recolouring Mapbox Outdoors
// (forest, hillshade, contours, tracks kept) in place of navigation-night-v1.
function parse(c) {
  if (typeof c !== "string") return null;
  let m;
  if ((m = /^hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c)))
    return { h: +m[1], s: +m[2] / 100, l: +m[3] / 100, a: m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4] };
  let r, g, b, a = 1;
  if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(c))) [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  else if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c))) { const x = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1]; [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); }
  else if (c === "white") [r, g, b] = [255, 255, 255];
  else if (c === "black") [r, g, b] = [0, 0, 0];
  else return null;
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); }
  return { h: (h + 360) % 360, s, l, a };
}
const fmt = ({ h, s, l, a }) => `hsla(${h.toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%, ${a})`;
function darken(value, kind) {
  if (Array.isArray(value)) return value.map((v) => darken(v, kind));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, darken(v, kind)]));
  const c = parse(value);
  if (!c) return value;
  if (kind === "road") return fmt({ ...c, s: c.s * 0.5, l: 0.2 + c.l * 0.3 });
  if (kind === "text") return fmt({ ...c, s: c.s * 0.6, l: 0.92 - c.l * 0.75 });
  return fmt({ ...c, s: Math.min(c.s, 0.4) * 0.8, l: 0.07 + (1 - c.l) * 0.5 });
}
function nightTerrain(style) {
  for (const layer of style.layers) {
    if (!layer.paint || layer.type === "hillshade") continue;
    const roadish = layer.type === "line" && /road|street|bridge|tunnel|path|track/.test(layer.id);
    for (const key of Object.keys(layer.paint)) {
      if (!/color/.test(key)) continue;
      const kind = /^text-color|^icon-color/.test(key) ? "text" : /halo/.test(key) ? "bg" : roadish ? "road" : "bg";
      layer.paint[key] = darken(layer.paint[key], kind);
    }
  }
  return style;
}

const b = await chromium.launch();
async function ctx(device, theme, where = STATE_COLLEGE) {
  const phone = device === "phone";
  return b.newContext({
    viewport: phone ? { width: 440, height: 956 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone, colorScheme: theme,
    geolocation: where, permissions: ["geolocation"], locale: "en-US", timezoneId: "America/New_York",
  });
}
async function settle(p, ms = 5000) { await p.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(ms); }
async function shot(p, name) { await p.screenshot({ path: `${out}/${name}.png` }); console.log(name); }

const ONLY = process.env.PICKS ? process.env.PICKS.split(",") : ["1","2","3"];
// Pick 1: selected buttons. Desktop rail + phone loop chooser, both themes.
if (ONLY.includes("1")) for (const theme of ["light", "dark"]) for (const device of ["desktop", "phone"]) for (const [tag, css] of [["A-green", ""], ["B-neutral", P1]]) {
  const c = await ctx(device, theme); const p = await c.newPage();
  await p.goto(base + "/"); await settle(p);
  if (css) await p.addStyleTag({ content: css });
  if (device === "phone") { await p.getByTestId("loop-near-me").click().catch(() => {}); await settle(p, 2500); }
  await shot(p, `pick1-${device}-${theme}-${tag}`); await c.close();
}

// Pick 2: night map. Two places, two zooms.
if (ONLY.includes("2")) for (const [where, pos] of [["statecollege", STATE_COLLEGE], ["rothrock", ROTHROCK]]) for (const [tag, swap] of [["A-mapbox-night", false], ["B-own-dark-terrain", true]]) {
  const c = await ctx("desktop", "dark", pos); const p = await c.newPage();
  if (swap) await p.route(/styles\/v1\/mapbox\/navigation-night-v1(\?|$)/, async (route) => {
    const res = await route.fetch({ url: route.request().url().replace("navigation-night-v1", "outdoors-v12") });
    await route.fulfill({ response: res, json: nightTerrain(await res.json()) });
  });
  await p.goto(base + "/"); await settle(p, 7000);
  await p.getByText("Loading map").waitFor({ state: "hidden", timeout: 60000 }).catch(() => console.log("map still loading"));
  // Zoom out to a regional view first, so forest, ridges and gravel show.
  { const m = p.getByTestId("planner-map"); const bx = await m.boundingBox();
    await p.mouse.move(bx.x + bx.width * 0.6, bx.y + bx.height / 2);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(250); } }
  await settle(p, 6000);
  await shot(p, `pick2-${where}-wide-${tag}`);
  const map = p.getByTestId("planner-map"); const box = await map.boundingBox();
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(250); }
  await settle(p, 6000);
  await shot(p, `pick2-${where}-close-${tag}`); await c.close();
}

// Pick 3: glass. Explore and Settings, phone, both themes.
if (ONLY.includes("3")) for (const theme of ["light", "dark"]) for (const path of ["/explore", "/settings"]) for (const [tag, css] of [["A-glass-everywhere", ""], ["B-glass-over-map-only", P3]]) {
  const c = await ctx("phone", theme); const p = await c.newPage();
  await p.goto(base + path); await settle(p);
  if (css) await p.addStyleTag({ content: css });
  await p.waitForTimeout(500);
  await shot(p, `pick3-${path.slice(1)}-${theme}-${tag}`); await c.close();
}
await b.close();
