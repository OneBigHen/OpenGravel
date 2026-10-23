/* OpenGravel's app shell only. Downloaded maps/graphs belong to the offline
 * stores; live provider results and /api responses never enter this cache. */
const BUILD_ID = new URL(self.location.href).searchParams.get("build");
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const CACHE_PREFIX = `ogv-shell:${BASE}:`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const ROUTES = ["/", "/ride", "/rides", "/settings", "/explore"].map((route) => `${BASE}${route}`);
const absolute = (path) => new URL(path, self.location.origin).href;
const isShell = (url) => ROUTES.includes(url.pathname);
const isAsset = (url) => url.origin === self.location.origin && (
  url.pathname.startsWith(`${BASE}/_next/static/`) ||
  url.pathname === `${BASE}/vendor/maplibre/maplibre-gl-worker.mjs` ||
  url.pathname === `${BASE}/vendor/maplibre/maplibre-gl-shared.mjs`
);

async function save(cache, key, response) {
  // Stamping shell HTML lets offline-runtime report its actual cache age.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("x-og-cached-at", new Date().toISOString());
  await cache.put(key, new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

async function precache() {
  if (!BUILD_ID || !/^[a-zA-Z0-9_.-]+$/.test(BUILD_ID)) throw new Error("Missing shell build ID");
  const response = await fetch(absolute(`${BASE}/_next/static/ogv-shell/${BUILD_ID}.json`), { cache: "no-store" });
  if (!response.ok) throw new Error("Shell asset manifest unavailable");
  const manifest = await response.json();
  if (manifest.buildId !== BUILD_ID || !Array.isArray(manifest.assets)) throw new Error("Wrong shell build");
  const assets = manifest.assets.map((path) => absolute(`${BASE}${path}`));
  if (!assets.every((path) => isAsset(new URL(path)))) throw new Error("Invalid shell asset");
  const cache = await caches.open(CACHE_NAME);
  // Bounded concurrency avoids flooding a phone on a weak connection.
  const pending = [...new Set([...ROUTES.map(absolute), ...assets])];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (pending.length) {
      const url = pending.shift();
      const result = await fetch(url, { cache: "reload" });
      if (!result.ok || result.redirected) throw new Error("Incomplete offline shell");
      if (isShell(new URL(url)) && !result.headers.get("content-type")?.includes("text/html")) {
        throw new Error("Shell route did not return HTML");
      }
      await save(cache, url, result);
    }
  }));
}

self.addEventListener("install", (event) => {
  // A failed install never claims clients. A working older worker can continue
  // serving its own cache. Updates wait for old tabs to close, avoiding a
  // forced mid-ride reload or mixing a new worker into an old session.
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function assetResponse(request) {
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  const cached = await cache?.match(request).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(request);
  if (cache && response.ok && !response.redirected) {
    try { await save(cache, request, response); } catch { /* Storage eviction must not break online use. */ }
  }
  return response;
}

async function shellResponse(request, url) {
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  const rsc = request.headers.get("RSC") === "1";
  // HTML and Flight payloads are never interchangeable. Preserve each Flight
  // request's URL + router Vary headers; the precached HTML contains the full
  // initial route payload for document navigations.
  const key = rsc ? request : absolute(url.pathname);
  try {
    const response = await fetch(request);
    if (response.status >= 500) throw new Error("Shell server unavailable");
    const type = response.headers.get("content-type") ?? "";
    if (cache && response.ok && !response.redirected && (rsc ? type.includes("text/x-component") : type.includes("text/html"))) {
      try { await save(cache, key, response); } catch { /* Keep network response if storage is full. */ }
    }
    return response;
  } catch {
    const cached = await cache?.match(key).catch(() => undefined);
    // An uncached Flight request makes Next fall back to a document load;
    // that load is fulfilled by the precached route HTML, never by raw RSC.
    return cached ?? new Response("This page needs a connection.", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Explicit exclusion includes RSC lookalikes and API navigations.
  if (url.pathname === `${BASE}/api` || url.pathname.startsWith(`${BASE}/api/`)) return;
  if (isAsset(url)) {
    event.respondWith(assetResponse(request));
  } else if (isShell(url) && (request.mode === "navigate" || request.headers.get("RSC") === "1")) {
    event.respondWith(shellResponse(request, url));
  }
});
