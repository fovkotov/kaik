import { initImgSliders } from "./img-slider.js";
import { publicUrl } from "./public-url.js";
import { t } from "./scriptik.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";
import { subscribeWorksCatalog } from "./works/live.js";
import {
  PLACE_RULES,
  TYPE_DAILY,
  TYPE_FINAL,
  TYPE_FONT,
  TYPE_LETTERING,
  placeWork,
  sortWorksByDate,
} from "./works/taxonomy.js";
import { fontFlags, shapeFontText } from "./works/font-display.js";

const EN_WORDS = ["kaik", "letter", "type", "form", "serif", "stroke"];
const RU_WORDS = ["каик", "буква", "набор", "слово", "шрифт", "форма"];

/** Course pages: tap flips the slide, caption in flow, Figma rules. */
const DEFAULTS = Object.freeze({
  root: null,
  tapNext: true,
  /** Cells get `data-work-open` + tabindex so a page can open a viewer on click. */
  openable: false,
  rules: PLACE_RULES,
  /** date | type | shuffle */
  order: "date",
  /** Array of work types to show, or null for all. */
  types: null,
  /** Never let a span exceed the live track count (else grid grows implicit columns). */
  maxCols: Infinity,
  /** Long decks hide dots — they would overflow the cell. */
  manyDots: 12,
  /** Font cells become a type tester: click the specimen and type your own text. */
  fontTester: false,
  seed: 1,
});

const TESTER_MAX_CHARS = 60;

const TYPE_ORDER = [TYPE_FINAL, TYPE_LETTERING, TYPE_FONT];

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function isFontFile(name) {
  return /\.(ttf|otf|woff2?)$/i.test(String(name || ""));
}

export function imageFiles(item) {
  return (item?.files || []).filter((file) => !isFontFile(file));
}

function pickWord(id, lang) {
  const list = lang === "ru" ? RU_WORDS : EN_WORDS;
  let n = 0;
  for (const ch of String(id || "")) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return list[n % list.length];
}

function ratioStyle(item) {
  return item.width && item.height ? `--art-w:${item.width};--art-h:${item.height}` : "";
}

function artMarkup(src, item) {
  return `<div class="works-feed__art" style="${ratioStyle(item)}">
    <img src="${esc(src)}" alt="" ${item.width ? `width="${item.width}" height="${item.height}"` : ""} loading="lazy" decoding="async" draggable="false" />
  </div>`;
}

function sliderMarkup(item, files, opts) {
  const chevron = esc(publicUrl("assets/cards/history/chevron.svg"));
  const slides = files
    .map(
      (file, i) =>
        `<figure class="img-slider__slide${i === 0 ? " is-active" : ""}" data-img-slider-slide>
          <img src="${esc(workFileUrl(file))}" alt="" ${item.width ? `width="${item.width}" height="${item.height}"` : ""} loading="lazy" decoding="async" draggable="false" />
        </figure>`,
    )
    .join("");
  const many = files.length > opts.manyDots ? " works-feed__slider--many" : "";
  const tap = opts.tapNext ? " data-slider-tap-next" : "";
  return `<div class="img-slider works-feed__slider${many}" data-img-slider data-slider-inline${tap} style="${ratioStyle(item)}">
    ${slides}
    <button type="button" class="img-slider__nav img-slider__nav--prev" data-img-slider-prev data-i18n-aria="history.prev" aria-label="${esc(t("history.prev"))}">
      <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
    </button>
    <button type="button" class="img-slider__nav img-slider__nav--next" data-img-slider-next data-i18n-aria="history.next" aria-label="${esc(t("history.next"))}">
      <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
    </button>
  </div>`;
}

function fontMarkup(item, fontFile, opts) {
  const tester = opts.fontTester
    ? ` data-font-tester contenteditable="true" spellcheck="false" autocapitalize="off" autocorrect="off" role="textbox" aria-label="${esc(
        t("works.fontTester"),
      )}" title="${esc(t("works.fontTester"))}"`
    : "";
  const flags = fontFlags(item);
  return `<div class="works-feed__art works-feed__art--font" data-font-preview data-font-url="${esc(
    workFileUrl(fontFile),
  )}" data-work-id="${esc(item.id)}"${item.sample ? ` data-font-sample="${esc(item.sample)}"` : ""}${
    flags.caps ? " data-font-caps" : ""
  }${flags.latin ? " data-font-latin" : ""}${tester}></div>`;
}

/** Same caption as the main-domain collage: name, then @nick. */
function whoMarkup(item) {
  if (!item.author && !item.nick) return "";
  return `<p class="works-card__who works-feed__who">${
    item.author ? `<span>${esc(item.author)}</span>` : ""
  }${item.nick ? `<span class="works-card__ig">@${esc(item.nick)}</span>` : ""}</p>`;
}

function mediaMarkup(item, opts) {
  const fontFile = (item.files || []).find((name) => isFontFile(name));
  if (item.type === TYPE_FONT && fontFile) return fontMarkup(item, fontFile, opts);
  if (fontFile && !imageFiles(item).length) return fontMarkup(item, fontFile, opts);
  const images = imageFiles(item);
  if (!images.length) return "";
  if (item.type === TYPE_FINAL && images.length > 1) return sliderMarkup(item, images, opts);
  return artMarkup(workFileUrl(images[0]), item);
}

function workMarkup(item, opts) {
  const media = mediaMarkup(item, opts);
  if (!media) return "";
  const placed = placeWork(item, opts.rules);
  const cols = Math.max(1, Math.min(placed.cols, opts.maxCols || Infinity));
  const rows = placed.rows;
  const place = `grid-column: span ${cols}${rows > 1 ? `; grid-row: span ${rows}` : ""}`;
  const openable = opts.openable && imageFiles(item).length > 0;
  const open = openable ? ` data-work-open tabindex="0" role="button"` : "";
  return `<article class="works-feed__cell works-feed__cell--${esc(placed.kind)}" data-work-id="${esc(
    item.id,
  )}" data-type="${esc(item.type)}" data-cols="${cols}" data-rows="${rows}"${open} style="${place}">
    <div class="works-feed__media">${media}</div>
    ${whoMarkup(item)}
  </article>`;
}

/**
 * The specimen is set at a fraction of the column width; a long sample (or
 * whatever the visitor types) is shrunk until it fits the cell on one line.
 */
function fitFontCell(el) {
  el.style.removeProperty("--font-fit");
  const room = el.clientWidth;
  if (!room || !el.firstChild) return;
  // Centred text overflows both ways, so scrollWidth under-reports: measure the glyph run itself.
  const range = document.createRange();
  range.selectNodeContents(el);
  const need = range.getBoundingClientRect().width;
  if (need <= room) return;
  el.style.setProperty("--font-fit", String(Math.max(0.12, (room / need) * 0.96)));
}

function plainText(value) {
  return String(value || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, TESTER_MAX_CHARS);
}

function selectAll(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Click the specimen, type your own word; empty → back to the stored sample. */
function flagsFromEl(el) {
  return { caps: el.hasAttribute("data-font-caps"), latin: el.hasAttribute("data-font-latin") };
}

function bindFontTester(el, fallback) {
  if (el.dataset.testerBound) return;
  el.dataset.testerBound = "1";
  const flags = flagsFromEl(el);
  const settle = () => {
    const next = shapeFontText(plainText(el.textContent), flags);
    if (next !== el.textContent) el.textContent = next;
    fitFontCell(el);
  };
  el.addEventListener("focus", () => {
    el.closest(".works-feed__cell")?.classList.add("is-typing");
    requestAnimationFrame(() => selectAll(el));
  });
  el.addEventListener("blur", () => {
    el.closest(".works-feed__cell")?.classList.remove("is-typing");
    if (!el.textContent.trim()) el.textContent = fallback;
    settle();
  });
  el.addEventListener("input", settle);
  el.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = shapeFontText(plainText(event.clipboardData?.getData("text/plain")), flags);
    if (!text) return;
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      sel.deleteFromDocument();
      sel.getRangeAt(0).insertNode(document.createTextNode(text));
      sel.collapseToEnd();
    } else {
      el.textContent = text;
    }
    settle();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      el.blur();
      return;
    }
    // Arrows / space belong to the caret, not to the page or the deck.
    event.stopPropagation();
  });
  // Clicks must not bubble into the cell's open-viewer handler.
  el.addEventListener("click", (event) => event.stopPropagation());
  el.addEventListener("pointerdown", (event) => event.stopPropagation());
  if (typeof ResizeObserver === "function") new ResizeObserver(() => fitFontCell(el)).observe(el);
}

async function paintFontCell(el) {
  const url = el.getAttribute("data-font-url");
  const id = el.getAttribute("data-work-id") || "font";
  const flags = flagsFromEl(el);
  const sample = shapeFontText((el.getAttribute("data-font-sample") || "").trim(), flags);
  if (!url) return;
  const family = `wrk-${id.replace(/[^a-z0-9]/gi, "") || "font"}`;
  const show = (text) => {
    el.textContent = text;
    el.style.fontFamily = `"${family}", sans-serif`;
    fitFontCell(el);
    if (el.hasAttribute("data-font-tester")) bindFontTester(el, text);
  };
  try {
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    document.fonts.add(await face.load());
    if (sample) {
      show(sample);
      return;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let lang = "en";
    if (ctx && !flags.latin) {
      ctx.font = `48px "${family}", serif`;
      const w = ctx.measureText("W").width;
      const zh = ctx.measureText("Ж").width;
      ctx.font = "48px serif";
      const hasLatin = Math.abs(w - ctx.measureText("W").width) > 0.8;
      const cyr = Math.abs(zh - ctx.measureText("Ж").width) > 0.8;
      if (hasLatin && cyr) lang = id.charCodeAt(0) % 2 ? "ru" : "en";
      else if (cyr && !hasLatin) lang = "ru";
    }
    show(shapeFontText(pickWord(id, lang), flags));
  } catch {
    el.textContent = sample || shapeFontText(pickWord(id, "en"), flags);
    fitFontCell(el);
  }
}

function hydrateFonts(root) {
  root.querySelectorAll("[data-font-preview]").forEach((el) => {
    paintFontCell(el);
  });
}

/** Deterministic shuffle so tweaking other params does not reshuffle the wall. */
function shuffleSeeded(items, seed) {
  let s = (Number(seed) || 1) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function orderItems(items, opts) {
  const byDate = sortWorksByDate(items);
  if (opts.order === "shuffle") return shuffleSeeded(byDate, opts.seed);
  if (opts.order === "type") {
    return [...byDate].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }
  return byDate;
}

function renderFeed(root, catalog, opts) {
  let items = catalog.items;
  // Daily-practice letters are an admin bucket: only shown when asked for explicitly.
  items = items.filter((item) => !item.hidden);
  items = Array.isArray(opts.types)
    ? items.filter((item) => opts.types.includes(item.type))
    : items.filter((item) => item.type !== TYPE_DAILY);
  items = orderItems(items, opts);
  const cells = items.map((item) => workMarkup(item, opts)).filter(Boolean).join("");
  root.innerHTML = cells ? `<div class="works-feed__grid">${cells}</div>` : "";
  hydrateFonts(root);
  initImgSliders(root);
}

/**
 * Paint the works catalog into `[data-works-feed]` and keep it live.
 * Returns a controller: `update(options)` re-renders with new rules,
 * `catalog` is the last loaded catalog, `destroy()` unsubscribes.
 */
export function initWorksFeed(options = {}) {
  const root = options.root || document.querySelector("[data-works-feed]");
  if (!root) return null;

  let opts = { ...DEFAULTS, ...options, root };
  let catalog = null;
  let stamp = "";

  const render = () => {
    if (catalog) renderFeed(root, catalog, opts);
  };

  const paint = async () => {
    const next = await loadWorksCatalog({ bust: true });
    const key = `${next.updatedAt || ""}:${next.items.length}`;
    if (key === stamp) return;
    stamp = key;
    catalog = next;
    render();
  };

  paint();
  const unsubscribe = subscribeWorksCatalog(paint);

  return {
    get catalog() {
      return catalog;
    },
    get options() {
      return opts;
    },
    update(next = {}) {
      opts = { ...opts, ...next, root };
      render();
    },
    refresh: render,
    destroy() {
      unsubscribe?.();
    },
  };
}
