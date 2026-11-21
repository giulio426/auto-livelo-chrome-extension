import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground } from "./harness.mjs";

const entry = (o) => ({ host: "loja.com.br", code: "LOJ", name: "Loja", journey: "CUPOM", link: "https://www.loja.com.br/livelo", coupon: "LIVELO", px: null, pts: "2 pts por R$ 1", page: "https://www.livelo.com.br/juntar-pontos/parceiros/loja/LOJ", ...o });
const CATALOG = {
  "loja.com.br": entry({}),
  "cpf.com.br": entry({ host: "cpf.com.br", code: "CPF", journey: "CPF", link: "https://www.cpf.com.br/", coupon: null }),
};
const LOJA = "https://www.loja.com.br/";
const CPFURL = "https://www.cpf.com.br/";

async function setup({ local = {}, session = {} } = {}, url = LOJA) {
  const h = await loadBackground();
  await h.chrome.storage.local.set({ catalog: CATALOG, ...local });
  await h.chrome.storage.session.set(session);
  h.tabs[1] = { id: 1, url };
  return h;
}
const nav = (h, url) => h.fire("webNavigation.onCommitted", { tabId: 1, frameId: 0, url });
const why = async (h, id = 1) => (await h.chrome.storage.session.get("why:" + id))["why:" + id];
const promo = (h) => h.fetchLog.filter((f) => f.url.includes("/promotion-link"));

test("1. not_in_catalog", async () => {
  const u = "https://www.naoparceiro.com/";
  const h = await setup({}, u);
  await nav(h, u);
  assert.equal(await why(h), "not_in_catalog");
});

test("2. disabled", async () => {
  const h = await setup({ local: { disabled: { "loja.com.br": true } } });
  await nav(h, LOJA);
  assert.equal(await why(h), "disabled");
});

test("3. tagged", async () => {
  const u = LOJA + "?utm_source=livelo";
  const h = await setup({}, u);
  await nav(h, u);
  assert.equal(await why(h), "tagged");
});

test("4. skip_path", async () => {
  const u = LOJA + "checkout";
  const h = await setup({}, u);
  await nav(h, u);
  assert.equal(await why(h), "skip_path");
});

test("5. cooldown", async () => {
  const h = await setup({ session: { "cd:LOJ": Date.now() + 24 * 3600000 } });
  await nav(h, LOJA);
  assert.equal(await why(h), "cooldown");
});

test("6. manual + banner", async () => {
  const h = await setup({ local: { mode: "manual" } });
  await nav(h, LOJA);
  assert.equal(await why(h), "manual");
  assert.equal(h.banners.length, 1);
});

test("7. auto CUPOM -> redirect -> activated", async () => {
  const h = await setup();
  await nav(h, LOJA);
  assert.equal(h.tabUpdates.length, 1);
  assert.equal(h.tabUpdates[0].url, CATALOG["loja.com.br"].link);
  const link = CATALOG["loja.com.br"].link;
  await h.fire("webRequest.onBeforeRequest", { tabId: 1, url: link, type: "main_frame" });
  await h.fire("webNavigation.onCompleted", { tabId: 1, frameId: 0, url: link });
  assert.equal(await why(h), "activated");
});

test("8. CPF: need_login then need_cpf", async () => {
  let h = await setup({}, CPFURL);
  await nav(h, CPFURL);
  assert.equal(await why(h), "need_login");
  h = await setup({}, CPFURL);
  h.cookies = [{ name: "KEYCLOAK_IDENTITY", domain: ".livelo.com.br" }];
  await nav(h, CPFURL);
  assert.equal(await why(h), "need_cpf");
});

test("9. CPF: error on 500, api_blocked without fetch", async () => {
  let h = await setup({ local: { cpf: "12345678909" } }, CPFURL);
  h.fail("/promotion-link", 500);
  await nav(h, CPFURL);
  assert.equal(await why(h), "error");
  assert.equal(promo(h).length, 1);
  h = await setup({ local: { cpf: "12345678909", blockedUntil: Date.now() + 3600000 } }, CPFURL);
  await nav(h, CPFURL);
  assert.equal(await why(h), "api_blocked");
  assert.equal(promo(h).length, 0);
});

test("10. status returns why per tab", async () => {
  const h = await setup({ local: { disabled: { "loja.com.br": true } } });
  await nav(h, LOJA);
  const a = await h.send({ type: "status", url: LOJA, tabId: 1 });
  assert.equal(a.why, "disabled");
  const b = await h.send({ type: "status", url: LOJA, tabId: 99 });
  assert.equal(b.why, null);
});

test("11. tabs.onRemoved clears why", async () => {
  const h = await setup({ local: { disabled: { "loja.com.br": true } } });
  await nav(h, LOJA);
  assert.equal(await why(h), "disabled");
  await h.fire("tabs.onRemoved", 1);
  const s = await h.chrome.storage.session.get(null);
  assert.equal(Object.hasOwn(s, "why:1"), false);
});
