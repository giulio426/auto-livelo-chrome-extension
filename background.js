importScripts("banner.js");

const API = "https://apis.pontoslivelo.com.br";
const LIVELO = "https://www.livelo.com.br";
const DAY = 24 * 3600 * 1000;

// Descobertos na Fase 0 (inspeção da sessão logada em livelo.com.br).
// Login via SSO Keycloak (cookies em acesso.livelo.com.br). O token Bearer fica só em memória
// na página, então o CPF vem do popup.
const SESSION = {
  loginUrl: LIVELO + "/",
  cookie: /^KEYCLOAK_IDENTITY$/,
};

const base = (h) => {
  const p = h.replace(/^www\./, "").split(".");
  const n = p.length > 2 && p.at(-1).length === 2 && p.at(-2).length <= 3 ? 3 : 2;
  return p.slice(-n).join(".");
};
const hostOf = (u) => { try { return base(new URL(u).hostname); } catch { return null; } };
const fullHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

class HttpError extends Error {
  constructor(url, status, retryAfter) { super(url + " " + status); this.status = status; this.retryAfter = retryAfter || null; }
}

// Contadores por hora (diagnóstico de bloqueio): storage.local.stats
async function count(kind, url, status) {
  const hour = Math.floor(Date.now() / 3600000);
  let { stats } = await chrome.storage.local.get("stats");
  if (!stats || stats.hour !== hour) stats = { hour, ok: 0, e403: 0, e429: 0, e5xx: 0, net: 0, other: 0 };
  stats[kind]++;
  stats.last = { url, status, t: Date.now() };
  await chrome.storage.local.set({ stats });
}

// Único ponto de rede para a API Livelo.
async function api(url, opts) {
  const { blockedUntil = 0, backoff = 0 } = await chrome.storage.local.get(["blockedUntil", "backoff"]);
  if (blockedUntil > Date.now()) throw Object.assign(new HttpError(url, 0), { blocked: true });
  let r;
  try { r = await fetch(url, opts); } catch { await count("net", url, 0); throw new HttpError(url, 0); }
  const kind = r.ok ? "ok" : r.status === 403 ? "e403" : r.status === 429 ? "e429" : r.status >= 500 ? "e5xx" : "other";
  await count(kind, url, r.status);
  if (r.status === 403 || r.status === 429) {
    const next = backoff ? Math.min(backoff * 2, BACKOFF_MAX) : BACKOFF0;
    const ra = Number(r.headers.get("retry-after")) * 1000 || 0;
    const wait = Math.max(next, ra);
    await chrome.storage.local.set({ blockedUntil: Date.now() + wait, backoff: next });
    throw Object.assign(new HttpError(url, r.status, r.headers.get("retry-after")), { blocked: true });
  }
  if (!r.ok) throw new HttpError(url, r.status, r.headers.get("retry-after"));
  if (r.ok && backoff) await chrome.storage.local.set({ backoff: 0 });
  return r.json();
}

// Link de afiliado guarda a loja real num parâmetro (murl, ued, ulp, url, u…): segue o primeiro valor que é URL http(s), até 2 níveis.
const target = (link, depth = 0) => {
  try {
    const u = new URL(link);
    if (depth < 2) for (const [, v] of u.searchParams) if (/^https?:\/\//i.test(v)) return target(v, depth + 1);
    return u.href;
  } catch { return null; }
};
const storeHost = (link) => hostOf(target(link));

const points = (p) => {
  const x = p?.parity;
  return x ? `${x.parity} pt${x.parity > 1 ? "s" : ""} por ${x.currency} ${x.currencyValue}` : "";
};

// A API (Akamai) bloqueia o IP em rajadas (403 na API e em static.livelo.com.br: o site da Livelo fica em branco).
// Por isso o catálogo é incremental: 1 requisição de lista + detalhe só de parceiros novos/alterados,
// em lotes pequenos e espaçados; no primeiro 403 para e tenta de novo bem mais tarde.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 15;
const GAP = 4000; // ±1s de variação entre detalhes
const HOUR = 3600000;
const DEV = !("update_url" in chrome.runtime.getManifest()); // extensão carregada sem pacote
const BACKOFF0 = 30 * 60000;
const BACKOFF_MAX = 12 * 3600000;

function toEntry(p, d) {
  const host = d.partnerLink && storeHost(d.partnerLink);
  if (!host || host.endsWith("livelo.com.br")) return null;
  // Mesmo critério do site: parceiro com pixel recebe ?<param>=<gtm_ga_ids>; sem param próprio, "livelo_origem".
  const px = d.pixelEnabledWeb ? d.pixelUrlParamWeb || "livelo_origem" : null;
  return { host, code: p.code, journey: p.journeyType, link: d.partnerLink, coupon: d.coupon || null, px };
}

// Catálogo pré-gerado (tools/seed.mjs): evita baixar ~265 detalhes numa instalação nova.
async function loadSeed() {
  try { const r = await fetch(chrome.runtime.getURL("seed.json")); return r.ok ? await r.json() : {}; } catch { return {}; }
}

async function doBuild(full = false) {
  let map = {}, pending = 0, failed = false;
  try {
    let { details, list, listAt = 0, feed, feedAt = 0 } = await chrome.storage.local.get(["details", "list", "listAt", "feed", "feedAt"]); // details: code -> { mod, entry }
    if (!details || !Object.keys(details).length) details = await loadSeed();
    if (full || !list || Date.now() - listAt > 12 * HOUR) {
      try {
        list = (await api(`${API}/bff-partners-profile/v2/profiles/search?size=500`)).content.filter((p) => p.enabled);
        listAt = Date.now();
        await chrome.storage.local.set({ list, listAt });
      } catch (e) { if (!list) throw e; failed = true; } // sem lista nova, segue com a anterior
    }
    // Jornada CPF primeiro: sem o detalhe dela não há como gerar o link personalizado.
    const todo = list.filter((p) => details[p.code]?.mod !== p.lastModifiedDate).sort((a, b) => (b.journeyType === "CPF") - (a.journeyType === "CPF"));
    let done = 0;
    for (const p of todo.slice(0, BATCH)) {
      try {
        details[p.code] = { mod: p.lastModifiedDate, entry: toEntry(p, await api(`${API}/bff-partners-profile/v1/profiles/${p.code}`)) };
        done++;
      } catch (e) {
        // Perfil inexistente para esta versão do parceiro: grava vazio para não tentar de novo até ele mudar.
        if (e.status === 404 || e.status === 400) { details[p.code] = { mod: p.lastModifiedDate, entry: null }; done++; }
        else { failed = true; break; }
      }
      await sleep(GAP + Math.round((Math.random() * 2 - 1) * 1000));
    }

    const vals = [];
    for (const p of list) {
      const e = details[p.code]?.entry;
      const t = e && target(e.link);
      if (t) vals.push([t, { ...e, host: hostOf(t), name: p.name, pts: points(p), page: p.detailsPage }]);
    }
    for (const k of [fullHost, hostOf]) for (const [t, v] of vals) { const h = k(t); if (h && !h.endsWith("livelo.com.br") && !map[h]) map[h] = v; }
    if (!feed || Date.now() - feedAt > 7 * 24 * HOUR) {
      try { feed = await api(`${API}/configurations/v1/parities-plugin`); feedAt = Date.now(); await chrome.storage.local.set({ feed, feedAt }); } catch {}
    }
    for (const s of feed?.sites || []) {
      const host = hostOf(s.json_hostname);
      if (!host || map[host] || !s.json_ativa_livelo || !s.json_redirect_site) continue;
      map[host] = { code: null, name: host, journey: "HOTSITE", pts: "", link: s.json_redirect_site, coupon: null };
    }

    pending = todo.length - done;
    await chrome.storage.local.set({ details, catalog: map, updated: Date.now(), failed: pending });
    mem = map;
    return map;
  } catch (e) {
    failed = true;
  } finally {
    if (pending > 0 || failed) {
      const { blockedUntil = 0 } = await chrome.storage.local.get("blockedUntil");
      chrome.alarms.create("continue", { when: Math.max(Date.now() + 5 * 60000, blockedUntil + 60000) });
    }
  }
  return {};
}

let building = null;
const buildCatalog = (full = false) => (building ||= doBuild(full).finally(() => { building = null; }));

let mem = null; // catálogo em memória enquanto o service worker vive
const catalog = async () => mem || (mem = (await chrome.storage.local.get("catalog")).catalog || null) || {};
const lookup = async (url) => { const c = await catalog(); return c[fullHost(url)] || c[hostOf(url)] || null; };
const settings = async () => ({ mode: "auto", disabled: {}, cpf: "", ...(await chrome.storage.local.get(["mode", "disabled", "cpf"])) });

// --- sessão Livelo ---
async function loggedIn() {
  const cs = await chrome.cookies.getAll({ domain: "livelo.com.br" });
  return cs.some((c) => SESSION.cookie.test(c.name));
}

const getCpf = async () => (await settings()).cpf.replace(/\D/g, "") || null;

async function updateBadge() {
  await chrome.action.setBadgeText({ text: (await loggedIn()) ? "" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#ff0a8c" });
}

// --- link final ---
// gtm_ga_ids vem do localStorage da Livelo (espelhado por livelo.js). Mesma regra do site:
// só acrescenta se o parceiro tem pixel, o valor existe e o link ainda não traz o parâmetro.
async function withPixel(link, p) {
  if (!p.px || link.includes(p.px + "=")) return link;
  const { gaIds } = await chrome.storage.local.get("gaIds");
  return gaIds ? `${link}${link.includes("?") ? "&" : "?"}${p.px}=${encodeURIComponent(gaIds)}` : link;
}

async function resolveLink(host, p) {
  if (p.journey !== "CPF") return { link: await withPixel(p.link, p) };
  const key = "promo:" + p.code;
  const cpf = await getCpf();
  if (!cpf) return { need: (await loggedIn()) ? "cpf" : "login" };
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && cached.cpf === cpf && Date.now() - cached.t < DAY) return { link: await withPixel(cached.link, p) };
  // Sem o link personalizado a compra não pontua: em caso de falha, avisa em vez de cair no link genérico.
  try {
    const { link } = await api(`${API}/partners-benefits-router/v2/promotion-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: cpf, redemptionPartnerCode: p.code }),
    });
    if (!link) return { need: "error" };
    await chrome.storage.local.set({ [key]: { link, t: Date.now(), cpf } });
    return { link: await withPixel(link, p) };
  } catch (e) { return { need: e.blocked ? "blocked" : "error" }; }
}

// --- redirect ---
const SKIP_PATH = /\/(cart|carrinho|checkout|login|signin)(\/|$|\?)/i;
const tagged = (u) => /livelo|matt_tool=/i.test(u);

const inject = (tabId, opts) =>
  chrome.scripting.executeScript({ target: { tabId }, func: showBanner, args: [opts] }).catch(() => {});

const ckey = (p, host) => p?.code || host; // cooldown por parceiro (Carrefour Shopping x Mercado = mesmo domínio)
const cooldown = async (host, ms) => {
  const key = "cd:" + host;
  if (ms) return chrome.storage.session.set({ [key]: Date.now() + ms });
  return ((await chrome.storage.session.get(key))[key] || 0) > Date.now();
};

// Motivo da última decisão por aba (diagnóstico no popup).
const setWhy = (tabId, why) => chrome.storage.session.set({ ["why:" + tabId]: why });

// Redirect em andamento por aba: só vira "ativada" quando o link foi de fato pedido ao servidor.
// Alvo = mesmo host (sem www) e path, com todos os parâmetros do link presentes na URL.
const sameTarget = (url, link) => {
  try {
    const u = new URL(url), l = new URL(link), h = (x) => x.hostname.replace(/^www\./, "");
    const path = (x) => x.pathname.replace(/\/$/, "");
    return h(u) === h(l) && path(u) === path(l) && [...l.searchParams].every(([k, v]) => u.searchParams.get(k) === v);
  } catch { return false; }
};
const getAct = async (tabId) => {
  const a = (await chrome.storage.session.get("act:" + tabId))["act:" + tabId];
  if (a && Date.now() - (a.t || 0) > 30000) { await chrome.storage.session.remove("act:" + tabId); return null; }
  return a;
};
const setAct = (tabId, a) => chrome.storage.session.set({ ["act:" + tabId]: a });

const pageBtn = (p) => (p.page ? [{ label: "Ver na Livelo", type: "open", url: p.page }] : []);

// Orientação objetiva: cupom no checkout x só comprar.
const hint = (p) => (p.journey === "CUPOM" && p.coupon ? `Cole o cupom ${p.coupon} no carrinho antes de pagar.` : "Compre normalmente: não precisa de cupom.");

async function activate(tabId, host, p) {
  const r = await resolveLink(host, p);
  if (r.need) {
    await setWhy(tabId, { login: "need_login", cpf: "need_cpf", blocked: "api_blocked" }[r.need] || "error");
    const login = r.need === "login";
    const text = { login: "Entre na Livelo para pontuar nesta loja.", cpf: "Informe seu CPF no ícone da extensão para pontuar nesta loja.", blocked: "A Livelo limitou o acesso temporariamente. Tente novamente mais tarde.", error: "Não foi possível gerar o link Livelo agora. Tente novamente em alguns minutos." }[r.need];
    return inject(tabId, {
      text,
      actions: [...(login ? [{ label: "Entrar", type: "login" }] : []), ...pageBtn(p)],
    });
  }
  await cooldown(ckey(p, host), 30 * 60000); // vira 24h só quando a ativação for confirmada
  const from = (await chrome.tabs.get(tabId)).url;
  await setAct(tabId, { host, link: r.link, from, tries: 1, seen: false, p, t: Date.now() });
  await chrome.tabs.update(tabId, { url: r.link });
}

async function onNavigate({ tabId, frameId, url }) {
  if (frameId !== 0 || !url.startsWith("http")) return;
  const host = hostOf(url);
  const p = host && (await lookup(url));
  if (!p) return setWhy(tabId, "not_in_catalog");
  const s = await settings();
  const u = new URL(url);
  if (s.disabled[host]) return setWhy(tabId, "disabled");
  if (tagged(url)) return setWhy(tabId, "tagged");
  if (SKIP_PATH.test(u.pathname)) return setWhy(tabId, "skip_path");
  if (await cooldown(ckey(p, host))) return setWhy(tabId, "cooldown");
  if (s.mode === "auto") return activate(tabId, host, p);
  await setWhy(tabId, "manual");
  const actions = [{ label: "Ativar", type: "activate" }, ...pageBtn(p)];
  if (p.coupon && p.journey === "CUPOM") actions.push({ label: `Copiar cupom ${p.coupon}`, type: "copy", text: p.coupon });
  inject(tabId, { text: `Ganhe ${p.pts || "pontos"} na Livelo em ${p.name}. ${hint(p)}`, actions });
}

// Após o redirect: confere se o link foi mesmo alcançado antes de dizer que ativou.
// Sites que redirecionam sozinhos (ex.: Booking) podem atropelar o nosso: tenta mais uma vez.
async function onLoaded({ tabId, frameId, url }) {
  if (frameId !== 0) return;
  const a = await getAct(tabId);
  if (!a) return;
  const p = a.p || (await lookup(url));
  if (!a.seen && url === a.from) return; // fim do carregamento da página original; o redirect ainda está a caminho
  if (!a.seen && !sameTarget(url, a.link)) {
    if (hostOf(url) !== a.host) return; // passando por outro domínio (ex.: rede de afiliados)
    if (a.tries < 2) {
      await setAct(tabId, { ...a, tries: 2, t: Date.now() });
      return chrome.tabs.update(tabId, { url: a.link });
    }
    await chrome.storage.session.remove("act:" + tabId);
    await setWhy(tabId, "error");
    return inject(tabId, {
      text: "Não consegui ativar a Livelo aqui: o site redirecionou para outra página.",
      actions: [{ label: "Tentar de novo", type: "activate" }, ...pageBtn(p)],
    });
  }
  await chrome.storage.session.remove("act:" + tabId);
  await setWhy(tabId, "activated");
  await cooldown(ckey(p, a.host), DAY);
  const coupon = p.journey === "CUPOM" && p.coupon;
  const actions = [...(coupon ? [{ label: `Copiar cupom ${p.coupon}`, type: "copy", text: p.coupon }] : []), ...pageBtn(p)];
  const text = `Livelo ativada${p.pts ? " · " + p.pts : ""}` + (sameTarget(url, a.link) ? "" : " · o site voltou à página inicial") + ". " + hint(p);
  inject(tabId, { text, actions, autoHide: coupon ? 0 : 10000 });
}

// Marca que o link foi pedido ao servidor (mesmo que ele responda com redirect de volta à loja).
chrome.webRequest.onBeforeRequest.addListener(
  async (d) => {
    const a = d.tabId >= 0 && (await getAct(d.tabId));
    if (a && !a.seen && sameTarget(d.url, a.link)) await setAct(d.tabId, { ...a, seen: true });
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
);

chrome.webNavigation.onCommitted.addListener((d) => onNavigate(d).catch(console.error));
chrome.webNavigation.onCompleted.addListener((d) => onLoaded(d).catch(console.error));

// --- mensagens (banner e popup) ---
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const tab = sender.tab;
    if (m.type === "activate") {
      const host = hostOf(tab.url);
      return activate(tab.id, host, await lookup(tab.url));
    }
    if (m.type === "login") return chrome.tabs.create({ url: SESSION.loginUrl });
    if (m.type === "dismiss") { const p = await lookup(tab.url); return cooldown(ckey(p, hostOf(tab.url)), DAY); }
    if (m.type === "reactivate") {
      const keys = [];
      if (m.host) keys.push("cd:" + m.host);
      if (m.url) keys.push("cd:" + ckey(await lookup(m.url), hostOf(m.url)));
      return chrome.storage.session.remove(keys);
    }
    if (m.type === "refresh") {
      const { blockedUntil = 0, refreshedAt = 0 } = await chrome.storage.local.get(["blockedUntil", "refreshedAt"]);
      if (blockedUntil > Date.now()) return { error: "blocked", until: blockedUntil };
      if (Date.now() - refreshedAt < 10 * 60000) return { error: "too_soon" };
      await chrome.storage.local.set({ refreshedAt: Date.now() });
      await buildCatalog(true);
      return true;
    }
    if (m.type === "toggle") {
      const s = await settings();
      s.disabled[m.host] = !s.disabled[m.host];
      await chrome.storage.local.set({ disabled: s.disabled });
      return s.disabled[m.host];
    }
    if (m.type === "status") {
      const [c, s, st] = await Promise.all([catalog(), settings(), chrome.storage.local.get(["updated", "failed", "stats", "blockedUntil"])]);
      const host = hostOf(m.url || "");
      const p = await lookup(m.url || "");
      const why = m.tabId != null ? (await chrome.storage.session.get("why:" + m.tabId))["why:" + m.tabId] || null : null;
      return { why, loggedIn: await loggedIn(), count: new Set(Object.values(c).map((v) => v.code || v.link)).size, updated: st.updated, failed: st.failed || 0, stats: st.stats || null, blockedUntil: st.blockedUntil || 0, host, partner: p ? p.name : null, page: p?.page, journey: p?.journey || null, coupon: p?.journey === "CUPOM" ? p.coupon || null : null, pts: p?.pts || "", disabled: !!s.disabled[host] };
    }
  })().then(reply, (e) => reply({ error: String(e) }));
  return true;
});

// --- ciclo de vida ---
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.alarms.create("refresh", { periodInMinutes: 1440 });
  updateBadge();
  const { catalog: c } = await chrome.storage.local.get("catalog");
  // Reload em dev dispara "update": só reconstrói se for instalação nova ou se não houver catálogo.
  if (reason === "install" || !c || !Object.keys(c).length) buildCatalog().catch(console.error);
});
chrome.runtime.onStartup.addListener(async () => {
  updateBadge();
  if (!(await chrome.alarms.get("refresh"))) chrome.alarms.create("refresh", { periodInMinutes: 1440 });
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "continue") buildCatalog().catch(console.error); else if (a.name === "refresh" && !DEV) buildCatalog(true).catch(console.error); });
chrome.cookies.onChanged.addListener((c) => c.cookie.domain.endsWith("livelo.com.br") && updateBadge());
chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove(["act:" + id, "why:" + id]));
