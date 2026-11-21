// Offline harness: runs background.js inside a vm context with mocked chrome.*, fetch, timers.
// Never touches the network: every fetch goes through the in-memory router below.
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(TEST_DIR, "..");
const FIX = join(TEST_DIR, "fixtures");
const SEARCH = join(FIX, "search.json");
const PLUGIN = join(FIX, "plugin.json");
const PARITIES = join(FIX, "parities.json");
const PROFILES = join(FIX, "profiles");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const tick = () => new Promise((r) => setImmediate(r));
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

// chrome.events.* stub: listeners live in _l.
const ev = () => {
  const l = [];
  return {
    _l: l,
    addListener(fn) { if (!l.includes(fn)) l.push(fn); },
    removeListener(fn) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    hasListener(fn) { return l.includes(fn); },
  };
};

// chrome.storage area backed by a plain object.
function makeArea(store) {
  const has = (k) => Object.hasOwn(store, k);
  return {
    async get(keys) {
      if (keys == null) return clone(store);
      if (typeof keys === "string") return has(keys) ? { [keys]: clone(store[keys]) } : {};
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (has(k)) out[k] = clone(store[k]);
        return out;
      }
      const out = {};
      for (const [k, d] of Object.entries(keys)) out[k] = has(k) ? clone(store[k]) : clone(d);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) store[k] = clone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
    async clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
}

// Default offline responses. Returns { status?, data?, headers? }.
function defaultRoute(url, opts) {
  if (url.includes("/bff-partners-profile/v2/profiles/search")) return { data: readJson(SEARCH) };
  const m = url.match(/\/bff-partners-profile\/v1\/profiles\/([A-Z0-9]+)/);
  if (m) {
    const code = m[1];
    const file = join(PROFILES, code + ".json");
    if (existsSync(file)) return { data: readJson(file) };
    const item = readJson(SEARCH).content.find((p) => p.code === code);
    if (!item) return { status: 404, data: {} };
    return {
      data: {
        ...item,
        partnerLink: "https://www." + code.toLowerCase() + ".example.com.br/livelo",
        coupon: null,
        pixelEnabledWeb: false,
        pixelUrlParamWeb: null,
      },
    };
  }
  if (url.includes("/configurations/v1/parities-plugin")) return { data: readJson(PLUGIN) };
  if (url.includes("/api-bff-partners-parities/v1/parities/active")) return { data: readJson(PARITIES) };
  if (url.includes("/partners-benefits-router/v2/promotion-link")) {
    return { data: { link: "https://www.loja-cpf.example.com.br/promo?pid=123" } };
  }
  if (url.startsWith("chrome-extension://") && url.endsWith("/seed.json")) {
    return opts.seed ? { data: opts.seed } : { status: 404, data: {} };
  }
  return { status: 404, data: {} };
}

export async function loadBackground(opts = {}) {
  const storage = opts.storage ?? { local: {}, session: {} };
  const h = {};
  h.storage = storage;
  h.fetchLog = [];
  h.timeouts = [];
  h.alarms = {};
  h.alarmLog = [];
  h.tabs = {};
  h.tabUpdates = [];
  h.tabCreates = [];
  h.cookies = [];
  h.banners = [];

  // Route overrides: later routes win over earlier ones and over defaults.
  const routes = [];
  h.route = (pattern, handler) => { routes.push({ pattern, handler }); };
  h.fail = (pattern, status, headers = {}) => h.route(pattern, () => ({ status, data: {}, headers }));
  h.unroute = () => { routes.length = 0; };

  async function fetchMock(url, init) {
    const u = String(url);
    h.fetchLog.push({ url: u, method: init?.method || "GET", body: init?.body });
    const hit = [...routes].reverse().find((r) =>
      typeof r.pattern === "string" ? u.includes(r.pattern) : r.pattern.test(u));
    const res = hit ? await hit.handler(u, init ?? {}) : defaultRoute(u, opts);
    const status = res.status ?? 200;
    const headers = Object.fromEntries(
      Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const data = res.data ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => clone(data),
      text: async () => JSON.stringify(data),
    };
  }

  const chrome = {
    id: "testid",
    storage: { local: makeArea(storage.local ??= {}), session: makeArea(storage.session ??= {}) },
    alarms: {
      create(name, info) { h.alarms[name] = info; h.alarmLog.push({ name, ...info }); },
      async get(name) { return h.alarms[name] ? { name, ...h.alarms[name] } : undefined; },
      async getAll() { return Object.entries(h.alarms).map(([name, info]) => ({ name, ...info })); },
      async clear(name) { const had = Object.hasOwn(h.alarms, name); delete h.alarms[name]; return had; },
      onAlarm: ev(),
    },
    runtime: {
      id: "testid",
      getManifest() {
        const m = readJson(join(EXT_DIR, "manifest.json"));
        return opts.dev === true ? m : { ...m, update_url: "https://clients2.google.com/service/update2/crx" };
      },
      getURL: (p) => "chrome-extension://testid/" + p,
      async sendMessage() {},
      onInstalled: ev(),
      onStartup: ev(),
      onMessage: ev(),
    },
    webNavigation: { onCommitted: ev(), onCompleted: ev() },
    webRequest: { onBeforeRequest: ev() },
    cookies: {
      async getAll() { return clone(h.cookies); },
      onChanged: ev(),
    },
    tabs: {
      async get(id) { return h.tabs[id] ?? { id, url: "https://example.com/" }; },
      async update(id, props) {
        h.tabs[id] = { ...(h.tabs[id] ?? { id }), url: props.url };
        h.tabUpdates.push({ id, url: props.url });
        return h.tabs[id];
      },
      async create(o) { h.tabCreates.push(o); return { id: h.tabCreates.length, ...o }; },
      async query() { return []; },
      onRemoved: ev(),
      onUpdated: ev(),
    },
    scripting: {
      executeScript({ target, args }) {
        h.banners.push({ tabId: target.tabId, args });
        return Promise.resolve([]);
      },
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
  };
  h.chrome = chrome;

  const sandbox = {
    console, URL, URLSearchParams, JSON, Math, Date, Promise, Error,
    encodeURIComponent, structuredClone, queueMicrotask,
    setTimeout(fn, ms) { h.timeouts.push(ms); setImmediate(fn); return 0; },
    clearTimeout() {},
    importScripts(...files) {
      for (const f of files) {
        const p = join(EXT_DIR, f);
        vm.runInContext(readFileSync(p, "utf8"), context, { filename: p });
      }
    },
    fetch: fetchMock,
    chrome,
  };
  const context = vm.createContext(sandbox);
  h.context = context;

  // Top-level const/let of background.js are not sandbox props; evaluate them here.
  h.eval = (expr) => vm.runInContext(expr, context);

  h.idle = async () => { for (let i = 0; i < 50; i++) await tick(); };

  // Dispatch to every listener of an event path like "webNavigation.onCommitted".
  h.fire = async (path, ...args) => {
    const [ns, name] = path.split(".");
    const listeners = chrome[ns][name]._l.slice();
    const results = await Promise.allSettled(listeners.map((fn) => new Promise((res) => res(fn(...args)))));
    await h.idle();
    return results;
  };

  // Simulate runtime.sendMessage to background; resolves with the first reply() value.
  h.send = (msg, sender = { tab: { id: 1, url: "https://example.com/" } }) => new Promise((resolve) => {
    let done = false;
    const reply = (v) => { if (!done) { done = true; resolve(v); } };
    for (const fn of chrome.runtime.onMessage._l.slice()) {
      try { fn(msg, sender, reply); } catch (e) { reply({ error: String(e) }); }
    }
    (async () => {
      for (let i = 0; i < 500 && !done; i++) await tick();
      reply(undefined);
    })();
  });

  const bgPath = join(EXT_DIR, "background.js");
  vm.runInContext(readFileSync(bgPath, "utf8"), context, { filename: bgPath });
  await h.idle();
  return h;
}
