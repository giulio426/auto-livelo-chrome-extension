import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBackground } from "./harness.mjs";

const API = "https://apis.pontoslivelo.com.br";
const HOUR = 3600000;
const DAYMS = 24 * HOUR;
const SEARCH = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "search.json"), "utf8");
const enabled = () => JSON.parse(SEARCH).content.filter((p) => p.enabled);
const api = (h) => h.fetchLog.filter((f) => f.url.startsWith(API));
const n = (h, s) => api(h).filter((f) => f.url.includes(s)).length;
const local = (h, k) => h.chrome.storage.local.get(k).then((o) => (typeof k === "string" ? o[k] : o));
const settle = async (h) => { await h.idle(); const b = h.eval("building"); if (b) await b.catch(() => {}); await h.idle(); };
const mkSeed = () => Object.fromEntries(enabled().map((p) => [p.code, {
  mod: p.lastModifiedDate,
  entry: { host: p.code.toLowerCase() + ".example.com.br", code: p.code, journey: p.journeyType, link: "https://www." + p.code.toLowerCase() + ".example.com.br/livelo", coupon: null, px: null },
}]));

test("1. seed on fresh install: 1 search, 0 profiles, 1 plugin, no continue", async () => {
  const h = await loadBackground({ seed: mkSeed() });
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/profiles/search"), 1);
  assert.equal(n(h, "/v1/profiles/"), 0);
  assert.equal(n(h, "/parities-plugin"), 1);
  const st = await local(h, ["failed", "catalog"]);
  assert.equal(st.failed, 0);
  assert.ok(Object.keys(st.catalog).length >= 250);
  assert.equal(h.alarms.continue, undefined);
});

test("2. 3 stale seed entries -> 3 profile fetches", async () => {
  const seed = mkSeed();
  for (const c of Object.keys(seed).slice(0, 3)) seed[c].mod = "stale-" + c;
  const h = await loadBackground({ seed });
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/v1/profiles/"), 3);
});

test("3. continue reuses fresh list", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/v1/profiles/"), 15);
  await h.fire("alarms.onAlarm", { name: "continue" });
  await settle(h);
  assert.equal(n(h, "/profiles/search"), 1);
  assert.equal(n(h, "/v1/profiles/"), 30);
  assert.equal(n(h, "/parities-plugin"), 1);
});

test("4. list older than 12h refetched; buildCatalog(true) always fetches", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/profiles/search"), 1);
  await h.chrome.storage.local.set({ listAt: Date.now() - 13 * HOUR });
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/profiles/search"), 2);
  await h.eval("buildCatalog")(true);
  assert.equal(n(h, "/profiles/search"), 3);
});

test("5. plugin weekly", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/parities-plugin"), 1);
  await h.chrome.storage.local.set({ feedAt: Date.now() - 6 * DAYMS });
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/parities-plugin"), 1);
  await h.chrome.storage.local.set({ feedAt: Date.now() - 8 * DAYMS });
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/parities-plugin"), 2);
});

test("6. stale list fallback when search fails", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  await h.chrome.storage.local.set({ listAt: Date.now() - 13 * HOUR });
  delete h.alarms.continue;
  h.fail("/profiles/search", 500);
  const m = await h.eval("buildCatalog")();
  assert.equal(n(h, "/profiles/search"), 2);
  assert.ok(Object.keys(m).length > 0);
  assert.ok(Object.keys((await local(h, "catalog"))).length > 0);
  assert.ok(h.alarms.continue, "continue scheduled");
});

test("7. pacing 3000-5000ms between details", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  assert.equal(h.timeouts.length, 15);
  for (const t of h.timeouts) assert.ok(t >= 3000 && t <= 5000, "timeout " + t);
});

test("8. continue alarm >= now + 5min", async () => {
  const h = await loadBackground();
  const t0 = Date.now();
  await h.eval("buildCatalog")();
  assert.ok(h.alarms.continue.when >= t0 + 5 * 60000 - 1000, "when " + (h.alarms.continue.when - t0));
});

test("9. DEV ignores refresh alarm, runs continue; prod refresh fetches search", async () => {
  const d = await loadBackground({ dev: true });
  await d.fire("alarms.onAlarm", { name: "refresh" });
  await settle(d);
  assert.equal(api(d).length, 0);
  await d.fire("alarms.onAlarm", { name: "continue" });
  await settle(d);
  assert.equal(n(d, "/profiles/search"), 1);

  const p = await loadBackground();
  await p.eval("buildCatalog")();
  await p.fire("alarms.onAlarm", { name: "refresh" });
  await settle(p);
  assert.equal(n(p, "/profiles/search"), 2);
});

test("10. manual refresh fetches search even with fresh list", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  assert.equal(n(h, "/profiles/search"), 1);
  await h.chrome.storage.local.set({ refreshedAt: Date.now() - HOUR });
  assert.equal(await h.send({ type: "refresh" }), true);
  assert.equal(n(h, "/profiles/search"), 2);
});
