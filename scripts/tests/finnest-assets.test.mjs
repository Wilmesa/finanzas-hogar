import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("PWA y service worker usan el branding FinNest", () => {
  const manifest = JSON.parse(read("apps/web/static/manifest.webmanifest"));
  assert.equal(manifest.name, "FinNest");
  assert.equal(manifest.short_name, "FinNest");
  assert.match(read("apps/web/src/service-worker.ts"), /finnest-static/);
});

test("la experiencia servidor no contiene identidades ni insight ficticios conocidos", () => {
  const home = read("apps/web/src/routes/+page.svelte");
  const transactions = read("apps/web/src/routes/transactions/+page.svelte");
  const nav = read("apps/web/src/lib/Nav.svelte");
  for (const source of [home, transactions, nav]) {
    assert.doesNotMatch(source, /Ana|Leo|comidas fuera subió 24/);
  }
});

test("tema y viewport móvil cuentan con límites semánticos", () => {
  const css = read("apps/web/src/app.css");
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test("el acceso administrativo Firefly solo publica en loopback", () => {
  const override = read("docker-compose.firefly-admin.yml");
  assert.match(override, /127\.0\.0\.1:/);
  assert.doesNotMatch(override, /0\.0\.0\.0:/);
});
