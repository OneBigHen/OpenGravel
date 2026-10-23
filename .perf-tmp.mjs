import { chromium } from '@playwright/test';
const base = process.argv[2]; const pages = process.argv.slice(3);
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
for (const p of pages) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage(); const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8 * 4, uploadThroughput: 750e3 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = { script: 0, css: 0, fetch: 0, other: 0 };
  cdp.on('Network.loadingFinished', e => { const t = types.get(e.requestId) ?? 'other'; bytes[t] = (bytes[t] ?? 0) + e.encodedDataLength; });
  const types = new Map(); cdp.on('Network.responseReceived', e => types.set(e.requestId, e.type === 'Script' ? 'script' : e.type === 'Stylesheet' ? 'css' : (e.type === 'Fetch' || e.type === 'XHR') ? 'fetch' : 'other'));
  await pg.addInitScript(() => { window.__lt = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => { const e = l.getEntries(); window.__lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  const t0 = Date.now(); await pg.goto(base + p, { waitUntil: 'load', timeout: 90000 }); const load = Date.now() - t0;
  await pg.waitForTimeout(6000);
  const m = await pg.evaluate(() => ({ lcp: Math.round(window.__lcp ?? -1), tbt: Math.round(window.__lt), fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1) }));
  const kb = Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)]));
  console.log(JSON.stringify({ page: p, load_ms: load, ...m, kb }));
  await ctx.close();
}
await b.close();
