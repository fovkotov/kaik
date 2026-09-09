export const TYPE_LETTERING = "lettering";
export const TYPE_FINAL = "final";
export const TYPE_FONT = "font";
/** Daily practice: a bucket of single letters, kept out of the public feed by default. */
export const TYPE_DAILY = "daily";
export const WORK_TYPES = [TYPE_LETTERING, TYPE_DAILY, TYPE_FINAL, TYPE_FONT];
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

export const KIND_LETTER = "letter";
export const KIND_TALL_FINAL = "tallFinal";

/**
 * Default placement rules for the 6-track works grid (Figma 212:20).
 * `letterMaxRatio`: a workshop piece this compact is a single glyph, not a word.
 * `tallFinalMaxRatio`: portrait finals (posters, covers) take the tall slot.
 * `spans`: [cols, rows] per kind.
 */
export const PLACE_RULES = Object.freeze({
  letterMaxRatio: 1.25,
  tallFinalMaxRatio: 0.95,
  spans: Object.freeze({
    [KIND_LETTER]: [1, 1],
    [TYPE_LETTERING]: [2, 1],
    [TYPE_DAILY]: [1, 1],
    [TYPE_FINAL]: [2, 1],
    [KIND_TALL_FINAL]: [2, 2],
    [TYPE_FONT]: [2, 1],
  }),
});

function spanOf(spans, key) {
  const pair = spans[key] || PLACE_RULES.spans[key] || [2, 1];
  return {
    cols: Math.max(1, Math.round(Number(pair[0]) || 1)),
    rows: Math.max(1, Math.round(Number(pair[1]) || 1)),
  };
}

/**
 * Placement on the works grid.
 * Letter → 1 col. Lettering, final project, font → 2 cols.
 * Portrait finals also take 2 rows. `rules` lets a page override any of it.
 */
export function placeWork(item, rules = PLACE_RULES) {
  const type = normalizeWorkType(item?.type);
  const w = Number(item?.width) || 0;
  const h = Number(item?.height) || 0;
  const ratio = w > 0 && h > 0 ? w / h : 0;
  const spans = { ...PLACE_RULES.spans, ...(rules?.spans || {}) };
  const letterMax = Number(rules?.letterMaxRatio ?? PLACE_RULES.letterMaxRatio);
  const tallMax = Number(rules?.tallFinalMaxRatio ?? PLACE_RULES.tallFinalMaxRatio);
  if ((type === TYPE_LETTERING || type === TYPE_DAILY) && ratio > 0 && ratio <= letterMax) {
    return { ...spanOf(spans, KIND_LETTER), kind: KIND_LETTER };
  }
  if (type === TYPE_FINAL && ratio > 0 && ratio < tallMax) {
    return { ...spanOf(spans, KIND_TALL_FINAL), kind: type };
  }
  return { ...spanOf(spans, type), kind: type };
}
