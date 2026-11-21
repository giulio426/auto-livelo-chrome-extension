#!/usr/bin/env node
// Builds seed.json (code -> { mod, entry }) from Livelo partner profiles.
// --dry uses test/fixtures only (no network). Resumable: reuses existing --out file.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBackground } from "../test/harness.mjs";

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOLS, "..");
const FIX = join(ROOT, "test", "fixtures");
const API = "https://apis.pontoslivelo.com.br";
const SEARCH_URL = `${API}/bff-partners-profile/v2/profiles/search?size=500`;

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dry = argv.includes("--dry");
const outPath = resolve(opt("--out") ?? join(ROOT, "seed.json"));
const gap = opt("--gap") !== undefined ? Number(opt("--gap")) : dry ? 0 : 4000;
if (!Number.isFinite(gap) || gap < 0) { console.error("--gap invalido"); process.exit(1); }

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const fixtureFile = (code) => join(FIX, "profiles", `${code}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  if (dry) {
    if (url.includes("/bff-partners-profile/v2/profiles/search")) {
      return { status: 200, data: readJson(join(FIX, "search.json")) };
    }
    const m = url.match(/\/v1\/profiles\/([A-Z0-9]+)/);
    if (!m) throw new Error(`dry: sem fixture para ${url}`);
    const f = fixtureFile(m[1]);
    return existsSync(f) ? { status: 200, data: readJson(f) } : { status: 404, data: {} };
  }
  const r = await fetch(url);
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, data };
}

const h = await loadBackground();
const toEntry = h.eval("toEntry");

let seed = existsSync(outPath) ? readJson(outPath) : {};
const save = () => {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(seed));
};

let requests = 0;
const s = await get(SEARCH_URL);
requests++;
if (s.status === 403 || s.status === 429) {
  console.log(`BLOQUEADO (${s.status}) na busca após ${requests} requests. Aguarde >= 30 min e rode de novo para retomar.`);
  process.exit(2);
}
if (s.status !== 200) { console.log(`busca falhou (${s.status})`); process.exit(1); }
const list = s.data.content.filter((p) => p.enabled);

const codes = new Set(list.map((p) => p.code));
for (const k of Object.keys(seed)) if (!codes.has(k)) delete seed[k];

let todo = list.filter((p) => seed[p.code]?.mod !== p.lastModifiedDate);
if (dry) todo = todo.filter((p) => existsSync(fixtureFile(p.code)));
console.log(`a processar: ${todo.length}`);

const skipped = [];
const empty = [];
let processed = 0;
for (const p of todo) {
  requests++;
  let r;
  try {
    r = await get(`${API}/bff-partners-profile/v1/profiles/${p.code}`);
  } catch (e) {
    r = { status: `ERR ${e.message}`, data: null };
  }
  if (r.status === 403 || r.status === 429) {
    save();
    console.log(`BLOQUEADO (${r.status}) em ${p.code} após ${requests} requests. Aguarde >= 30 min e rode de novo para retomar.`);
    process.exit(2);
  }
  if (r.status === 200) {
    seed[p.code] = { mod: p.lastModifiedDate, entry: toEntry(p, r.data) };
    processed++;
    if (processed % 10 === 0) save();
  } else if (r.status === 404 || r.status === 400) {
    seed[p.code] = { mod: p.lastModifiedDate, entry: null };
    empty.push(p.code);
  } else {
    skipped.push(p.code);
    console.log(`skip ${p.code} ${r.status}`);
  }
  if (gap > 0) await sleep(Math.max(0, gap + Math.round((Math.random() * 2 - 1) * 1000)));
}

save();
const withEntry = Object.values(seed).filter((v) => v.entry != null).length;
console.log(`requests: ${requests}`);
console.log(`parceiros na lista: ${list.length}`);
console.log(`entries no seed: ${Object.keys(seed).length}`);
console.log(`entries com entry != null: ${withEntry}`);
console.log(`skipped: ${skipped.length ? skipped.join(", ") : "nenhum"}`);
console.log(`empty (404/400): ${empty.length ? empty.join(", ") : "nenhum"}`);
