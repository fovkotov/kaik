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

export function fontFlags(item) {
  return {
    caps: Boolean(item?.caps),
    latin: Boolean(item?.latin),
  };
}

/** Shape typed specimen text: remap a Russian keyboard, then force caps. */
export function shapeFontText(value, flags = {}) {
  let out = String(value ?? "");
  if (flags.latin) {
    out = Array.from(out)
      .map((ch) => {
        const lower = ch.toLowerCase();
        const mapped = RU_LAYOUT_TO_EN[lower];
        if (!mapped) return ch;
        return ch === lower ? mapped : mapped.toUpperCase();
      })
      .join("");
  }
  if (flags.caps) out = out.toLocaleUpperCase("en-US");
  return out;
}
