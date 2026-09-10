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
