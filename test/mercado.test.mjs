import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadBackground } from "./harness.mjs";

const seed = JSON.parse(fs.readFileSync("D:/Apps/liveloExtension/seed.json", "utf8"));
const DAYMS = 24 * 3600000;
const SHOP = "https://www.carrefour.com.br/";
const SHOP_LINK = "https://www.carrefour.com.br/livelo?utm_source=livelo&utm_medium=afiliados&utm_campaign=liveloshopping";
const SHOP_DONE = "https://www.carrefour.com.br/wl/livelo?utm_campaign=liveloshopping";
const MERC = "https://mercado.carrefour.com.br/";
const MERC_LINK = "https://mercado.carrefour.com.br/wl/livelo?utm_source=livelo&utm_medium=afiliados&utm_campaign=livelomercado";

async function setup(storage) {
  const h = await loadBackground({ seed, ...(storage ? { storage } : {}) });
  await h.eval("buildCatalog")();
  return h;
}
const nav = (h, url, tabId = 1) => h.fire("webNavigation.onCommitted", { tabId, frameId: 0, url });
const done = (h, url, tabId = 1) => h.fire("webNavigation.onCompleted", { tabId, frameId: 0, url });
const req = (h, url, tabId = 1) => h.fire("webRequest.onBeforeRequest", { tabId, url, type: "main_frame" });
const sess = async (h, k) => (await h.chrome.storage.session.get(k))[k];
const why = (h, id = 1) => sess(h, "why:" + id);
const near = (v, expect, tol = 5000) => assert.ok(Math.abs(v - expect) < tol, `${v - Date.now()} vs ${expect - Date.now()}`);
const confirm = async (h, url, link, finalUrl, tabId) => {
  h.tabs[tabId] = { id: tabId, url };
  await nav(h, url, tabId);
  await req(h, link, tabId);
  await done(h, finalUrl, tabId);
  assert.equal(await why(h, tabId), "activated");
};

test("1. Mercado alone -> redirect to CRM link", async () => {
  const h = await setup();
  h.tabs[1] = { id: 1, url: MERC };
  await nav(h, MERC);
  assert.equal(h.tabUpdates.length, 1);
  assert.ok(h.tabUpdates[0].url.startsWith("https://mercado.carrefour.com.br/wl/livelo?"), h.tabUpdates[0].url);
});

test("2a. Shopping confirmed then Mercado still activates; keys per partner", async () => {
  const h = await setup();
  await confirm(h, SHOP, SHOP_LINK, SHOP_DONE, 1);
  near(await sess(h, "cd:CRF"), Date.now() + DAYMS);
  assert.equal(await sess(h, "cd:carrefour.com.br"), undefined);
  h.tabs[2] = { id: 2, url: MERC };
  await nav(h, MERC, 2);
  assert.notEqual(await why(h, 2), "cooldown");
  assert.equal(h.tabUpdates.filter((u) => u.id === 2).length, 1);
  assert.ok(h.tabUpdates.find((u) => u.id === 2).url.startsWith("https://mercado.carrefour.com.br/wl/livelo?"));
});

test("2b. reverse order: Mercado then Shopping", async () => {
  const h = await setup();
  await confirm(h, MERC, MERC_LINK, "https://mercado.carrefour.com.br/wl/livelo?utm_campaign=livelomercado", 1);
  near(await sess(h, "cd:CRM"), Date.now() + DAYMS);
  assert.equal(await sess(h, "cd:carrefour.com.br"), undefined);
  h.tabs[2] = { id: 2, url: SHOP };
  await nav(h, SHOP, 2);
  assert.notEqual(await why(h, 2), "cooldown");
  assert.equal(h.tabUpdates.filter((u) => u.id === 2).length, 1);
});

test("3. same partner revisited -> cooldown", async () => {
  const h = await setup();
  await confirm(h, SHOP, SHOP_LINK, SHOP_DONE, 1);
  h.tabs[2] = { id: 2, url: SHOP };
  await nav(h, SHOP, 2);
  assert.equal(await why(h, 2), "cooldown");
  assert.equal(h.tabUpdates.filter((u) => u.id === 2).length, 0);
});

test("4. status journey/coupon/pts", async () => {
  const h = await setup();
  const st = (url) => h.send({ type: "status", url, tabId: 1 });
  const crf = await st(SHOP);
  assert.equal(crf.journey, "CUPOM");
  assert.equal(crf.coupon, "LIVELO");
  assert.ok(crf.pts && crf.pts.length > 0, "pts " + crf.pts);
  const mcl = await st("https://www.mercadolivre.com.br/");
  assert.equal(mcl.journey, "CPF");
  assert.equal(mcl.coupon, null);
  for (const u of ["https://www.boticario.com.br/", "https://www.magazineluiza.com.br/"]) {
    const s = await st(u);
    assert.equal(s.journey, "HOTSITE", u);
    assert.equal(s.coupon, null, u);
  }
  const none = await st("https://www.naoparceiro.com/");
  assert.equal(none.journey, null);
  assert.equal(none.pts, "");
});

test("5a. banner hint after activation: CUPOM", async () => {
  const h = await setup();
  await confirm(h, SHOP, SHOP_LINK, SHOP_DONE, 1);
  const b = h.banners.at(-1);
  assert.ok(b.args[0].text.includes("Cole o cupom LIVELO no carrinho antes de pagar."), b.args[0].text);
});

test("5b. banner hint after activation: HOTSITE", async () => {
  const h = await setup();
  const bot = "https://www.boticario.com.br/";
  const link = "https://www.boticario.com.br/livelo?utm_source=livelo&utm_medium=af-cpa&utm_campaign=AON";
  await confirm(h, bot, link, "https://www.boticario.com.br/?utm_source=livelo", 1);
  const b = h.banners.at(-1);
  assert.ok(b.args[0].text.includes("Compre normalmente: não precisa de cupom."), b.args[0].text);
});

test("5c. manual mode banner includes hint", async () => {
  for (const [url, hint] of [[SHOP, "Cole o cupom LIVELO no carrinho antes de pagar."], ["https://www.boticario.com.br/", "Compre normalmente: não precisa de cupom."]]) {
    const h = await setup({ local: { mode: "manual" }, session: {} });
    h.tabs[1] = { id: 1, url };
    await nav(h, url);
    assert.equal(await why(h), "manual");
    assert.ok(h.banners.at(-1).args[0].text.includes(hint), h.banners.at(-1).args[0].text);
  }
});
