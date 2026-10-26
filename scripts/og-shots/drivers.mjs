import { chromium } from "playwright";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
const execFile = promisify(execFileCallback);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function mac(...args) { return execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "macbook", ...args], { timeout: 30000 }); }
export async function startTunnel(port, appPort) {
  try { await mac("curl -fsS http://127.0.0.1:4444/status >/dev/null || (nohup /usr/bin/safaridriver -p 4444 >/tmp/og-shots-safaridriver.log 2>&1 </dev/null &)"); }
  catch (error) { throw new Error(`Cannot reach Mac or start safaridriver: ${error.message}`); }
  const tunnel = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-N", "-L", `${port}:127.0.0.1:4444`, ...(appPort ? ["-R", `${appPort}:127.0.0.1:${appPort}`] : []), "macbook"], { stdio: "ignore" });
  let exited = false; tunnel.once("exit", () => { exited = true; });
  for (let i = 0; i < 100; i++) { if (exited) throw new Error("SSH tunnel exited before it was ready"); try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) return tunnel; } catch {} await sleep(100); }
  tunnel.kill(); throw new Error("Safari WebDriver tunnel did not start");
}

export async function playwrightDriver(device, theme) {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const context = await browser.newContext({ viewport: device.viewport, colorScheme: theme, reducedMotion: "reduce", geolocation: { latitude: 40.8757, longitude: -75.7324 }, permissions: ["geolocation"] });
  const page = await context.newPage();
  return {
    goto: url => page.goto(url, { waitUntil: "domcontentloaded" }),
    click: selector => page.locator(selector).first().click({ timeout: 12000 }),
    fill: (selector, value) => page.locator(selector).first().fill(value, { timeout: 12000 }),
    press: (selector, key) => page.locator(selector).first().press(key, { timeout: 12000 }),
    evaluate: (script, ...args) => page.evaluate(({ script, args }) => new Function("args", script)(args), { script, args }),
    screenshot: async path => { await page.screenshot({ path }); },
    close: async () => { await context.close(); await browser.close(); },
  };
}

export async function safariDriver(port, device, theme) {
  await mac(`xcrun simctl bootstatus ${device.udid} -b >/dev/null; xcrun simctl status_bar ${device.udid} override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3; xcrun simctl ui ${device.udid} appearance ${theme}`);
  const base = `http://127.0.0.1:${port}`;
  async function request(method, path, body) {
    const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (!response.ok || data.value?.error) throw new Error(`WebDriver ${method} ${path}: ${data.value?.message || response.status}`);
    return data.value;
  }
  // Safari does not implement GET /sessions. Refuse to kill an unknown active
  // session; our own session is always deleted in finally.
  const session = await request("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceUDID": device.udid } } });
  const id = session.sessionId;
  const call = (method, path, body) => request(method, `/session/${id}${path}`, body);
  return {
    goto: url => call("POST", "/url", { url }),
    // Simulator Safari's WebDriver neither focuses inputs on click nor delivers
    // typed text to them, so inputs are driven through the DOM the way React
    // expects (native value setter + input event, then a real keydown).
    // WebDriver clicks in the simulator turn into text selection on buttons, so click through the DOM.
    click: async selector => { await call("POST", "/execute/sync", { script: "var e=document.querySelector(arguments[0]); if(!e) throw new Error('no element'); e.scrollIntoView({block:'center'}); if(/^(INPUT|TEXTAREA)$/.test(e.tagName)) e.focus(); e.click();", args: [selector] }); },
    fill: async (selector, value) => { await call("POST", "/execute/sync", { script: "var e=document.querySelector(arguments[0]); e.focus(); var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(e,arguments[1]); e.dispatchEvent(new Event('input',{bubbles:true}));", args: [selector, value] }); },
    press: async (selector, key) => { await call("POST", "/execute/sync", { script: "var e=document.querySelector(arguments[0]); e.focus(); var k=arguments[1]; for (var t of ['keydown','keyup']) e.dispatchEvent(new KeyboardEvent(t,{key:k,code:k,bubbles:true,cancelable:true}));", args: [selector, key] }); },
    evaluate: (script, ...args) => call("POST", "/execute/sync", { script, args }),
    screenshot: async path => { await writeFile(path, Buffer.from(await call("GET", "/screenshot"), "base64")); },
    frame: async path => { const remote = `/tmp/og-shots-${process.pid}-${Date.now()}.png`; try { await mac(`xcrun simctl io ${device.udid} screenshot ${remote}`); await execFile("scp", ["-q", `macbook:${remote}`, path], { timeout: 30000 }); } finally { await mac(`rm -f ${remote}`).catch(() => {}); } },
    close: () => call("DELETE", "", undefined),
  };
}
