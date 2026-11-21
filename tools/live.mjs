// Live test driver: one Chromium window with the unpacked MV3 extension. Run scenarios strictly one at a time.
// Usage: node tools/live.mjs <selftest|l2|l3|l5|prerender> [--fresh]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LIVELO_PW || "C:/Users/giuli/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(scriptDir, "..");
const executablePath = process.env.LIVELO_CHROMIUM || "C:/Users/giuli/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe";
const userDataDir = path.join(os.tmpdir(), "livelo-live-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCKED = "BLOQUEADO: e403/e429 detectado — parar a rodada";
let lastVisit = 0;

export async function launch({ fresh = false } = {}) {
  if (fresh) fs.rmSync(userDataDir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 1280, height: 800 },
  });
  const sw0 = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  const extId = new URL(sw0.url()).host;
  const page = ctx.pages()[0] || (await ctx.newPage());

  const L = {
    ctx, sw: sw0, extId, page,
    local: (keys) => L.sw.evaluate((k) => chrome.storage.local.get(k), keys ?? null),
    session: (keys) => L.sw.evaluate((k) => chrome.storage.session.get(k), keys ?? null),
    stats: async () => (await L.local("stats")).stats || null,
    blocked: async () => {
      const { blockedUntil } = await L.local("blockedUntil");
      if (blockedUntil > Date.now()) return true;
      const s = (await L.stats()) || {};
      return (s.e403 || 0) > 0 || (s.e429 || 0) > 0;
    },
    whyActive: () => L.sw.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => x.url === u);
      if (!t) return { tabId: null, why: null, act: null };
      const id = t.id;
      const s = await chrome.storage.session.get(["why:" + id, "act:" + id]);
      return { tabId: id, why: s["why:" + id] || null, act: s["act:" + id] || null };
    }, L.page.url()),
    visit: async (url, { wait = 6000 } = {}) => {
      const gap = Date.now() - lastVisit;
      if (gap < 10000) await sleep(10000 - gap);
      lastVisit = Date.now();
      const nav = await L.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => ({ error: String(e) }));
      await L.page.waitForTimeout(wait);
      if (await L.blocked()) throw new Error(BLOCKED);
      return {
        url,
        finalUrl: L.page.url(),
        ...(await L.whyActive()),
        banner: await L.page.evaluate(() => !!document.getElementById("livelo-auto-banner")).catch(() => false),
        navError: nav?.error,
      };
    },
    popup: async () => {
      const p = await L.ctx.newPage();
      try {
        await p.goto(`chrome-extension://${L.extId}/popup.html`, { waitUntil: "domcontentloaded" });
        await sleep(1500);
        return { text: await p.innerText("body") };
      } finally {
        await p.close();
      }
    },
    send: async (msg) => {
      const p = await L.ctx.newPage();
      try {
        await p.goto(`chrome-extension://${L.extId}/popup.html`, { waitUntil: "domcontentloaded" });
        await sleep(1500);
        return await p.evaluate((m) => chrome.runtime.sendMessage(m), msg);
      } finally {
        await p.close();
      }
    },
    close: () => L.ctx.close(),
  };
  return L;
}

async function withLive(opts, fn) {
  const L = await launch(opts);
  try {
    return await fn(L);
  } finally {
    await L.close().catch(() => {});
  }
}

const NON_PARTNER = ["https://www.wikipedia.org/", "https://developer.mozilla.org/", "https://www.gov.br/"];
const PARTNER = [
  "https://www.boticario.com.br/", "https://www.petz.com.br/", "https://www.natura.com.br/",
  "https://www.carrefour.com.br/", "https://mercado.carrefour.com.br/",
  "https://www.insiderstore.com.br/", "https://www.belezanaweb.com.br/",
];

const SCEN = {
  async selftest(st, fresh) {
    return withLive({ fresh }, async (L) => {
      await sleep(5000);
      return {
        extId: L.extId,
        swUrl: L.sw.url(),
        statsKeys: Object.keys(await L.local()),
        popup: (await L.popup()).text.slice(0, 400),
      };
    });
  },

  async l2(st) {
    // Reinício do navegador com o mesmo perfil (runtime.reload derruba o contexto com --load-extension).
    const L0 = await launch();
    const before = await L0.stats();
    await sleep(3000);
    await L0.close();
    return withLive({}, async (L) => {
      await sleep(3000);
      const afterRestart = await L.stats();
      st.visits = [];
      for (const u of [...NON_PARTNER, ...PARTNER]) st.visits.push(await L.visit(u));
      const after = await L.stats();
      return { extId: L.extId, before, afterRestart, after, visits: st.visits, popup: (await L.popup()).text };
    });
  },

  async l3() {
    return withLive({ fresh: true }, async (L) => {
      const deadline = Date.now() + 90000;
      let vals = {};
      while (Date.now() < deadline) {
        vals = await L.local(["catalog", "failed", "stats", "updated"]);
        if (vals.updated) break;
        await sleep(10000);
      }
      return {
        catalogSize: Object.keys(vals.catalog || {}).length,
        failed: vals.failed,
        stats: vals.stats,
        alarms: await L.sw.evaluate(() => chrome.alarms.getAll()),
      };
    });
  },

  async l5(st) {
    const file = path.join(scriptDir, "l5-urls.json");
    if (!fs.existsSync(file)) throw new Error(`falta ${file}`);
    const urls = JSON.parse(fs.readFileSync(file, "utf8"));
    return withLive({}, async (L) => {
      st.visits = [];
      for (const u of urls) st.visits.push(await L.visit(u));
      const tally = {};
      for (const v of st.visits) {
        const k = String(v.why);
        tally[k] = (tally[k] || 0) + 1;
      }
      return { visits: st.visits, tally, stats: await L.stats() };
    });
  },

  async prerender(st) {
    const html = `<!doctype html><meta charset="utf-8"><script type="speculationrules">{"prerender":[{"source":"list","urls":["https://www.boticario.com.br/"]}]}</script><a id=a href="https://www.boticario.com.br/">go</a>`;
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    });
    await new Promise((r) => server.listen(8787, "127.0.0.1", r));
    try {
      return await withLive({}, async (L) => {
        await L.sw.evaluate(() => {
          self.__navlog = [];
          chrome.webNavigation.onCommitted.addListener((d) => self.__navlog.push({
            url: d.url, tabId: d.tabId, frameType: d.frameType, documentLifecycle: d.documentLifecycle, t: Date.now(),
          }));
        });
        await L.page.goto("http://127.0.0.1:8787/", { waitUntil: "domcontentloaded" });
        await sleep(8000);
        st.beforeClick = await L.sw.evaluate(() => self.__navlog);
        await L.page.click("#a");
        await sleep(8000);
        return {
          beforeClick: st.beforeClick,
          afterClick: await L.sw.evaluate(() => self.__navlog),
          why: await L.whyActive(),
        };
      });
    } finally {
      server.close();
    }
  },
};

async function main() {
  const scenario = process.argv[2];
  const fresh = process.argv.includes("--fresh");
  const st = {};
  if (!SCEN[scenario]) {
    console.log(JSON.stringify({ error: `cenario desconhecido: ${scenario}` }));
    process.exitCode = 1;
    return;
  }
  try {
    console.log(JSON.stringify(await SCEN[scenario](st, fresh)));
    process.exitCode = 0;
  } catch (e) {
    const msg = String(e?.message || e);
    console.log(JSON.stringify({ scenario, error: msg, ...st }));
    process.exitCode = msg.startsWith("BLOQUEADO") ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
