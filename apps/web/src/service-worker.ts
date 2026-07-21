/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

declare const self: ServiceWorkerGlobalScope;

const STATIC_CACHE = `nuestro-dinero-static-${version}`;
const PAGE_CACHE = `nuestro-dinero-pages-${version}`;
const PRECACHE = [...build, ...files].filter(
  (path) =>
    !path.endsWith(".map") &&
    !path.startsWith("/api/") &&
    !path.startsWith("/auth/"),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("nuestro-dinero-") &&
                key !== STATIC_CACHE &&
                key !== PAGE_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Las respuestas financieras y de autenticación nunca se almacenan en caché.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(PAGE_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const home = await caches.match("/");
          if (home) return home;
          return new Response(
            "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width'><title>Sin conexión</title><style>body{font:16px system-ui;background:#f5f2ea;color:#12261f;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}main{max-width:32rem}button{padding:12px 18px;border:0;border-radius:999px;background:#12261f;color:white}</style><main><h1>Estás sin conexión</h1><p>Abre una pantalla visitada antes o recupera la conexión. Tus capturas locales permanecen en este dispositivo.</p><button onclick='location.reload()'>Reintentar</button></main>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }),
    );
    return;
  }

  const isStatic =
    PRECACHE.includes(url.pathname) ||
    ["style", "script", "font", "image"].includes(request.destination);
  if (!isStatic) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        }),
    ),
  );
});
