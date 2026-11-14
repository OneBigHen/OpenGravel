const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const testId = id => `[data-testid="${id}"]`;
export const states = ["plan-idle", "search-focused", "route-choices", "route-sheet-expanded", "active-ride", "explore", "rides-library", "settings", "planner-error", "explore-country-list", "explore-country-map", "explore-country-card", "explore-country-here"];
// The ride library pack is only on the server's path while a country state runs, so
// the older Explore picture stays what it was. OGSHOTS_LIBRARY_REAL=1 means the path
// already holds the real pack and is left alone.
async function libraryPack(on) {
  const target = process.env.OGSHOTS_LIBRARY_PACK;
  if (!target || process.env.OGSHOTS_LIBRARY_REAL === "1") return;
  const { copyFile, rm } = await import("node:fs/promises");
  if (on) await copyFile("tests/fixtures/route-library/pack.sqlite", target); else await rm(target, { force: true });
}
async function countryJourney(driver, state, target) {
  await libraryPack(true);
  const path = { "explore-country-list": "/explore?view=list", "explore-country-map": "/explore?view=map", "explore-country-card": "/explore?view=map&at=35.322,-83.807,9", "explore-country-here": "/explore?view=list&here=-84.5,35,-83,36" }[state];
  await driver.goto(target + path);
  await wait(driver, "loading skeletons gone", `return !document.querySelector('.og-skeleton,[aria-busy="true"]');`, 60000);
  if (state === "explore-country-list" || state === "explore-country-here") {
    await wait(driver, "library rows", `return document.querySelectorAll('[data-testid="library-row"]').length > 0;`, 30000);
    await sleep(500);
    return;
  }
  await wait(driver, "country map", `const m=document.querySelector('[data-testid="routes-map"]'); const p=m?.querySelector('[data-testid="planner-map"]'); return !!m && p?.dataset.mapLoad === 'ready' && !!p.dataset.mapExtent;`, 60000);
  if (state === "explore-country-map") {
    await wait(driver, "state bubbles", `return [...document.querySelectorAll('.og-routes__bubble')].some(e => e.style.visibility === 'visible');`, 30000);
  } else {
    await wait(driver, "lines drawn", `return Number(document.querySelector('[data-testid="routes-map"]')?.dataset.lines) > 0;`, 30000);
    await sleep(800);
    // Tap the start of the Cherohala Skyway the way a finger would.
    await driver.evaluate(`const p=document.querySelector('[data-testid="planner-map"]'); const [w,s,e,n]=p.dataset.mapExtent.split(',').map(Number); const my=l=>Math.log(Math.tan(Math.PI/4+l*Math.PI/360)); const box=p.querySelector('canvas').getBoundingClientRect(); const x=box.left+(-83.8071-w)/(e-w)*box.width; const y=box.top+(my(n)-my(35.3228))/(my(n)-my(s))*box.height; const c=p.querySelector('canvas'); const o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,pointerId:1,pointerType:'mouse',isPrimary:true,view:window}; for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) c.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,o)); return 1;`);
    await wait(driver, "ride card", `return !!document.querySelector('[data-testid="routes-map-card"]');`, 20000);
  }
  await sleep(600);
}

async function wait(driver, description, script, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { try { last = await driver.evaluate(script); if (last) return last; } catch (error) { last = error.message; } await sleep(250); }
  throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
}
async function visible(driver, selector) {
  await wait(driver, selector, `const e=document.querySelector(${JSON.stringify(selector)}); return !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';`);
}
async function mapReady(driver) {
  await wait(driver, "map ready, rendered canvas and fonts", `const m=document.querySelector('[data-testid="planner-map"]'); const c=m?.querySelector('canvas'); return !!m && m.dataset.mapLoad === 'ready' && !!m.dataset.mapExtent && !!c && c.width>0 && c.height>0 && document.fonts.status === 'loaded';`);
  // Observe the existing camera signal over a quiet interval. Map load health
  // reports rendered data, but does not expose MapLibre's full tile-idle state.
  let last = ""; let stable = 0;
  for (let n = 0; n < 40; n++) { const now = await driver.evaluate(`const m=document.querySelector('[data-testid="planner-map"]'); return m && [m.dataset.mapExtent,m.clientWidth,m.clientHeight].join(':');`); stable = now && now === last ? stable + 1 : 0; if (stable >= 4) return; last = now; await sleep(250); }
  throw new Error("Map camera or geometry did not settle");
}
async function prepareMap(driver, target) {
  await driver.goto(target + "/");
  await mapReady(driver);
  // The simulator's HTTP origin is not a secure geolocation context. Inject a
  // deterministic browser API response for the journey, never into app code.
  await driver.evaluate(`const position={coords:{latitude:40.8757,longitude:-75.7324,accuracy:6,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()}; const geo={getCurrentPosition:(ok)=>setTimeout(()=>ok(position),0),watchPosition:(ok)=>{setTimeout(()=>ok(position),0);return 1},clearWatch:()=>{}}; if(navigator.geolocation){for(const key of Object.keys(geo)) Object.defineProperty(navigator.geolocation,key,{configurable:true,value:geo[key]});} else Object.defineProperty(navigator,'geolocation',{configurable:true,value:geo});`);
}
// Transient toasts ("Directions set / Undo") must be gone before a screenshot, or the picture is not repeatable.
async function quiet(driver) { await wait(driver, "toast gone", `return !/Directions set/.test(document.body.innerText);`, 20000).catch(() => {}); await sleep(300); }
async function route(driver, target, failure) {
  await prepareMap(driver, target);
  if (failure) await driver.evaluate("document.cookie='ogshots-error=1; path=/; SameSite=Lax'");
  const search = await driver.evaluate("return innerWidth <= 1180 ? '[data-testid=\"top-place-search\"]' : '[data-testid=\"finish-search\"]';");
  await visible(driver, search);
  await driver.fill(search, "Hawk Mountain Sanctuary");
  await driver.press(search, "Enter");
  await visible(driver, testId("place-directions"));
  await driver.click(testId("place-directions"));
  if (failure) { await visible(driver, testId("planner-error")); await driver.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1;"); await sleep(600); await quiet(driver); return; }
  await wait(driver, "ride ready with two alternatives", `return !!document.querySelector('[data-testid="status-line"]')?.textContent.includes('Ride ready') && /alternative/i.test(document.body.innerText) && /fastest/i.test(document.body.innerText);`, 45000);
  await driver.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1;");
  await sleep(600);
  await quiet(driver);
}
export async function journey(driver, state, target, local) {
  if (state.startsWith("explore-country")) return countryJourney(driver, state, target);
  await libraryPack(false);
  if (state === "explore" || state === "rides-library" || state === "settings") {
    const path = state === "rides-library" ? "/rides" : `/${state}`;
    await driver.goto(target + path);
    const title = state === "rides-library" ? "My rides" : state === "explore" ? "Explore" : "Settings";
    await wait(driver, `${title} heading`, `return [...document.querySelectorAll('h1,h2')].some(e=>e.textContent.includes(${JSON.stringify(title)}));`);
    await wait(driver, "loading skeletons gone", `return !document.querySelector('.og-skeleton,[aria-busy="true"]');`, 60000);
    await sleep(500);
    if (state === "explore" && await driver.evaluate("return !!document.querySelector('[data-testid=\"planner-map\"]')")) await mapReady(driver);
    return;
  }
  if (state === "plan-idle" || state === "search-focused") {
    await prepareMap(driver, target);
    if (state === "search-focused") {
      const selector = await driver.evaluate("return innerWidth <= 1180 ? '[data-testid=\"top-place-search\"]' : '[data-testid=\"finish-search\"]';");
      await visible(driver, selector); await driver.click(selector);
      await wait(driver, "search focus", `return document.activeElement?.matches(${JSON.stringify(selector)});`);
    }
    return;
  }
  if (state === "planner-error" && !local) throw new Error("Planner failure injection is only available for --target local");
  await route(driver, target, state === "planner-error");
  if (state === "planner-error") return;
  if (state === "route-sheet-expanded") {
    const hasOptions = await driver.evaluate(`return !!document.querySelector('${testId("route-options-settings")}');`);
    if (hasOptions) { await driver.click(testId("route-options-settings")); await wait(driver, "expanded route sheet", `return document.querySelector('${testId("planner-sheet")}')?.dataset.detent === 'full';`); }
    else { await visible(driver, testId("surface-preference")); }
  }
  if (state === "active-ride") { await visible(driver, testId("start-ride")); await driver.click(testId("start-ride")); await wait(driver, "active ride", `return document.querySelector('${testId("ride-focus")}')?.dataset.status === 'ready';`, 45000); await wait(driver, "GPS fix", `return !/No GPS fix/.test(document.body.innerText);`, 20000).catch(() => {}); await sleep(500); await mapReady(driver); }
  else await mapReady(driver);
}
export { mapReady };
