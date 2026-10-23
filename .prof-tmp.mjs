import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const pg = await ctx.newPage(); const cdp = await ctx.newCDPSession(pg);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await pg.goto(process.argv[2], { waitUntil: 'load' }); await pg.waitForTimeout(7000);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map(n => [n.id, n])); const self = new Map();
const dt = profile.timeDeltas; profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
const byUrl = {}, byFn = {};
for (const [id, us] of self) { const n = byId.get(id); const cf = n.callFrame; const u = (cf.url.split('/').pop() || cf.functionName || '(native)').slice(0, 40);
  byUrl[u] = (byUrl[u] ?? 0) + us; const k = `${cf.functionName || '(anon)'} @${u}:${cf.lineNumber}`; byFn[k] = (byFn[k] ?? 0) + us; }
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${Math.round(v / 1000)}ms  ${k}`).join('\n');
console.log('BY SCRIPT\n' + top(byUrl) + '\n\nBY FUNCTION\n' + top(byFn));
await b.close();
