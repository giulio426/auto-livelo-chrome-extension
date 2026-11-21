import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBackground } from "./harness.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const fx = (p) => JSON.parse(readFileSync(join(DIR, "fixtures", p), "utf8"));
const MIN = 60000, DAYMS = 24 * 3600000;

const entry = (o) => ({ host: "loja.com.br", code: "LOJ", name: "Loja", journey: "CUPOM", link: "https://www.loja.com.br/livelo", coupon: "LIVELO", px: null, pts: "2 pts", page: "https://www.livelo.com.br/x", ...o });
const LOJA = "https://www.loja.com.br/";
const LINK = "https://www.loja.com.br/livelo";

async function setup(catalog = { "loja.com.br": entry({}) }, url = LOJA) {
  const h = await loadBackground();
  await h.chrome.storage.local.set({ catalog });
  h.tabs[1] = { id: 1, url };
  return h;
}
const nav = (h, url) => h.fire("webNavigation.onCommitted", { tabId: 1, frameId: 0, url });
const done = (h, url) => h.fire("webNavigation.onCompleted", { tabId: 1, frameId: 0, url });
const req = (h, url) => h.fire("webRequest.onBeforeRequest", { tabId: 1, url, type: "main_frame" });
const sess = async (h, k) => (await h.chrome.storage.session.get(k))[k];
const why = (h) => sess(h, "why:1");
const near = (v, expect, tol = 5000) => assert.ok(Math.abs(v - expect) < tol, `${v - Date.now()} vs ${expect - Date.now()}`);

test("1. base", async () => {
  const h = await loadBackground();
  const base = h.eval("base");
  const cases = { "www.loja.com.br": "loja.com.br", "a.b.gov.br": "b.gov.br", "shop.example.co.uk": "example.co.uk", "x.y.example.com": "example.com", "example.com.br": "example.com.br" };
  for (const [i, o] of Object.entries(cases)) assert.equal(base(i), o, i);
});

test("2. storeHost/target", async () => {
  const h = await loadBackground();
  const sh = h.eval("storeHost");
  assert.equal(sh("https://click.linksynergy.com/deeplink?id=x&murl=https%3A%2F%2Fonelink.shein.com%2F38"), "shein.com");
  assert.equal(sh("https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=https%3A%2F%2Fwww.loja.com.br%2Fp"), "loja.com.br");
  assert.equal(sh("https://ad.admitad.com/g/abc/?ulp=https%3A%2F%2Fwww.store.com.br%2F"), "store.com.br");
  assert.equal(sh("https://track.example.net/go?url=https%3A%2F%2Fm.shop.com.br%2F"), "shop.com.br");
  assert.equal(sh("https://www.boticario.com.br/livelo?utm_source=livelo"), "boticario.com.br");
  const inner = encodeURIComponent("https://t.net/r?ued=" + encodeURIComponent("https://www.inner.com.br/p"));
  assert.equal(sh("https://outer.net/go?url=" + inner), "inner.com.br");
});

test("3. Carrefour separation in both list orders", async () => {
  const search = fx("search.json").content;
  for (const order of [["CRF", "CRM"], ["CRM", "CRF"]]) {
    const h = await loadBackground();
    const toEntry = h.eval("toEntry");
    const list = order.map((c) => search.find((p) => p.code === c));
    const details = {};
    for (const p of list) details[p.code] = { mod: p.lastModifiedDate, entry: toEntry(p, fx(`profiles/${p.code}.json`)) };
    await h.chrome.storage.local.set({ details, list, listAt: Date.now(), feed: { sites: [] }, feedAt: Date.now() });
    await h.eval("buildCatalog")();
    const m = await h.eval("lookup")("https://mercado.carrefour.com.br/x");
    const f = await h.eval("lookup")("https://www.carrefour.com.br/y");
    assert.equal(m.code, "CRM", order.join());
    assert.equal(f.code, "CRF", order.join());
  }
});

test("4. cooldown 30min on commit, 24h on confirm", async () => {
  const h = await setup();
  await nav(h, LOJA);
  near(await sess(h, "cd:LOJ"), Date.now() + 30 * MIN);
  await req(h, LINK);
  await done(h, LINK);
  assert.equal(await why(h), "activated");
  near(await sess(h, "cd:LOJ"), Date.now() + DAYMS);
});

test("5. failure keeps short cooldown", async () => {
  const h = await setup();
  await nav(h, LOJA);
  const other = "https://www.loja.com.br/home";
  await done(h, other);
  await done(h, other);
  assert.equal(await why(h), "error");
  assert.equal(h.banners.length, 1);
  near(await sess(h, "cd:LOJ"), Date.now() + 30 * MIN);
});

test("6. reactivate / dismiss", async () => {
  const h = await setup();
  const set = (k) => h.chrome.storage.session.set({ [k]: Date.now() + DAYMS });
  // reactivate by url -> partner key
  await set("cd:LOJ");
  await h.send({ type: "reactivate", url: LOJA });
  assert.equal(await sess(h, "cd:LOJ"), undefined);
  // reactivate by host -> host key (plugin-feed entries)
  await set("cd:loja.com.br");
  await h.send({ type: "reactivate", host: "loja.com.br" });
  assert.equal(await sess(h, "cd:loja.com.br"), undefined);
  // both at once
  await set("cd:LOJ");
  await set("cd:loja.com.br");
  await h.send({ type: "reactivate", host: "loja.com.br", url: LOJA });
  assert.equal(await sess(h, "cd:LOJ"), undefined);
  assert.equal(await sess(h, "cd:loja.com.br"), undefined);
  // dismiss -> partner key only
  await h.send({ type: "dismiss" }, { tab: { id: 1, url: LOJA } });
  near(await sess(h, "cd:LOJ"), Date.now() + DAYMS);
  assert.equal(await sess(h, "cd:loja.com.br"), undefined);
});

test("7. http link marks seen; filter includes http and https", async () => {
  // Harness drops addListener's filter arg: re-run background.js in a fresh context with a recording chrome.
  const h = await loadBackground();
  const rec = [];
  const wr = h.chrome.webRequest.onBeforeRequest;
  const orig = wr.addListener;
  wr.addListener = (fn, filter) => { rec.push(filter); orig.call(wr, fn); };
  const ctx = vm.createContext({
    console, URL, URLSearchParams, JSON, Math, Date, Promise, Error, encodeURIComponent, structuredClone, queueMicrotask,
    setTimeout: (fn) => setImmediate(fn), clearTimeout() {}, fetch: async () => ({ ok: false, status: 404 }),
    importScripts() {}, chrome: h.chrome,
  });
  vm.runInContext(readFileSync(join(DIR, "..", "background.js"), "utf8"), ctx);
  assert.equal(rec.length, 1);
  assert.ok(rec[0].urls.includes("http://*/*"));
  assert.ok(rec[0].urls.includes("https://*/*"));

  const link = "http://www.loja.com.br/livelo";
  const h2 = await setup({ "loja.com.br": entry({ link }) });
  await nav(h2, LOJA);
  await req(h2, link);
  assert.equal((await sess(h2, "act:1")).seen, true);
});

test("8. rewritten landing counts as activated", async () => {
  const link = "https://www.carrefour.com.br/livelo?utm_source=livelo&utm_medium=afiliados&utm_campaign=liveloshopping";
  const h = await setup({ "carrefour.com.br": entry({ host: "carrefour.com.br", code: "CRF", link }) }, "https://www.carrefour.com.br/");
  await nav(h, "https://www.carrefour.com.br/");
  await req(h, link);
  await done(h, "https://www.carrefour.com.br/wl/livelo?utm_campaign=liveloshopping");
  assert.equal(await why(h), "activated");

  const l2 = "https://www.insider.com.br/livelo?utm_source=LIVELO";
  const h2 = await setup({ "insider.com.br": entry({ host: "insider.com.br", code: "INS", link: l2 }) }, "https://www.insider.com.br/");
  await nav(h2, "https://www.insider.com.br/");
  await req(h2, l2);
  await done(h2, "https://www.insider.com.br/?utm_source=LIVELO");
  assert.equal(await why(h2), "activated");
});

test("9. act expiry", async () => {
  const h = await setup();
  await h.chrome.storage.session.set({ "act:1": { host: "loja.com.br", link: LINK, from: LOJA, tries: 1, seen: false, p: entry({}), t: Date.now() - 31000 } });
  await done(h, "https://www.loja.com.br/outra");
  assert.equal(await why(h), undefined);
  assert.equal(await sess(h, "act:1"), undefined);
  assert.equal(h.tabUpdates.length, 0);
});

test("10. status count unique + partner via subdomain", async () => {
  const e = entry({});
  const h = await setup({ "loja.com.br": e, "m.loja.com.br": e, "outra.com.br": entry({ host: "outra.com.br", code: "OUT", name: "Outra" }) });
  const s = await h.send({ type: "status", url: "https://m.loja.com.br/p", tabId: 1 });
  assert.equal(s.count, 2);
  assert.equal(s.partner, "Loja");
  const s2 = await h.send({ type: "status", url: "https://sub.loja.com.br/p", tabId: 1 });
  assert.equal(s2.partner, "Loja");
});
