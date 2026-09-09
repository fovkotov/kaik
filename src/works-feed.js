import { initImgSliders } from "./img-slider.js";
import { publicUrl } from "./public-url.js";
import { t } from "./scriptik.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";
import { subscribeWorksCatalog } from "./works/live.js";
import { TYPE_FINAL, TYPE_FONT, TYPE_LETTERING, sortWorksByDate, spanForWork } from "./works/taxonomy.js";

const PLACEHOLDERS = [
  { span: 1, h: 140 },
  { span: 4, h: 140 },
  { span: 2, h: 140 },
  { span: 3, h: 140 },
  { span: 1, h: 110 },
  { span: 2, h: 110 },
  { span: 2, h: 110 },
  { span: 5, h: 220 },
  { span: 1, h: 88, stack: true },
  { span: 3, h: 184, row: 2 },
  { span: 1, h: 88, stack: true },
];

const EN_WORDS = ["kaik", "letter", "type", "form", "serif", "stroke"];
const RU_WORDS = ["каик", "буква", "набор", "слово", "шрифт", "форма"];

function cellStyle(span, row) {
  const col = `grid-column: span ${span}`;
  return row ? `${col}; grid-row: span ${row}` : col;
}

function placeholderMarkup() {
  return PLACEHOLDERS.map((item) => {
    if (item.stack) {
      return `<div class="works-feed__cell works-feed__cell--stack" style="${cellStyle(item.span)}">
        <div class="works-feed__ph" style="min-height:${item.h}px"></div>
        <div class="works-feed__ph" style="min-height:${item.h}px"></div>
      </div>`;
    }
    return `<div class="works-feed__cell" style="${cellStyle(item.span, item.row)}">
      <div class="works-feed__ph" style="min-height:${item.h}px"></div>
    </div>`;
  }).join("");
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function isFontFile(name) {
  return /\.(ttf|otf|woff2?)$/i.test(String(name || ""));
}

function fileSrc(item) {
  const file = item.files?.find((name) => !isFontFile(name)) || item.files?.[0];
  return file && !isFontFile(file) ? workFileUrl(file) : "";
}

function pickWord(id, lang) {
  const list = lang === "ru" ? RU_WORDS : EN_WORDS;
  let n = 0;
  for (const ch of String(id || "")) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return list[n % list.length];
}

function typeKey(item) {
  return item.type === TYPE_LETTERING ? "works.type.workshop" : "works.type.final";
}

function slideImages(item) {
  return (item.files || []).filter((file) => !isFontFile(file));
}

function sliderMarkup(item) {
  const files = slideImages(item);
  const chevron = esc(publicUrl("assets/cards/history/chevron.svg"));
  const slides = files
    .map(
      (file, i) =>
        `<figure class="img-slider__slide${i === 0 ? " is-active" : ""}" data-img-slider-slide>
          <img src="${esc(workFileUrl(file))}" alt="" draggable="false" />
        </figure>`,
    )
    .join("");
  return `<div class="img-slider works-feed__slider" data-img-slider data-slider-inline>
    ${slides}
    <button type="button" class="img-slider__nav img-slider__nav--prev" data-img-slider-prev data-i18n-aria="history.prev" aria-label="${esc(t("history.prev"))}">
      <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
    </button>
    <button type="button" class="img-slider__nav img-slider__nav--next" data-img-slider-next data-i18n-aria="history.next" aria-label="${esc(t("history.next"))}">
      <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
    </button>
  </div>`;
}

function workMarkup(item) {
  const { span, split } = spanForWork(item);
  const src = fileSrc(item);
  const font = item.type === TYPE_FONT || isFontFile(item.files?.[0]);
  const fontFile = item.files?.find((name) => isFontFile(name)) || item.files?.[0];
  const slides = slideImages(item);
  const who = item.author || item.nick;
  const ratio =
    item.width && item.height
      ? `--art-w:${item.width};--art-h:${item.height}`
      : "--art-w:2;--art-h:1";
  const media = font && fontFile
    ? `<div class="works-feed__art works-feed__art--font" style="${ratio}" data-font-preview data-font-url="${esc(workFileUrl(fontFile))}" data-work-id="${esc(item.id)}"></div>`
    : item.type === TYPE_FINAL && slides.length > 1
      ? sliderMarkup(item)
    : src
      ? `<div class="works-feed__art" style="${ratio}"><img src="${esc(src)}" alt="" draggable="false" /></div>`
      : `<div class="works-feed__ph" style="min-height:120px"></div>`;
  const extra =
    !font && item.type !== TYPE_FINAL && item.files?.length > 1
      ? item.files
          .slice(1)
          .filter((file) => !isFontFile(file))
          .map(
            (file) =>
              `<div class="works-feed__art" style="${ratio}"><img src="${esc(workFileUrl(file))}" alt="" draggable="false" /></div>`,
          )
          .join("")
      : "";
  const body =
    split && extra
      ? `<div class="works-feed__split">${media}${extra}</div>`
      : extra
        ? `<div class="works-feed__gallery">${media}${extra}</div>`
        : media;
  const caption = who
    ? `<p class="works-feed__who"><span>${esc(item.author)}</span>${
        item.nick ? `<span class="works-feed__ig">@${esc(item.nick)}</span>` : ""
      }<span class="works-feed__kind" data-i18n="${typeKey(item)}">${esc(t(typeKey(item)))}</span></p>`
    : "";
  return `<article class="works-feed__cell" data-work-id="${esc(item.id)}" data-span="${span}" style="${cellStyle(span)}">${body}${caption}</article>`;
}

async function paintFontCell(el) {
  const url = el.getAttribute("data-font-url");
  const id = el.getAttribute("data-work-id") || "font";
  if (!url) return;
  const family = `wrk-${id.replace(/[^a-z0-9]/gi, "") || "font"}`;
  try {
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    document.fonts.add(await face.load());
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let lang = "en";
    if (ctx) {
      ctx.font = `48px "${family}", serif`;
      const w = ctx.measureText("W").width;
      const zh = ctx.measureText("Ж").width;
      ctx.font = "48px serif";
      const latin = Math.abs(w - ctx.measureText("W").width) > 0.8;
      const cyr = Math.abs(zh - ctx.measureText("Ж").width) > 0.8;
      if (latin && cyr) lang = id.charCodeAt(0) % 2 ? "ru" : "en";
      else if (cyr && !latin) lang = "ru";
    }
    el.textContent = pickWord(id, lang);
    el.style.fontFamily = `"${family}", sans-serif`;
  } catch {
    el.textContent = pickWord(id, "en");
  }
}

function hydrateFonts(root) {
  root.querySelectorAll("[data-font-preview]").forEach((el) => {
    paintFontCell(el);
  });
}

function renderFeed(root, catalog) {
  const items = sortWorksByDate(catalog.items);
  root.innerHTML = items.length
    ? items.map(workMarkup).join("")
    : placeholderMarkup();
  hydrateFonts(root);
  initImgSliders(root);
}

export function initWorksFeed() {
  const root = document.querySelector("[data-works-feed]");
  if (!root) return null;

  let stamp = "";
  const paint = async () => {
    const catalog = await loadWorksCatalog({ bust: true });
    const next = `${catalog.updatedAt || ""}:${catalog.items.length}`;
    if (next === stamp) return;
    stamp = next;
    renderFeed(root, catalog);
  };

  paint();
  return subscribeWorksCatalog(paint);
}
