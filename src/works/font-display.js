/** ЙЦУКЕН → QWERTY so a Russian layout still types English letters. */
const RU_LAYOUT_TO_EN = {
  ё: "`",
  й: "q",
  ц: "w",
  у: "e",
  к: "r",
  е: "t",
  н: "y",
  г: "u",
  ш: "i",
  щ: "o",
  з: "p",
  х: "[",
  ъ: "]",
  ф: "a",
  ы: "s",
  в: "d",
  а: "f",
  п: "g",
  р: "h",
  о: "j",
  л: "k",
  д: "l",
  ж: ";",
  э: "'",
  я: "z",
  ч: "x",
  с: "c",
  м: "v",
  и: "b",
  т: "n",
  ь: "m",
  б: ",",
  ю: ".",
};

const EN_LAYOUT_TO_RU = Object.fromEntries(
  Object.entries(RU_LAYOUT_TO_EN).map(([ru, en]) => [en, ru]),
);

function remapLayout(value, table) {
  return Array.from(value)
    .map((ch) => {
      const lower = ch.toLowerCase();
      const mapped = table[lower];
      if (!mapped) return ch;
      return ch === lower ? mapped : mapped.toUpperCase();
    })
    .join("");
}

export function fontFlags(item) {
  return {
    caps: Boolean(item?.caps),
    latin: Boolean(item?.latin),
    cyrillic: Boolean(item?.cyrillic),
  };
}

/** Shape typed specimen text: remap keyboard layout, then force caps. */
export function shapeFontText(value, flags = {}) {
  let out = String(value ?? "");
  if (flags.cyrillic) out = remapLayout(out, EN_LAYOUT_TO_RU);
  else if (flags.latin) out = remapLayout(out, RU_LAYOUT_TO_EN);
  if (flags.caps) out = out.toLocaleUpperCase(flags.cyrillic ? "ru-RU" : "en-US");
  return out;
}

/** Caret position inside a tester as a plain-text offset, or null when it is elsewhere. */
function caretOffset(el) {
  const selection = window.getSelection?.();
  const focusNode = selection?.focusNode;
  if (!focusNode || !el.contains(focusNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  try {
    range.setEnd(focusNode, selection.focusOffset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function placeCaret(el, offset) {
  const selection = window.getSelection?.();
  if (!selection) return;
  const node = el.firstChild;
  const range = document.createRange();
  if (node?.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.max(0, Math.min(offset, node.length)));
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Normalise what the visitor typed in a contenteditable tester, in place.
 *
 * Assigning `textContent` swaps the text node out, which drops the caret to the
 * start of the element — with a caps or layout-remapping font every next
 * keystroke would land in front of the previous one and the word would come out
 * reversed ("ПРИВЕТ" → "ТЕВИРП"). So the caret has to be carried over, mapped
 * through the same shaping as the text before it.
 */
export function settleFontText(el, plain, flags = {}) {
  const raw = el.textContent;
  const next = shapeFontText(plain(raw), flags);
  if (next === raw) return next;
  const caret = caretOffset(el);
  el.textContent = next;
  if (caret !== null) placeCaret(el, shapeFontText(plain(raw.slice(0, caret)), flags).length);
  return next;
}
