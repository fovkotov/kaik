/* Author names live in the catalog in one spelling only — mostly Cyrillic, a few
   already Latin. The English locale needs Latin, so names transliterate at render
   time instead of carrying a second stored field. */

const LETTERS = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/* Opening a syllable these take the y-glide: Егор → Yegor, but Алёна → Alena.
   я and ю already carry it in every position. */
const GLIDED = { е: "ye", ё: "yo" };
const VOWELS = "аеёиоуыэюя";
const CYRILLIC = /[а-яё]/i;
const WORD = /[а-яё]+/gi;

function latinizeWord(lower) {
  let out = "";
  for (let i = 0; i < lower.length; i += 1) {
    const letter = lower[i];
    const mapped = LETTERS[letter];
    if (mapped === undefined) {
      out += letter;
      continue;
    }
    const prev = lower[i - 1];
    const opensSyllable = i === 0 || VOWELS.includes(prev) || prev === "ъ" || prev === "ь";
    out += opensSyllable && GLIDED[letter] ? GLIDED[letter] : mapped;
  }
  return out;
}

/** Captions print whatever case the catalog holds: надя → nadya, Надя → Nadya, АРТЕМ → ARTEM. */
function matchCase(source, latin) {
  if (source.length > 1 && source === source.toUpperCase()) return latin.toUpperCase();
  if (source[0] !== source[0].toLowerCase()) return latin[0].toUpperCase() + latin.slice(1);
  return latin;
}

/** RU→EN transliteration per Cyrillic word. Latin names ("bogdan") pass through. */
export function latinizeName(name) {
  const value = String(name ?? "");
  if (!CYRILLIC.test(value)) return value;
  return value.replace(WORD, (word) => matchCase(word, latinizeWord(word.toLowerCase())));
}

/** Author as the locale prints it: Latin in `en`, the catalog spelling in `ru`. */
export function localizedAuthor(name, locale) {
  const value = String(name ?? "");
  return locale === "ru" ? value : latinizeName(value);
}
