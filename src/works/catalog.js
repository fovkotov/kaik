import { publicUrl } from "../public-url.js";
import { emptyWorksCatalog, hydrateWorksCatalog } from "./taxonomy.js";

const CATALOG_URL = publicUrl("works/catalog.json");

let inflight = null;
let lastGood = null;

export { emptyWorksCatalog };

export async function loadWorksCatalog({ bust = false } = {}) {
  if (inflight) return inflight;

  const req = (async () => {
    try {
      const res = await fetch(bust ? `${CATALOG_URL}?t=${Date.now()}` : CATALOG_URL, {
        cache: bust ? "no-store" : "default",
      });
      if (!res.ok) return lastGood || emptyWorksCatalog();
      const data = hydrateWorksCatalog(await res.json());
      lastGood = data;
      return data;
    } catch {
      return lastGood || emptyWorksCatalog();
    }
  })();

  inflight = req;
  req.finally(() => {
    if (inflight === req) inflight = null;
  });
  return req;
}

export function workFileUrl(file) {
  return publicUrl(`works/files/${file}`);
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
