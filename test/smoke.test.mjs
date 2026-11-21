import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadBackground } from "./harness.mjs";

const PLL = JSON.parse(readFileSync(new URL("./fixtures/profiles/PLL.json", import.meta.url), "utf8"));

test("loads background.js without throwing and registers core listeners", async () => {
  const h = await loadBackground();
  assert.ok(h.chrome.webNavigation.onCommitted._l.length >= 1);
  assert.ok(h.chrome.runtime.onMessage._l.length >= 1);
  assert.ok(h.chrome.alarms.onAlarm._l.length >= 1);
  assert.ok(h.chrome.runtime.onInstalled._l.length >= 1);
});

test("pure helpers resolve hosts", async () => {
  const h = await loadBackground();
  assert.equal(h.eval("base")("www.loja.com.br"), "loja.com.br");
  assert.equal(h.eval("hostOf")("https://shop.example.com/x"), "example.com");
  assert.equal(
    h.eval("storeHost")("https://click.linksynergy.com/deeplink?id=1&murl=https%3A%2F%2Fonelink.shein.com%2F38"),
    "shein.com",
  );
});

test("toEntry maps a profile detail to a catalog entry", async () => {
  const h = await loadBackground();
  assert.equal(h.eval("toEntry")({ code: "PLL", journeyType: "CUPOM" }, PLL).host, "portallar.com.br");
});

test("catalog build only performs mocked network requests", async () => {
  const h = await loadBackground();
  try {
    await h.eval("buildCatalog")();
  } catch {
    // Mock-only: failures are acceptable here, the assertion below is what matters.
  }
  assert.ok(h.fetchLog.length >= 1);
  for (const { url } of h.fetchLog) {
    assert.ok(
      url.startsWith("https://apis.pontoslivelo.com.br") || url.startsWith("chrome-extension://"),
      `unexpected request: ${url}`,
    );
  }
});
