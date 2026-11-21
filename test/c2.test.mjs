import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground } from "./harness.mjs";

const SEARCH = "/profiles/search";
const MIN = 60000;
const HOUR = 3600000;
const local = (h, k) => h.chrome.storage.local.get(k).then((o) => (typeof k === "string" ? o[k] : o));
const apiLog = (h) => h.fetchLog.filter((f) => f.url.startsWith("https://apis.pontoslivelo.com.br"));
const searchCalls = (h) => h.fetchLog.filter((f) => f.url.includes(SEARCH)).length;
const settle = async (h) => { await h.idle(); const b = h.eval("building"); if (b) await b.catch(() => {}); await h.idle(); };

test("1. empty catalog: navigations and status make no fetch", async () => {
  const h = await loadBackground();
  const urls = [
    "https://www.portallar.com.br/", "https://www.boticario.com.br/", "https://www.amazon.com.br/",
    "https://example.com/", "https://www.shein.com/x",
  ];
  for (let i = 0; i < 20; i++) {
    await h.fire("webNavigation.onCommitted", { tabId: 1, frameId: 0, url: urls[i % urls.length] });
  }
  assert.equal(h.fetchLog.length, 0);
  await h.send({ type: "status", url: "https://www.boticario.com.br/" });
  assert.equal(h.fetchLog.length, 0);
});

test("2. single-flight: 3 concurrent builds -> 1 search request", async () => {
  const h = await loadBackground();
  const b = h.eval("buildCatalog");
  await Promise.all([b(), b(), b()]);
  assert.equal(searchCalls(h), 1);
});

test("3. 403 sets block, backoff, continue alarm; later calls do not fetch", async () => {
  const h = await loadBackground();
  h.fail(SEARCH, 403);
  const t0 = Date.now();
  await h.eval("buildCatalog")();
  const st = await local(h, ["blockedUntil", "backoff"]);
  assert.ok(Math.abs(st.blockedUntil - (t0 + 30 * MIN)) < MIN, "blockedUntil ~ now+30min");
  assert.equal(st.backoff, 1800000);
  assert.ok(h.alarms.continue, "continue alarm");
  assert.ok(h.alarms.continue.when >= st.blockedUntil);
  const n = apiLog(h).length;
  await h.eval("buildCatalog")();
  let err;
  try { await h.eval("api")("https://apis.pontoslivelo.com.br/x"); } catch (e) { err = e; }
  assert.equal(apiLog(h).length, n);
  assert.equal(err?.blocked, true);
});

test("4. backoff doubles and caps at 12h", async () => {
  const h = await loadBackground();
  h.fail(SEARCH, 403);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await h.chrome.storage.local.set({ blockedUntil: Date.now() - 1 });
    await h.eval("buildCatalog")();
    seen.push((await local(h, "backoff")));
  }
  assert.deepEqual(seen.slice(0, 5), [1800000, 3600000, 7200000, 14400000, 28800000]);
  assert.deepEqual(seen.slice(5), [43200000, 43200000, 43200000]);
});

test("5. Retry-After larger than backoff wins", async () => {
  const h = await loadBackground();
  h.fail(SEARCH, 429, { "retry-after": "86400" });
  const t0 = Date.now();
  await h.eval("buildCatalog")();
  const { blockedUntil } = await local(h, ["blockedUntil"]);
  assert.ok(Math.abs(blockedUntil - (t0 + 24 * HOUR)) < MIN);
});

test("6. success resets backoff", async () => {
  const h = await loadBackground();
  await h.chrome.storage.local.set({ backoff: HOUR, blockedUntil: 0 });
  await h.eval("buildCatalog")();
  assert.equal(await local(h, "backoff"), 0);
});

test("7. restart keeps block", async () => {
  const h = await loadBackground();
  h.fail(SEARCH, 403);
  await h.eval("buildCatalog")();
  const h2 = await loadBackground({ storage: h.storage });
  await h2.eval("buildCatalog")();
  assert.equal(apiLog(h2).length, 0);
});

test("8. onInstalled: update+catalog skips, install builds, update+empty builds", async () => {
  const a = await loadBackground();
  await a.chrome.storage.local.set({ catalog: { "x.com": { name: "x" } } });
  await a.fire("runtime.onInstalled", { reason: "update" });
  await settle(a);
  assert.equal(a.fetchLog.length, 0);

  const b = await loadBackground();
  await b.chrome.storage.local.set({ catalog: { "x.com": { name: "x" } } });
  await b.fire("runtime.onInstalled", { reason: "install" });
  await settle(b);
  assert.ok(searchCalls(b) >= 1);

  const c = await loadBackground();
  await c.fire("runtime.onInstalled", { reason: "update" });
  await settle(c);
  assert.ok(searchCalls(c) >= 1);
});

test("9. alarms by name", async () => {
  const a = await loadBackground();
  await a.fire("alarms.onAlarm", { name: "other" });
  await settle(a);
  assert.equal(a.fetchLog.length, 0);
  const b = await loadBackground();
  await b.fire("alarms.onAlarm", { name: "continue" });
  await settle(b);
  assert.ok(searchCalls(b) >= 1);
});

test("10. partial build schedules continue", async () => {
  const h = await loadBackground();
  await h.eval("buildCatalog")();
  const st = await local(h, ["failed", "catalog"]);
  assert.ok(st.failed > 0, "failed > 0, got " + st.failed);
  assert.ok(h.alarms.continue);
  assert.equal(typeof st.catalog, "object");
  assert.ok(Object.keys(st.catalog).length > 0);
});

test("11. manual refresh guards", async () => {
  const a = await loadBackground();
  const until = Date.now() + HOUR;
  await a.chrome.storage.local.set({ blockedUntil: until });
  const r = await a.send({ type: "refresh" });
  assert.equal(r.error, "blocked"); assert.equal(r.until, until);
  assert.equal(a.fetchLog.length, 0);

  const b = await loadBackground();
  assert.equal(await b.send({ type: "refresh" }), true);
  assert.equal((await b.send({ type: "refresh" })).error, "too_soon");
});

test("12. stats count 403 and ok", async () => {
  const a = await loadBackground();
  a.fail(SEARCH, 403);
  await a.eval("buildCatalog")();
  assert.ok((await local(a, "stats")).e403 >= 1);

  const b = await loadBackground();
  await b.eval("buildCatalog")();
  assert.ok((await local(b, "stats")).ok >= 1);
});
