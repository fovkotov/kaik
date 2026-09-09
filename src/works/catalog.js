import { publicUrl } from "../public-url.js";
import { emptyWorksCatalog, hydrateWorksCatalog } from "./taxonomy.js";

const CATALOG_URL = publicUrl("works/catalog.json");

let inflight = null;
let lastGood = null;
let fileBase = "";

export { emptyWorksCatalog };

export function workFileUrl(file) {
  const name = String(file || "");
  if (fileBase) return `${fileBase}${encodeURIComponent(name)}`;
  return publicUrl(`works/files/${name}`);
}

async function fetchCatalog(url, bust) {
  const res = await fetch(bust ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url, {
    cache: bust ? "no-store" : "default",
  });
  if (!res.ok) return null;
  // SPA fallbacks answer unknown routes with index.html — treat as "no API here".
  if (!/json/i.test(res.headers.get("content-type") || "")) return null;
  const raw = await res.json();
  if (typeof raw.fileBase === "string" && raw.fileBase) fileBase = raw.fileBase;
  return hydrateWorksCatalog(raw);
}

export async function loadWorksCatalog({ bust = false } = {}) {
  if (inflight) return inflight;

  const req = (async () => {
    try {
      const live = await fetchCatalog("/api/works", true);
      if (live) {
        lastGood = live;
        return live;
      }
      fileBase = "";
      const data = await fetchCatalog(CATALOG_URL, bust);
      if (!data) return lastGood || emptyWorksCatalog();
      lastGood = data;
      return data;
    } catch {
      fileBase = "";
      return lastGood || emptyWorksCatalog();
    }
  })();

  inflight = req;
  req.finally(() => {
    if (inflight === req) inflight = null;
  });
  return req;
}

export function uniqueWorkValues(items, field) {
  const seen = new Set();
  const values = [];
  for (const item of items || []) {
    const value = String(item[field] || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values.sort((a, b) => a.localeCompare(b, "ru"));
}
