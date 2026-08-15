import { publicUrl } from "../public-url.js";
import { KIND_LETTER, KIND_WORD, isLetter, normalizeEntry } from "./taxonomy.js";

const CATALOG_URL = publicUrl("letters/catalog.json");

export const emptyCatalog = () => ({
  version: 1,
  updatedAt: null,
  letters: [],
});

function hydrate(data) {
  if (!data || !Array.isArray(data.letters)) return emptyCatalog();
  return {
    ...data,
    letters: data.letters.map(normalizeEntry).filter(Boolean),
  };
}

export async function loadCatalog() {
  try {
    const res = await fetch(`${CATALOG_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return emptyCatalog();
    return hydrate(await res.json());
  } catch {
    return emptyCatalog();
  }
}

export function allEntries(catalog) {
  return catalog?.letters || [];
}

/** Single letters used as drop caps on the course site. */
export function allLetters(catalog) {
  return allEntries(catalog).filter(isLetter);
}

export function allWords(catalog) {
  return allEntries(catalog).filter((item) => !isLetter(item));
}

export function entriesOfKind(catalog, kind) {
  const want = kind === KIND_WORD ? KIND_WORD : KIND_LETTER;
  return allEntries(catalog).filter((item) => (item.kind || KIND_LETTER) === want);
}

export function lettersForChar(catalog, char) {
  const key = String(char || "");
  return allLetters(catalog).filter((item) => item.char === key);
}

/** Locale pool if it can cycle; otherwise the full catalog so click is never a no-op. */
export function clickPool(catalog, char) {
  const byChar = lettersForChar(catalog, char);
  return byChar.length > 1 ? byChar : allLetters(catalog);
}

export function entryById(catalog, id) {
  return allEntries(catalog).find((item) => item.id === id) || null;
}

export function letterById(catalog, id) {
  return allLetters(catalog).find((item) => item.id === id) || null;
}

export function uniqueValues(catalog, field, items = allEntries(catalog)) {
  const seen = new Set();
  const values = [];
  for (const item of items) {
    const value = String(item[field] || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values.sort((a, b) => a.localeCompare(b, "ru"));
}

export function filterEntries(items, filters = {}) {
  const { kind, construction, family, author, stream } = filters;
  return items.filter((item) => {
    if (kind && (item.kind || KIND_LETTER) !== kind) return false;
    if (construction && item.construction !== construction) return false;
    if (family && item.family !== family) return false;
    if (author && item.author !== author) return false;
    if (stream && item.stream !== stream) return false;
    return true;
  });
}

export function pickVariant(pool, excludeId) {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  const others = excludeId ? pool.filter((item) => item.id !== excludeId) : pool;
  const source = others.length ? others : pool;
  return source[Math.floor(Math.random() * source.length)];
}

export function compareChars(a, b) {
  return String(a).localeCompare(String(b), "ru", { sensitivity: "base" });
}

export function groupByChar(items) {
  const list = Array.isArray(items) ? items : allLetters(items);
  const groups = new Map();
  for (const item of list) {
    const key = item.char || "?";
    const bucket = groups.get(key) || [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) => compareChars(a, b));
}
