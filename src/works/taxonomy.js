export const TYPE_LETTERING = "lettering";
export const TYPE_FINAL = "final";
export const TYPE_FONT = "font";
/** Daily practice: a bucket of single letters, kept out of the public feed by default. */
export const TYPE_DAILY = "daily";
export const WORK_TYPES = [TYPE_LETTERING, TYPE_DAILY, TYPE_FINAL, TYPE_FONT];
export const WORKS_CATALOG_EVENT = "works-catalog";
const DEFAULT_TYPE_PATTERNS = Object.freeze({
  [TYPE_DAILY]: Object.freeze({ baseSpan: 1, interval: 6, span: 3 }),
  [TYPE_LETTERING]: Object.freeze({ baseSpan: 5, interval: 4, span: 10 }),
  [TYPE_FINAL]: Object.freeze({ baseSpan: 3, interval: 6, span: 5 }),
  [TYPE_FONT]: Object.freeze({ baseSpan: 10 }),
});
export const EXPERIMENT_2_LAYOUT_DEFAULTS = Object.freeze({
  columns: 12,
  /** Track count at the page's mobile breakpoint (≤760px); spans clamp to it. */
  mobileColumns: 4,
  /** Desktop: interactive hero height in vh. Mobile: height of the static
      scooter + caption illustration block that replaces the hero (≤760px). */
  heroVh: 90,
  heroVhMobile: 78,
  cellRatio: 1,
  gapX: 16,
  gapY: 16,
  alignX: "center",
  alignY: "start",
  /** Dense auto-placement: later cards backfill holes left beside large ones. */
  dense: true,
  typePatterns: DEFAULT_TYPE_PATTERNS,
});

function boundedInteger(value, fallback, max = 6, min = 1) {
  const span = Math.round(Number(value));
  return span >= min && span <= max ? span : fallback;
}

export function normalizeGridSpan(value) {
  return value === 1 || value === "1" ? 1 : value === 3 || value === "3" ? 3 : "auto";
}

export function normalizeExperiment2Layout(value) {
  const raw = value && typeof value === "object" ? value : {};
  const columns = boundedInteger(raw.columns, EXPERIMENT_2_LAYOUT_DEFAULTS.columns, 12, 2);
  const mobileColumns = boundedInteger(raw.mobileColumns, EXPERIMENT_2_LAYOUT_DEFAULTS.mobileColumns, 12, 1);
  const finite = (candidate, fallback, min, max) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
  };
  const axis = (candidate, fallback) =>
    ["start", "center", "end"].includes(candidate) ? candidate : fallback;
  const oldInterval = Array.isArray(raw.largeIntervals)
    ? raw.largeIntervals[0]
    : raw.intervals?.[0] ?? raw.interval;
  const oldDailyInterval =
    Array.isArray(raw.dailySpans) && raw.dailySpans.length > 1 ? raw.dailySpans.length - 1 : 1;
  const oldDailySpan =
    Array.isArray(raw.dailySpans) ? raw.dailySpans.find((entry) => Number(entry) > 1) : undefined;
  const rawPatterns = raw.typePatterns && typeof raw.typePatterns === "object" ? raw.typePatterns : {};
  const typePatterns = {};
  for (const type of [TYPE_DAILY, TYPE_LETTERING, TYPE_FINAL, TYPE_FONT]) {
    const fallback = DEFAULT_TYPE_PATTERNS[type];
    const candidate = rawPatterns[type] && typeof rawPatterns[type] === "object" ? rawPatterns[type] : {};
    const pattern = {
      // Old `{ interval, span }` patterns intentionally gain the type default.
      baseSpan: boundedInteger(candidate.baseSpan, fallback.baseSpan, 12),
    };
    if (type !== TYPE_FONT) {
      Object.assign(pattern, {
        interval: boundedInteger(
          candidate.interval ?? (type === TYPE_DAILY ? oldDailyInterval : oldInterval),
          fallback.interval,
          99,
        ),
        span: boundedInteger(
          candidate.span ?? (type === TYPE_DAILY ? oldDailySpan : raw.largeSpan),
          fallback.span,
          12,
        ),
      });
    }
    typePatterns[type] = pattern;
  }
  return {
    columns,
    mobileColumns,
    heroVh: finite(raw.heroVh, EXPERIMENT_2_LAYOUT_DEFAULTS.heroVh, 20, 200),
    heroVhMobile: finite(raw.heroVhMobile, EXPERIMENT_2_LAYOUT_DEFAULTS.heroVhMobile, 20, 200),
    cellRatio: finite(raw.cellRatio, EXPERIMENT_2_LAYOUT_DEFAULTS.cellRatio, 0.25, 4),
    gapX: finite(raw.gapX, EXPERIMENT_2_LAYOUT_DEFAULTS.gapX, 0, 80),
    gapY: finite(raw.gapY, EXPERIMENT_2_LAYOUT_DEFAULTS.gapY, 0, 80),
    alignX: axis(raw.alignX, EXPERIMENT_2_LAYOUT_DEFAULTS.alignX),
    alignY: axis(raw.alignY, EXPERIMENT_2_LAYOUT_DEFAULTS.alignY),
    dense:
      typeof raw.dense === "boolean"
        ? raw.dense
        : raw.dense === "false"
          ? false
          : raw.dense === "true"
            ? true
            : EXPERIMENT_2_LAYOUT_DEFAULTS.dense,
    typePatterns,
  };
}

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

export function normalizeFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** Which letter a daily-practice piece shows ("А", "Ж", "&"…). Short, no inner spaces. */
export function normalizeGlyph(value) {
  return Array.from(String(value ?? "").replace(/\s+/g, "").trim())
    .slice(0, 8)
    .join("");
}

export function emptyWorksCatalog() {
  return {
    version: 1,
    updatedAt: null,
    layout: normalizeExperiment2Layout(),
    items: [],
  };
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
  const type = normalizeWorkType(item.type);
  return {
    id,
    type,
    author: type === TYPE_DAILY ? "" : normalizeName(item.author),
    nick: type === TYPE_DAILY ? "" : normalizeNick(item.nick),
    stream: String(item.stream || "").trim(),
    sample: normalizeSample(item.sample) || undefined,
    glyph: normalizeGlyph(item.glyph) || undefined,
    caps: type === TYPE_FONT && normalizeFlag(item.caps) ? true : undefined,
    latin: type === TYPE_FONT && normalizeFlag(item.latin) ? true : undefined,
    files,
    width: Number(item.width) > 0 ? Number(item.width) : 0,
    height: Number(item.height) > 0 ? Number(item.height) : 0,
    createdAt: String(item.createdAt || ""),
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
    originalName: String(item.originalName || files[0] || ""),
    gridSpan: normalizeGridSpan(item.gridSpan),
  };
}

export function hydrateWorksCatalog(data) {
  if (!data || !Array.isArray(data.items)) return emptyWorksCatalog();
  // `layout.experiment2` was used by an early draft. Accept it while writing
  // the simpler public `catalog.layout` shape going forward.
  const layout = data.layout?.experiment2 ?? data.layout;
  return {
    version: 1,
    updatedAt: data.updatedAt || null,
    layout: normalizeExperiment2Layout(layout),
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
