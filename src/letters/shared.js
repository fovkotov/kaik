/** First letter of a string, uppercased. Empty if not a letter. */
export function normalizeChar(value) {
  const chars = [...String(value ?? "").trim()];
  if (!chars.length) return "";
  const ch = chars[0];
  if (!/\p{L}/u.test(ch)) return "";
  return ch.toLocaleUpperCase("ru-RU");
}

export function firstGrapheme(text) {
  return [...String(text ?? "")][0] || "";
}

export function inferCharFromFilename(filename) {
  const base = String(filename || "")
    .replace(/^.*[/\\]/, "")
    .replace(/\.[^.]+$/, "")
    .trim();

  if (!base) return "";

  const asOne = normalizeChar(base);
  if (asOne && [...base].length === 1) return asOne;

  const tagged = base.match(
    /(?:letter|char|glyph|bukva|bukvitsa|буква|буквица)[-_\s.]*(.+)$/i,
  );
  if (tagged) {
    const fromTag = normalizeChar(tagged[1]);
    if (fromTag) return fromTag;
  }

  const leading = base.match(/^([A-Za-zА-Яа-яЁё])(?:[-_.\s]|$)/);
  if (leading) return normalizeChar(leading[1]);

  return "";
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
