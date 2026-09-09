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

function idSalt(id) {
  let n = 0;
  for (const ch of String(id || "")) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n;
}

function imageFiles(item) {
  return (item?.files || []).filter((file) => !/\.(ttf|otf|woff2?)$/i.test(String(file || "")));
}

/** Column span on the 5-track works grid. */
export function spanForWork(item) {
  if (normalizeWorkType(item?.type) === TYPE_FINAL && imageFiles(item).length > 1) {
    return { span: 3, split: false };
  }
  const w = Number(item?.width) || 0;
  const h = Number(item?.height) || 0;
  const salt = idSalt(item?.id);
  if (!w || !h) return { span: 1 + (salt % 2), split: false };
  const ar = w / h;
  if (h / w >= 1.6) return { span: 1, split: true };
  if (w >= 800 || ar >= 2.6) return { span: 5, split: false };
  if (ar >= 2.0) return { span: salt % 2 ? 4 : 3, split: false };
  if (ar >= 1.45) return { span: salt % 2 ? 3 : 2, split: false };
  if (ar >= 1.05) return { span: 2, split: false };
  return { span: 1, split: false };
}
