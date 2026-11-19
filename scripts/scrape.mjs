#!/usr/bin/env node
// Pull every store's public product feed into data/raw/<store>.json.
// Zero dependencies. One request per second per store.
import { writeFileSync, mkdirSync } from "node:fs";
import { STORES } from "./stores.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_PAGES = 80;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) return { error: "HTTP " + res.status };
      return await res.json();
    } catch (e) {
      if (i === tries - 1) return { error: String(e.message || e) };
      await sleep(2000 * (i + 1));
    }
  }
}

async function scrapeStore(s) {
  const products = [];
  let error = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const d = await getJson(`https://${s.host}/products.json?limit=250&page=${page}`);
    if (d.error) { error = d.error; break; }
    if (!d.products?.length) break;
    products.push(...d.products);
    if (d.products.length < 250) break;
    await sleep(1000);
  }
  return { products, error };
}

mkdirSync("data/raw", { recursive: true });
const summary = [];
await Promise.all(STORES.filter((s) => !only || s.id === only).map(async (s) => {
  const { products, error } = await scrapeStore(s);
  // A failed store must not overwrite a good earlier pull with an empty one.
  if (products.length) writeFileSync(`data/raw/${s.id}.json`, JSON.stringify({ fetched_at: new Date().toISOString(), products }));
  summary.push({ store: s.id, products: products.length, error });
}));
summary.sort((a, b) => a.store.localeCompare(b.store));
console.table(summary);
writeFileSync("data/raw/_summary.json", JSON.stringify({ at: new Date().toISOString(), summary }, null, 1));
if (summary.every((s) => !s.products)) process.exit(1);
