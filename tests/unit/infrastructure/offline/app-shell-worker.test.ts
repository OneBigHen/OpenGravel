import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { OFFLINE_SHELL_ROUTES } from "@/application/offline/shell-routes";

const ORIGIN = "https://opengravel.test";
const SOURCE = readFileSync("public/sw.js", "utf8");
const absolute = (path: string) => new URL(path, ORIGIN).href;
const ASSETS = ["/_next/static/chunks/lazy-123.js", "/_next/static/media/font-123.woff2", "/vendor/maplibre/maplibre-gl-worker.mjs", "/vendor/maplibre/maplibre-gl-shared.mjs"];
type Listener = (event: unknown) => void;

/** Executes the shipped worker, mocking only the browser/network boundaries.
 * Cache matching models Vary, so Flight cannot accidentally satisfy HTML. */
function worker(buildId = "build-123", base = "") {
  const listeners = new Map<string, Listener>();
  const stored = new Map<string, { request: Request; response: Response }[]>();
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!stored.has(name)) stored.set(name, []);
      const entries = stored.get(name)!;
      return {
        put: async (key: string | Request, response: Response) => {
          const request = typeof key === "string" ? new Request(key) : key;
          const index = entries.findIndex((entry) => entry.request.url === request.url);
          const entry = { request, response: response.clone() };
          if (index < 0) entries.push(entry); else entries[index] = entry;
        },
        match: async (key: string | Request) => {
          const request = typeof key === "string" ? new Request(key) : key;
          return entries.find((entry) => entry.request.url === request.url &&
            (entry.response.headers.get("vary") ?? "").split(",").filter(Boolean)
              .every((header) => entry.request.headers.get(header.trim()) === request.headers.get(header.trim())))?.response.clone();
        },
      };
    }),
    keys: async () => [...stored.keys()],
    delete: vi.fn(async (name: string) => stored.delete(name)),
  };
  const fetcher = vi.fn(async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith(`${buildId}.json`)) return Response.json({ buildId, assets: ASSETS });
    if (ASSETS.some((asset) => url === absolute(`${base}${asset}`))) return new Response("asset", { headers: { "content-type": "application/javascript" } });
    return new Response(`<html>${new URL(url).pathname}</html>`, { headers: { "content-type": "text/html", vary: "RSC, Next-Router-State-Tree" } });
  });
  const claim = vi.fn();
  runInNewContext(SOURCE, {
    self: {
      location: new URL(`${ORIGIN}${base}/sw.js?build=${buildId}`),
      registration: { scope: `${ORIGIN}${base}/` },
      clients: { claim },
      addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    },
    caches, fetch: fetcher, URL, Headers, Response, Date,
  });
  async function lifecycle(name: "install" | "activate") {
    let done: Promise<unknown> | undefined;
    listeners.get(name)!({ waitUntil: (promise: Promise<unknown>) => { done = promise; } });
    await done;
  }
  function request(path: string, options: { rsc?: boolean; method?: string; navigate?: boolean; tree?: string } = {}): Promise<Response> | undefined {
    const headers = new Headers();
    if (options.rsc) headers.set("RSC", "1");
    if (options.tree) headers.set("Next-Router-State-Tree", options.tree);
    const req = new Request(absolute(path), { method: options.method ?? "GET", headers });
    if (options.navigate) Object.defineProperty(req, "mode", { value: "navigate" });
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({ request: req, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  }
  return { caches, stored, fetcher, claim, lifecycle, request, cacheName: `ogv-shell:${base}:${buildId}` };
}

describe("production app-shell service worker", () => {
  it("installs every shell route (including embedded route payloads), lazy assets and MapLibre's worker dependencies before claiming", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    expect(sw.claim).not.toHaveBeenCalled();
    const cache = await sw.caches.open(sw.cacheName);
    const documents = sw.stored.get(sw.cacheName)!
      .filter((entry) => entry.response.headers.get("content-type")?.includes("text/html"))
      .map((entry) => new URL(entry.request.url).pathname).sort();
    expect(documents).toEqual([...OFFLINE_SHELL_ROUTES].sort());
    for (const route of [...OFFLINE_SHELL_ROUTES, ...ASSETS]) {
      const cached = await cache.match(absolute(route));
      expect(cached, route).toBeDefined();
      expect(Number.isFinite(Date.parse(cached!.headers.get("x-og-cached-at")!))).toBe(true);
    }
    await sw.lifecycle("activate");
    expect(sw.claim).toHaveBeenCalledOnce();
  });

  it("does not activate an incomplete shell after a failed route download", async () => {
    const sw = worker();
    const original = sw.fetcher.getMockImplementation()!;
    sw.fetcher.mockImplementation(async (input) => {
      if (input === absolute("/ride")) return new Response("unavailable", { status: 503 });
      return original(input);
    });
    await expect(sw.lifecycle("install")).rejects.toThrow("Incomplete offline shell");
    expect(sw.claim).not.toHaveBeenCalled();
  });

  it("removes only old shell versions for this scope, preserving offline map caches", async () => {
    const sw = worker();
    for (const name of [sw.cacheName, "ogv-shell::old", "ogv-basemap-assets", "ogv-shell:/another:old"]) await sw.caches.open(name);
    await sw.lifecycle("activate");
    expect(await sw.caches.keys()).toEqual([sw.cacheName, "ogv-basemap-assets", "ogv-shell:/another:old"]);
    expect(sw.caches.delete).toHaveBeenCalledExactlyOnceWith("ogv-shell::old");
  });

  it("serves the requested page on an offline reload, including a query-string deep link", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.fetcher.mockRejectedValue(new TypeError("No signal"));
    expect(await (await sw.request("/ride?rideId=saved-ride", { navigate: true }))!.text()).toBe("<html>/ride</html>");
    expect(await (await sw.request("/settings", { navigate: true }))!.text()).toBe("<html>/settings</html>");
  });

  it("uses network-first HTML, updates its fallback and falls back on server errors", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.fetcher.mockResolvedValueOnce(new Response("fresh HTML", { headers: { "content-type": "text/html" } }));
    expect(await (await sw.request("/", { navigate: true }))!.text()).toBe("fresh HTML");
    sw.fetcher.mockResolvedValue(new Response("server down", { status: 503 }));
    expect(await (await sw.request("/", { navigate: true }))!.text()).toBe("fresh HTML");
  });

  it("serves hashed assets cache-first and learns new static assets on first visit", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.fetcher.mockClear();
    expect(await (await sw.request(ASSETS[0]!))!.text()).toBe("asset");
    expect(sw.fetcher).not.toHaveBeenCalled();
    sw.fetcher.mockResolvedValue(new Response("first visit"));
    await sw.request("/_next/static/chunks/new-hash.js");
    sw.fetcher.mockRejectedValue(new TypeError("No signal"));
    expect(await (await sw.request("/_next/static/chunks/new-hash.js"))!.text()).toBe("first visit");
  });

  it("never intercepts API responses, mutations, provider URLs or non-shell pages", () => {
    const sw = worker();
    expect(sw.request("/api/route-plan", { method: "POST" })).toBeUndefined();
    expect(sw.request("/api/offline/regions", { navigate: true })).toBeUndefined();
    expect(sw.request("/api/regions?_rsc=123", { rsc: true })).toBeUndefined();
    expect(sw.request("/", { method: "POST" })).toBeUndefined();
    expect(sw.request("https://tiles.provider.test/_next/static/map.js")).toBeUndefined();
    expect(sw.request("/community", { navigate: true })).toBeUndefined();
    expect(sw.request("/basemap/tiles.pmtiles")).toBeUndefined();
    expect(sw.fetcher).not.toHaveBeenCalled();
  });

  it("keeps HTML separate from Flight, caches observed route payloads and rejects mismatched router state", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.fetcher.mockResolvedValueOnce(new Response("flight payload", { headers: { "content-type": "text/x-component", vary: "RSC, Next-Router-State-Tree" } }));
    await sw.request("/rides?_rsc=123", { rsc: true, tree: "settings" });
    sw.fetcher.mockRejectedValue(new TypeError("No signal"));
    expect(await (await sw.request("/rides?_rsc=123", { rsc: true, tree: "settings" }))!.text()).toBe("flight payload");
    expect((await sw.request("/rides?_rsc=123", { rsc: true, tree: "explore" }))!.status).toBe(503);
    expect((await sw.request("/rides?_rsc=unknown", { rsc: true }))!.status).toBe(503);
    expect(await (await sw.request("/rides", { navigate: true }))!.text()).toBe("<html>/rides</html>");
  });

  it("honors a deployment prefix for precaching and offline document loads", async () => {
    const sw = worker("build-prefixed", "/ogv");
    await sw.lifecycle("install");
    sw.fetcher.mockRejectedValue(new TypeError("No signal"));
    expect(await (await sw.request("/ogv/ride", { navigate: true }))!.text()).toBe("<html>/ogv/ride</html>");
    expect(sw.request("/ride", { navigate: true })).toBeUndefined();
    expect(sw.request("/ogv/api/offline")).toBeUndefined();
  });

  it("rejects a mismatched manifest before claiming an offline shell", async () => {
    const sw = worker();
    sw.fetcher.mockResolvedValue(Response.json({ buildId: "other-build", assets: ASSETS }));
    await expect(sw.lifecycle("install")).rejects.toThrow("Wrong shell build");
    expect(sw.claim).not.toHaveBeenCalled();
  });

  it("keeps working online when Cache Storage becomes unavailable after activation", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.caches.open.mockRejectedValue(new Error("Storage disabled"));
    sw.fetcher.mockImplementation(async () => new Response("network response", { headers: { "content-type": "text/html" } }));
    expect(await (await sw.request("/settings", { navigate: true }))!.text()).toBe("network response");
    expect(await (await sw.request(ASSETS[0]!))!.text()).toBe("network response");
  });
});
