#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { makeManifest, gallery, comparePixels } from "./report.mjs";
import { safariDriver, playwrightDriver, startTunnel } from "./drivers.mjs";
import { journey, states as allStates } from "./journeys.mjs";

const devices = {
  iphone17: { udid: "26402658-0AA6-4EDA-9658-2C40A434D82B" },
  iphone16e: { udid: "7ADA9A3E-62CE-4BCA-99A4-64A001CFD9A3" },
  iphone17promax: { udid: "153D0C67-FE16-4A75-B7EB-5677A53AD31B" },
  ipad11: { udid: "FB3FB66B-5D6E-4AF9-84E2-EA175F77BADC" },
  desktop: { viewport: { width: 1440, height: 900 } },
  "chromium-320": { viewport: { width: 320, height: 568 } },
};
const defaults = { target: "local", devices: "iphone17,desktop", themes: "light,dark", map: "fixture", repeat: "1", states: allStates.join(",") };
function options(args) {
  const raw = { ...defaults };
  for (let i = 0; i < args.length; i++) { const flag = args[i]; if (flag === "--help") { console.log("og-shots [--target local|URL] [--devices iphone17,desktop] [--themes light,dark] [--map fixture|real] [--repeat N] [--states name,...]"); process.exit(0); } const key = flag?.startsWith("--") ? flag.slice(2) : ""; if (!(key in raw) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Invalid option ${flag}`); raw[key] = args[++i]; }
  const selectedDevices = raw.devices.split(","), themes = raw.themes.split(","), states = raw.states.split(","), repeat = Number(raw.repeat);
  if (new Set(selectedDevices).size !== selectedDevices.length || selectedDevices.some(d => !devices[d])) throw new Error("Unknown or duplicate device");
  if (new Set(themes).size !== themes.length || themes.some(t => !["light", "dark"].includes(t))) throw new Error("Unknown or duplicate theme");
  if (new Set(states).size !== states.length || states.some(s => !allStates.includes(s))) throw new Error("Unknown or duplicate state");
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 20) throw new Error("--repeat must be an integer from 1 to 20");
  if (!["fixture", "real"].includes(raw.map)) throw new Error("--map must be fixture or real");
  if (raw.target !== "local") { const url = new URL(raw.target); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--target must be an HTTP(S) origin without credentials or a path"); }
  return { ...raw, devices: selectedDevices, themes, states, repeat };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { for (;;) { const server = createNetServer(); await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); if (port !== 3200 && port !== 3210) return port; } }
async function run(command, args, env) { const child = spawn(command, args, { env, stdio: "inherit" }); const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); }); if (code !== 0) throw new Error(`${command} exited with ${code}`); }
async function localServer(map) {
  await run("npm", ["run", "build"], process.env);
  const nextPort = await freePort(), proxyPort = await freePort();
  const env = { ...process.env, OGV_ROUTE_PLAN_FIXTURE: "1", OGV_RATE_LIMIT_UNLIMITED: "1", OGV_CATALOG_FIXTURE: "1", COMMUNITY_DB_PATH: ":memory:", OGV_SHARE_DB_PATH: join(tmpdir(), `og-shots-${process.pid}.sqlite`), OGV_ADVISOR_FIXTURE: "1", OGV_WEATHER_FIXTURE: "1", OGV_PLACES_FIXTURE: "1", OGV_GEOCODE_FIXTURE: "1", OGV_ELEVATION_FIXTURE: "1", OGV_OFFLINE_REGION_ROOT: "tests/fixtures/offline-regions", OGV_BASEMAP_ROOT: "tests/fixtures/basemap", NEXT_PUBLIC_OGV_BASEMAP: map === "fixture" ? "empty" : "openfreemap", NEXT_PUBLIC_OGV_RIDE_FIXTURE: "1" };
  const next = spawn("./node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", String(nextPort)], { env, stdio: "inherit" });
  let exited = false; next.once("exit", () => { exited = true; });
  for (let i = 0; i < 600; i++) { if (exited) throw new Error("Next server exited before startup"); try { if ((await fetch(`http://127.0.0.1:${nextPort}/`)).ok) break; } catch {} if (i === 599) { next.kill(); throw new Error("Next server startup timed out"); } await sleep(200); }
  const proxy = createServer((req, res) => {
    if (req.url?.split("?")[0] === "/api/route-plan" && /(?:^|;\s*)ogshots-error=1(?:;|$)/.test(req.headers.cookie || "")) { res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: { code: "provider-unavailable", message: "The route planner could not be reached.", recoverable: true } })); req.resume(); return; }
    if (process.env.OGSHOTS_DEBUG && req.url.startsWith('/api')) { const t0 = Date.now(); console.log('REQ', req.method, req.url.slice(0,60)); res.on('finish', () => console.log('FIN', req.url.slice(0,40), res.statusCode, Date.now() - t0)); res.on('close', () => console.log('CLOSE', req.url.slice(0,40), Date.now() - t0)); }
    const upstream = httpRequest({ host: "127.0.0.1", port: nextPort, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode || 502, response.headers); response.pipe(res); });
    upstream.on("error", error => { res.writeHead(502); res.end(error.message); }); req.pipe(upstream);
  });
  await new Promise((resolve, reject) => proxy.once("error", reject).listen(proxyPort, "0.0.0.0", resolve));
  return { target: `http://127.0.0.1:${proxyPort}`, port: proxyPort, close: async () => { await new Promise(resolve => proxy.close(resolve)); next.kill(); } };
}
async function pixelDiff(first, next) { const a = await sharp(first).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const b = await sharp(next).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw new Error("Repeat screenshots have different dimensions"); return comparePixels(a.data, b.data, a.info.width, a.info.height); }
async function checkMap(driver, path, mode) {
  const box = await driver.evaluate(`const e=document.querySelector('[data-testid="planner-map"] canvas'); if(!e)return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};`);
  if (!box) return;
  const image = sharp(path); const info = await image.metadata(); const sx = info.width / box.viewportWidth, sy = info.height / box.viewportHeight;
  const left = Math.max(0, Math.floor(box.x * sx)), top = Math.max(0, Math.floor(box.y * sy));
  const width = Math.min(info.width - left, Math.floor(box.width * sx)), height = Math.min(info.height - top, Math.floor(box.height * sy));
  if (width < 10 || height < 10) return; // map not on screen in this state (e.g. a scrolled list page): nothing to judge
  const { data } = await sharp(path).extract({ left, top, width, height }).resize(80, 80, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let white = 0; const colors = new Set(); for (let i = 0; i < data.length; i += 3) { if (data[i] >= 252 && data[i+1] >= 252 && data[i+2] >= 252) white++; colors.add(`${data[i] >> 3},${data[i+1] >> 3},${data[i+2] >> 3}`); }
  if (white / (data.length / 3) > 0.98) throw new Error("Map screenshot is blank white");
  if (mode === "real" && colors.size < 8) throw new Error("Real map screenshot lacks visible map detail");
}
async function reset(driver, target, theme, local) {
  if (!local) return;
  const clear = `localStorage.clear(); sessionStorage.clear(); document.cookie='ogshots-error=; Max-Age=0; path=/'; localStorage.setItem('og-appearance', ${JSON.stringify(theme === "light" ? "day" : "night")}); window.__ogShotsReset='pending';
    const lim=(p)=>Promise.race([Promise.resolve(p).catch(()=>{}), new Promise(r=>setTimeout(r,3000))]);
    (async()=>{
      try{ if(indexedDB.databases) for(const d of await indexedDB.databases()) if(d.name) await lim(new Promise(r=>{const q=indexedDB.deleteDatabase(d.name); q.onsuccess=q.onerror=q.onblocked=()=>r();})); }catch(e){}
      try{ for(const k of await caches.keys()) await lim(caches.delete(k)); }catch(e){}
      try{ for(const r of await navigator.serviceWorker.getRegistrations()) await lim(r.unregister()); }catch(e){}
      try{ const root=await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await lim(root.removeEntry(n,{recursive:true})); }catch(e){}
      window.__ogShotsReset='done';
    })();`;
  const waitDone = async () => { for (let i=0;i<150;i++) { if (await driver.evaluate("return window.__ogShotsReset === 'done'")) return; await sleep(100); } };
  // The app writes its state back when a page is left, so clear on the app page, leave
  // through a page without the app, and clear again from there.
  await driver.goto(target + "/");
  await driver.evaluate(clear); await waitDone();
  await driver.goto(target + "/robots.txt");
  await driver.evaluate(clear); await waitDone();
}
async function main() {
  const opts = options(process.argv.slice(2));
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(), branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  const output = join("shots-out", `${new Date().toISOString().replace(/[-:]/g, "").slice(0,15).replace("T", "-")}-${commit}`); await mkdir(output, { recursive: true });
  const report = makeManifest({ ...opts, commit, branch }); let server, tunnel;
  const save = async () => { await writeFile(join(output, "manifest.json"), JSON.stringify(report, null, 2) + "\n"); await writeFile(join(output, "index.html"), gallery(report)); };
  try {
    server = opts.target === "local" ? await localServer(opts.map) : undefined; const target = server?.target || opts.target.replace(/\/$/, "");
    if (opts.devices.some(d => devices[d].udid)) { const port = await freePort(); try { tunnel = await startTunnel(port, server?.port); tunnel.port = port; } catch (error) { report.errors.push(`Safari setup: ${error.message}`); } }
    for (const deviceName of opts.devices) for (const theme of opts.themes) {
      const device = devices[deviceName]; let driver;
      try { if (device.udid && !tunnel) throw new Error(report.errors.at(-1)); driver = device.udid ? await safariDriver(tunnel.port, device, theme) : await playwrightDriver(device, theme); }
      catch (error) { for (const state of opts.states) report.shots.push({ state, device: deviceName, theme, runs: [], error: `Driver setup: ${error.message}`, maxDiffPercent: null }); await save(); continue; }
      try { for (const state of opts.states) {
        const shot = { state, device: deviceName, theme, runs: [], error: null, maxDiffPercent: null }; report.shots.push(shot);
        try { for (let i = 1; i <= opts.repeat; i++) {
          const started = Date.now(); let attempts = 0;
          for (;;) { attempts++; try { await reset(driver, target, theme, opts.target === "local"); await journey(driver, state, target, opts.target === "local"); break; } catch (error) { if (attempts >= 3) throw error; console.warn(`${deviceName}/${theme}/${state}: attempt ${attempts} failed (${error.message}); retrying`); (shot.retries ??= []).push(error.message); } }
          const name = `${state}-${deviceName}-${theme}-${i}`, content = `${name}.png`; await driver.screenshot(join(output, content)); await checkMap(driver, join(output, content), opts.map);
          const frame = device.udid ? `${name}-frame.png` : undefined; if (frame) await driver.frame(join(output, frame));
          shot.runs.push({ content, ...(frame ? { frame } : {}), durationMs: Date.now() - started });
          if (i > 1) { const diff = await pixelDiff(join(output, shot.runs[0].content), join(output, content)); shot.maxDiffPercent = Math.max(shot.maxDiffPercent ?? 0, diff); }
        } console.log(`${deviceName}/${theme}/${state}: captured${shot.maxDiffPercent === null ? "" : `, max diff ${shot.maxDiffPercent.toFixed(3)}%`}`); }
        catch (error) { const failure = `${state}-${deviceName}-${theme}-failure.png`; try { await driver.screenshot(join(output, failure)); shot.failure = failure; } catch {} let probe; try { const t0 = Date.now(); const r = await fetch(target + "/robots.txt", { signal: AbortSignal.timeout(8000) }); probe = `server answered ${r.status} in ${Date.now() - t0} ms`; } catch (e) { probe = `server did not answer: ${e.message}`; } shot.error = `[${probe}] ${error.message} (repeat ${shot.runs.length + 1} of ${opts.repeat})`; report.errors.push(`${deviceName}/${theme}/${state}: ${error.message}`); console.error(`${deviceName}/${theme}/${state}: ${error.message}`); }
        await save();
      } } finally { await driver.close().catch(error => report.errors.push(`Driver cleanup: ${error.message}`)); }
    }
  } catch (error) { report.errors.push(error.stack || String(error)); console.error(error); }
  finally { if (tunnel) tunnel.kill(); if (server) await server.close(); report.finishedAt = new Date().toISOString(); await save(); console.log(`Gallery: ${output}/index.html`); if (report.errors.length || report.shots.some(s => s.error)) process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
