/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

declare const self: ServiceWorkerGlobalScope;

const STATIC_CACHE = `okle-static-${version}`;
const PAGE_CACHE = `okle-pages-${version}`;
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
                (key.startsWith("nuestro-dinero-") ||
                  key.startsWith("finnest-") ||
                  key.startsWith("okle-")) &&
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
            "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width'><title>OKLE sin conexión</title><style>body{font:16px Inter,system-ui;background:#f7f8fa;color:#16202a;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}main{max-width:32rem}button{padding:12px 18px;border:0;border-radius:999px;background:#123c69;color:white}</style><main><h1>Estás sin conexión</h1><p>OKLE no guarda respuestas financieras en caché. Recupera la conexión para sincronizar con Firefly.</p><button onclick='location.reload()'>Reintentar</button></main>",
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

self.addEventListener("push", (event) => {
  let payload: {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
    badgeCount?: number;
  } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title ?? "OKLE", {
        body: payload.body ?? "¿Ya registraste los movimientos de hoy?",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: payload.tag ?? "daily-expenses",
        data: { url: payload.url ?? "/transactions?action=new" },
      }),
      "setAppBadge" in self.navigator
        ? (
            self.navigator as Navigator & {
              setAppBadge(count?: number): Promise<void>;
            }
          ).setAppBadge(payload.badgeCount ?? 0)
        : Promise.resolve(),
    ]).then(() => undefined),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    String(event.notification.data?.url ?? "/transactions?action=new"),
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            await client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
