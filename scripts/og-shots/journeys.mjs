const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const testId = id => `[data-testid="${id}"]`;
export const states = ["plan-idle", "search-focused", "route-choices", "route-sheet-expanded", "active-ride", "explore", "rides-library", "settings", "planner-error"];
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
