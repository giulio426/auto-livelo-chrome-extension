import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground } from "./harness.mjs";

const CPF = "12345678909";
const CPFURL = "https://www.cpf.com.br/";
const CACHED = "https://www.loja-cpf.example.com.br/promo?pid=123";
const PAGE = "https://www.livelo.com.br/juntar-pontos/parceiros/cpf/CPF";
const CATALOG = {
  "cpf.com.br": { host: "cpf.com.br", code: "CPF", name: "Cpf", journey: "CPF", link: CPFURL, coupon: null, px: null, pts: "", page: PAGE },
};

// storage = existing { local } to simulate restart (session is fresh)
async function setup({ local = {}, storage } = {}) {
  const st = storage ? { local: storage.local, session: {} } : { local: { catalog: CATALOG, cpf: CPF, ...local }, session: {} };
  const h = await loadBackground({ storage: st });
  h.tabs[1] = { id: 1, url: CPFURL };
  return h;
}
const nav = (h) => h.fire("webNavigation.onCommitted", { tabId: 1, frameId: 0, url: CPFURL });
const why = async (h) => (await h.chrome.storage.session.get("why:1"))["why:1"];
const promo = (h) => h.fetchLog.filter((f) => f.url.includes("/promotion-link"));
const clearCd = (h) => h.chrome.storage.session.remove("cd:cpf.com.br");

test("1. first activation POSTs and caches", async () => {
  const h = await setup();
  await nav(h);
  assert.equal(promo(h).length, 1);
  assert.equal(promo(h)[0].method, "POST");
  assert.ok(promo(h)[0].body.includes('"customerId":"12345678909"'));
  assert.ok(promo(h)[0].body.includes("CPF"));
  const c = h.storage.local["promo:CPF"];
  assert.equal(c.link, CACHED);
  assert.equal(c.cpf, CPF);
  assert.equal(typeof c.t, "number");
  assert.equal(h.tabUpdates.at(-1).url, CACHED);
});

test("2. restart reuses cache, no POST", async () => {
  const h1 = await setup();
  await nav(h1);
  const h2 = await setup({ storage: h1.storage });
  await nav(h2);
  assert.equal(promo(h2).length, 0);
  assert.equal(h2.tabUpdates.at(-1).url, CACHED);
});

test("3. cache older than 24h -> new POST", async () => {
  const h1 = await setup();
  await nav(h1);
  h1.storage.local["promo:CPF"].t = Date.now() - 25 * 3600000;
  const h2 = await setup({ storage: h1.storage });
  await nav(h2);
  assert.equal(promo(h2).length, 1);
});

test("4. CPF changed -> new POST", async () => {
  const h1 = await setup();
  await nav(h1);
  h1.storage.local.cpf = "98765432100";
  const h2 = await setup({ storage: h1.storage });
  await nav(h2);
  assert.equal(promo(h2).length, 1);
  assert.ok(promo(h2)[0].body.includes('"customerId":"98765432100"'));
  assert.equal(h2.storage.local["promo:CPF"].cpf, "98765432100");
});

test("5. 403 blocks, banner, no retry", async () => {
  const h = await setup();
  h.fail("/promotion-link", 403);
  await nav(h);
  assert.equal(promo(h).length, 1);
  assert.ok(h.storage.local.blockedUntil > Date.now());
  assert.equal(await why(h), "api_blocked");
  assert.equal(h.banners.length, 1);
  assert.ok(h.banners[0].args[0].actions.some((a) => a.label === "Ver na Livelo"));
  assert.equal(h.tabUpdates.length, 0);
  await clearCd(h);
  await nav(h);
  assert.equal(promo(h).length, 1);
  assert.equal(await why(h), "api_blocked");
});

test("6. no CPF, not logged in -> need_login, no POST", async () => {
  const h = await setup({ local: { cpf: "" } });
  await nav(h);
  assert.equal(promo(h).length, 0);
  assert.equal(await why(h), "need_login");
});
