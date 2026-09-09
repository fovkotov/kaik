export const TYPE_LETTERING = "lettering";
export const TYPE_FINAL = "final";
export const TYPE_FONT = "font";
export const WORK_TYPES = [TYPE_LETTERING, TYPE_FINAL, TYPE_FONT];
export const WORKS_CATALOG_EVENT = "works-catalog";

export function normalizeWorkType(value) {
  const key = String(value || "").trim().toLowerCase();
  return WORK_TYPES.includes(key) ? key : TYPE_LETTERING;
}

export function normalizeNick(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .slice(0, 80);
}

export function normalizeName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Default specimen text a font work is shown with (feed cell, admin tester). */
export function normalizeSample(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function emptyWorksCatalog() {
  return { version: 1, updatedAt: null, items: [] };
}

export function normalizeWorkItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  if (!id) return null;
  const files = Array.isArray(item.files)
    ? item.files.map((file) => String(file || "").trim()).filter(Boolean)
    : item.file
      ? [String(item.file)]
      : [];
  return {
    id,
    type: normalizeWorkType(item.type),
    author: normalizeName(item.author),
    nick: normalizeNick(item.nick),
    stream: String(item.stream || "").trim(),
    sample: normalizeSample(item.sample) || undefined,
    files,
    width: Number(item.width) > 0 ? Number(item.width) : 0,
    height: Number(item.height) > 0 ? Number(item.height) : 0,
    createdAt: String(item.createdAt || ""),
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
    originalName: String(item.originalName || files[0] || ""),
  };
}

export function hydrateWorksCatalog(data) {
  if (!data || !Array.isArray(data.items)) return emptyWorksCatalog();
  return {
    version: 1,
    updatedAt: data.updatedAt || null,
    items: data.items.map(normalizeWorkItem).filter(Boolean),
  };
}

export function sortWorksByDate(items) {
  return [...(items || [])].sort((a, b) => {
    const ta = Date.parse(a.createdAt || "") || 0;
    const tb = Date.parse(b.createdAt || "") || 0;
    return tb - ta;
  });
}

/** A workshop piece this compact is a single glyph, not a word. */
const LETTER_MAX_RATIO = 1.25;
/** Portrait finals (posters, covers) take the tall 2×2 slot. */
const TALL_FINAL_MAX_RATIO = 0.95;

export const KIND_LETTER = "letter";

/**
 * Placement on the 6-track works grid (Figma 212:20).
 * Letter → 1 col. Lettering, final project, font → 2 cols.
 * Portrait finals also take 2 rows.
 */
export function placeWork(item) {
  const type = normalizeWorkType(item?.type);
  const w = Number(item?.width) || 0;
  const h = Number(item?.height) || 0;
  const ratio = w > 0 && h > 0 ? w / h : 0;
  if (type === TYPE_LETTERING && ratio > 0 && ratio <= LETTER_MAX_RATIO) {
    return { cols: 1, rows: 1, kind: KIND_LETTER };
  }
  if (type === TYPE_FINAL && ratio > 0 && ratio < TALL_FINAL_MAX_RATIO) {
    return { cols: 2, rows: 2, kind: type };
  }
  return { cols: 2, rows: 1, kind: type };
}
