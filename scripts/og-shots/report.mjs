/** @typedef {{content: string, frame?: string, durationMs: number}} ShotRun */
/** @typedef {{state: string, device: string, theme: string, runs: ShotRun[], error: string | null, maxDiffPercent: number | null}} Shot */
/** @typedef {{commit: string, branch: string, target: string, devices: string[], themes: string[], map: string, repeat: number, states: string[]}} Options */
/** @param {Options} options */
export function makeManifest(options) {
  return { ...options, startedAt: new Date().toISOString(), finishedAt: null, shots: /** @type {Shot[]} */ ([]), errors: /** @type {string[]} */ ([]) };
}
/** @param {Uint8Array} a @param {Uint8Array} b @param {number} width @param {number} height */
export function comparePixels(a, b, width, height) {
  if (!width || !height || a.length !== width * height * 4 || a.length !== b.length) throw new Error("Screenshot dimensions do not match");
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) changed++;
  return changed * 100 / (width * height);
}
/** @param {unknown} value */
function escape(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
/** @param {ReturnType<typeof makeManifest>} report */
export function gallery(report) {
  const columns = report.devices.flatMap(device => report.themes.map(theme => ({ device, theme })));
  const cards = report.states.map(state => `<section><h2>${escape(state)}</h2><div class="grid">${columns.map(({ device, theme }) => {
    const shot = report.shots.find(s => s.state === state && s.device === device && s.theme === theme);
    if (!shot || shot.error || !shot.runs.length) return `<article class="failed"><h3>${escape(device)} · ${escape(theme)}</h3><p>${escape(shot?.error || "Capture did not run")}</p>${shot?.failure ? `<a href="${escape(shot.failure)}"><img loading="lazy" src="${escape(shot.failure)}" alt="Screen at failure"></a>` : ""}</article>`;
    const first = shot.runs[0];
    return `<article><h3>${escape(device)} · ${escape(theme)}</h3><a href="${escape(first.content)}"><img loading="lazy" src="${escape(first.content)}" alt="${escape(state)} on ${escape(device)}"></a><p>${shot.maxDiffPercent === null ? "One capture" : `Max pixel difference: ${shot.maxDiffPercent.toFixed(3)}%`}${shot.retries ? ` · needed retries: ${escape(shot.retries.length)}` : ""}${first.frame ? ` · <a href="${escape(first.frame)}">Full device frame</a>` : ""}</p></article>`;
  }).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenGravel screenshots</title><style>body{font:16px system-ui,sans-serif;margin:0;background:#f5f3ef;color:#19201c}header,main{padding:16px;max-width:1800px;margin:auto}header{background:#26392f;color:white}h1{font-size:1.4rem}h2{font-size:1.15rem;margin-top:2rem}.grid{display:grid;grid-template-columns:repeat(${columns.length},minmax(180px,1fr));gap:12px;overflow-x:auto}article{background:white;border:1px solid #ccc;border-radius:8px;padding:8px;min-width:0}article.failed{background:#ffe6e6;border-color:#c22;color:#751717;overflow-wrap:anywhere}h3{font-size:.95rem;margin:.3rem 0 .6rem}img{display:block;width:100%;height:auto}p{line-height:1.4}a{color:#175d83}header p{overflow-wrap:anywhere}</style><header><h1>OpenGravel screenshots</h1><p>${escape(report.commit)} · ${escape(report.branch)} · ${escape(report.startedAt)}<br>${escape(report.target)} · ${escape(report.map)} map</p></header><main>${cards}</main></html>`;
}
