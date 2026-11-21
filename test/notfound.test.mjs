import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBackground } from "./harness.mjs";

const API = "https://apis.pontoslivelo.com.br";
const SEARCH = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "search.json"), "utf8");
const enabled = () => JSON.parse(SEARCH).content.filter((p) => p.enabled);
const n = (h, s) => h.fetchLog.filter((f) => f.url.startsWith(API) && f.url.includes(s)).length;
const local = (h, k) => h.chrome.storage.local.get(k);
const settle = async (h) => { await h.idle(); const b = h.eval("building"); if (b) await b.catch(() => {}); await h.idle(); };
const mkSeed = (skip) => Object.fromEntries(enabled().filter((p) => !skip.includes(p.code)).map((p) => [p.code, {
  mod: p.lastModifiedDate,
  entry: { host: p.code.toLowerCase() + ".example.com.br", code: p.code, journey: p.journeyType, link: "https://www." + p.code.toLowerCase() + ".example.com.br/livelo", coupon: null, px: null },
}]));
const [C1, C2, C3] = enabled().map((p) => p.code);
const prof = (h, c) => n(h, "/v1/profiles/" + c);

test("1. 404/400 store null entry, count as done, no continue", async () => {
  const h = await loadBackground({ seed: mkSeed([C1, C2]) });
  h.fail("/v1/profiles/" + C1, 404);
  h.fail("/v1/profiles/" + C2, 400);
  await h.eval("buildCatalog")();
  const st = await local(h, ["details", "failed"]);
  assert.equal(st.details[C1].entry, null);
  assert.equal(st.details[C2].entry, null);
  assert.equal(st.failed, 0);
  assert.equal(h.alarms.continue, undefined);
  assert.equal(prof(h, C1), 1);
  assert.equal(prof(h, C2), 1);
});

test("2. later builds and continue alarm do not refetch", async () => {
  const h = await loadBackground({ seed: mkSeed([C1, C2]) });
  h.fail("/v1/profiles/" + C1, 404);
  h.fail("/v1/profiles/" + C2, 400);
  await h.eval("buildCatalog")();
  await h.eval("buildCatalog")();
  await h.fire("alarms.onAlarm", { name: "continue" });
  await settle(h);
  assert.equal(prof(h, C1), 1);
  assert.equal(prof(h, C2), 1);
});

test("3. changed lastModifiedDate refetches exactly once", async () => {
  const h = await loadBackground({ seed: mkSeed([C1, C2]) });
  h.fail("/v1/profiles/" + C1, 404);
  h.fail("/v1/profiles/" + C2, 400);
  await h.eval("buildCatalog")();
  const data = JSON.parse(SEARCH);
  data.content.find((p) => p.code === C1).lastModifiedDate = "changed-" + Date.now();
  h.route("/profiles/search", () => ({ data }));
  await h.eval("buildCatalog")(true);
  await h.eval("buildCatalog")();
  assert.equal(prof(h, C1), 2);
  assert.equal(prof(h, C2), 1);
});

test("4. 500 breaks batch, not stored, continue scheduled", async () => {
  const h = await loadBackground({ seed: mkSeed([C3]) });
  h.fail("/v1/profiles/" + C3, 500);
  await h.eval("buildCatalog")();
  const st = await local(h, ["details", "failed"]);
  assert.ok(st.failed > 0);
  assert.equal(st.details[C3], undefined);
  assert.ok(h.alarms.continue, "continue scheduled");
});
