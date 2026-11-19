#!/usr/bin/env node
// Turn data/raw/*.json into: data/history.json (append-only price history)
// and site/data.json (what the page reads). Zero dependencies.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { STORES } from "./stores.mjs";

const TODAY = process.env.WD_DATE || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const HISTORY = process.env.WD_HISTORY || "data/history.json";
const OUT = process.env.WD_OUT || "site/data.json";

// ---------- what counts as a bottle of wine ----------
const NOT_WINE = /gift|merch|accessor|stemware|glass|corkscrew|\bkit\b|event|subscription|club|pantry|pastry|apparel|\btest\b|svi_hidden|wrapin|bundle|multi-pack|prepaid|spirit|tequila|liqueur|whisk|mezcal|\bgin\b|\brum\b|vodka|cognac|brandy|\bbeer\b|cider|\bsake\b|custom|\bna wine\b|non-alc|book|candle|ticket|class\b|deposit|shipping|insurance|storage/i;
const NOT_WINE_TITLE = /gift card|gift box|tote\b|corkscrew|decanter|wine club|subscription|tasting (kit|class|ticket)|\bticket|sampler|mixed case|mystery|bundle|\b\d+[- ]?(pack|pk|bottles?)\b|\bcase of\b|\bset of\b|gift set|non-alcoholic|\bvermouth\b|whisk(e)?y|tequila|mezcal|bourbon/i;

function sizeOf(text) {
  const t = text.toLowerCase();
  if (/\b(375\s?ml|half[- ]bottle|\.375)/.test(t)) return 375;
  if (/\b(500\s?ml)\b/.test(t)) return 500;
  if (/\b(1\.5\s?l|1500\s?ml|magnum)\b/.test(t)) return 1500;
  if (/\b(3\s?l|3000\s?ml|double magnum|jeroboam)\b/.test(t)) return 3000;
  if (/\b(6\s?l|imperial|methuselah)\b/.test(t)) return 6000;
  if (/\b(1\s?l|1000\s?ml|liter|litre)\b/.test(t)) return 1000;
  if (/\b(187\s?ml|split)\b/.test(t)) return 187;
  if (/\b(3\s?pack|6\s?pack|12\s?pack|case)\b/.test(t)) return -1; // multi-bottle, skip
  return 750;
}

// ---------- matching key: same bottle across stores ----------
const DROP = new Set(("the de du des la le les di del della dei delle do da dos das el los las et and y e und von van of a an " +
  "domaine chateau weingut tenuta azienda agricola cantina cantine bodega bodegas maison champagne winery wines wine vins vin " +
  "usa france italy spain germany austria portugal australia argentina chile california oregon washington " +
  "ml 750ml 750 nv").split(" "));
function keyOf(title, size) {
  let t = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  t = t.replace(/\(.*?\)/g, " ").replace(/\b\d+(\.\d+)?\s?(ml|l|cl)\b/g, " ");
  const vm = t.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  const vintage = vm ? vm[1] : (/\bnv\b|non[- ]vintage|\bmv\b/.test(t) ? "nv" : "");
  t = t.replace(/\b(19[5-9]\d|20[0-3]\d)\b/g, " ").replace(/[^a-z0-9 ]+/g, " ");
  const toks = [...new Set(t.split(/\s+/).filter((w) => w && !DROP.has(w)))].sort();
  if (toks.length < 2 || !vintage) return { key: null, vintage: vintage || null };
  return { key: `${vintage}|${size}|${toks.join(" ")}`, vintage };
}

// ---------- load raw ----------
const items = [];
const storeStats = {};
for (const s of STORES) {
  const f = `data/raw/${s.id}.json`;
  if (!existsSync(f)) continue;
  const { fetched_at, products } = JSON.parse(readFileSync(f, "utf8"));
  let kept = 0;
  for (const p of products) {
    const type = p.product_type || "";
    if (NOT_WINE.test(type) || NOT_WINE_TITLE.test(p.title)) continue;
    const hasVintage = /\b(19[5-9]\d|20[0-3]\d)\b|\bNV\b/.test(p.title);
    if (!type && !hasVintage) continue;
    for (const v of p.variants || []) {
      if (!v.available) continue;
      const price = +v.price;
      if (!(price >= 5)) continue;
      const vt = v.title && v.title !== "Default Title" ? v.title : "";
      const size = sizeOf(`${p.title} ${vt}`);
      if (size < 0) continue;
      const cmp = v.compare_at_price && +v.compare_at_price > price ? +v.compare_at_price : null;
      const { key, vintage } = keyOf(p.title, size);
      items.push({
        id: `${s.id}:${v.id}`, store: s.id, title: p.title.replace(/\s*\(750\s?ml\)\s*/i, " ").trim(),
        vendor: p.vendor, price, cmp, size, vintage, key,
        url: `https://${s.host}/products/${p.handle}`,
        img: p.images?.[0]?.src || null,
      });
      kept++;
    }
  }
  storeStats[s.id] = { name: s.name, items: kept, fetched_at };
}

// ---------- price history: append a point only when the price changes ----------
const hist = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : {};
for (const it of items) {
  const h = (hist[it.id] ||= { f: TODAY, l: TODAY, p: [] });
  const last = h.p[h.p.length - 1];
  if (!last || last[1] !== it.price) {
    if (last && last[0] === TODAY) last[1] = it.price; else h.p.push([TODAY, it.price]);
  }
  // back in stock after a gap: note it so the page can say so
  if (h.l !== TODAY) { const gap = (Date.parse(TODAY) - Date.parse(h.l)) / 864e5; if (gap > 2) h.r = TODAY; }
  h.l = TODAY;
}
writeFileSync(HISTORY, JSON.stringify(hist));

// ---------- signals ----------
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const byKey = new Map();
for (const it of items) if (it.key) (byKey.get(it.key) || byKey.set(it.key, []).get(it.key)).push(it);

for (const it of items) {
  const h = hist[it.id];
  it.first = h.f;
  it.hist = h.p.slice(-12);
  // 1. our own tracked history: today's price vs what it was before
  const prior = h.p.slice(0, -1).filter(([d]) => (Date.parse(TODAY) - Date.parse(d)) / 864e5 <= 120).map(([, p]) => p);
  if (prior.length && h.p[h.p.length - 1][0] !== h.f) {
    const ref = median(prior);
    it.drop = { was: ref, since: h.p[h.p.length - 1][0], pct: Math.round((1 - it.price / ref) * 1000) / 10 };
  }
  // 2. same bottle at other stores (cheapest listing per other store)
  if (it.key) {
    const per = new Map();
    for (const o of byKey.get(it.key)) if (o.store !== it.store) per.set(o.store, Math.min(per.get(o.store) ?? Infinity, o.price));
    const others = [...per.entries()].filter(([, p]) => p / it.price < 3 && it.price / p < 3);
    if (others.length) {
      const ref = median(others.map(([, p]) => p));
      it.cross = { ref, n: others.length, pct: Math.round((1 - it.price / ref) * 1000) / 10, others: others.map(([s, p]) => [s, p]) };
    }
  }
  // 3. the store's own claim, kept separate because nobody may ever have charged it
  if (it.cmp) it.claim = Math.round((1 - it.price / it.cmp) * 1000) / 10;
}

// one headline score: real evidence first, the store's word last
for (const it of items) {
  const d = it.drop?.pct > 0 ? it.drop.pct : 0;
  const c = it.cross?.pct > 0 ? it.cross.pct : 0;
  it.real = Math.max(d, c) || null;
}

const days = new Set(); for (const k in hist) for (const [d] of hist[k].p) days.add(d);
const out = {
  generated: new Date().toISOString(), today: TODAY,
  tracked_days: [...new Set(Object.values(hist).flatMap((h) => [h.f, h.l]))].sort().length,
  first_day: Object.values(hist).reduce((m, h) => (h.f < m ? h.f : m), TODAY),
  stores: storeStats,
  counts: {
    items: items.length,
    drops: items.filter((i) => i.drop?.pct >= 3).length,
    cross: items.filter((i) => i.cross).length,
    cross_cheaper: items.filter((i) => i.cross?.pct >= 3).length,
    claims: items.filter((i) => i.claim).length,
  },
  items: items.map(({ key, ...r }) => r),
};
writeFileSync(OUT, JSON.stringify(out));
console.log(TODAY, out.counts, "history keys:", Object.keys(hist).length);
console.table(Object.fromEntries(Object.entries(storeStats).map(([k, v]) => [k, v.items])));
