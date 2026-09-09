import { initImgSliders } from "./img-slider.js";
import { publicUrl } from "./public-url.js";
import { t } from "./scriptik.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";
import { subscribeWorksCatalog } from "./works/live.js";
import { TYPE_FINAL, TYPE_FONT, placeWork, sortWorksByDate } from "./works/taxonomy.js";

const EN_WORDS = ["kaik", "letter", "type", "form", "serif", "stroke"];
const RU_WORDS = ["каик", "буква", "набор", "слово", "шрифт", "форма"];

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function isFontFile(name) {
  return /\.(ttf|otf|woff2?)$/i.test(String(name || ""));
}

function imageFiles(item) {
  return (item.files || []).filter((file) => !isFontFile(file));
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

function sliderMarkup(item, files) {
  const chevron = esc(publicUrl("assets/cards/history/chevron.svg"));
  const slides = files
    .map(
      (file, i) =>
        `<figure class="img-slider__slide${i === 0 ? " is-active" : ""}" data-img-slider-slide>
          <img src="${esc(workFileUrl(file))}" alt="" ${item.width ? `width="${item.width}" height="${item.height}"` : ""} loading="lazy" decoding="async" draggable="false" />
        </figure>`,
    )
    .join("");
  const many = files.length > 12 ? " works-feed__slider--many" : "";
  return `<div class="img-slider works-feed__slider${many}" data-img-slider data-slider-inline data-slider-tap-next>
    ${slides}
    <button type="button" class="img-slider__nav img-slider__nav--prev" data-img-slider-prev data-i18n-aria="history.prev" aria-label="${esc(t("history.prev"))}">
      <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
    </button>
    <button type="button" class="img-slider__nav img-slider__nav--next" data-img-slider-next data-i18n-aria="history.next" aria-label="${esc(t("history.next"))}">
      <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
    </button>
  </div>`;
}

function fontMarkup(item, fontFile) {
  return `<div class="works-feed__art works-feed__art--font" data-font-preview data-font-url="${esc(
    workFileUrl(fontFile),
  )}" data-work-id="${esc(item.id)}"${item.sample ? ` data-font-sample="${esc(item.sample)}"` : ""}></div>`;
}

/** Same caption as the main-domain collage: name, then @nick. */
function whoMarkup(item) {
  if (!item.author && !item.nick) return "";
  return `<p class="works-card__who works-feed__who">${
    item.author ? `<span>${esc(item.author)}</span>` : ""
  }${item.nick ? `<span class="works-card__ig">@${esc(item.nick)}</span>` : ""}</p>`;
}

function mediaMarkup(item) {
  const fontFile = (item.files || []).find((name) => isFontFile(name));
  if (item.type === TYPE_FONT && fontFile) return fontMarkup(item, fontFile);
  if (fontFile && !imageFiles(item).length) return fontMarkup(item, fontFile);
  const images = imageFiles(item);
  if (!images.length) return "";
  if (item.type === TYPE_FINAL && images.length > 1) return sliderMarkup(item, images);
  return artMarkup(workFileUrl(images[0]), item);
}

function workMarkup(item) {
  const media = mediaMarkup(item);
  if (!media) return "";
  const { cols, rows, kind } = placeWork(item);
  const place = `grid-column: span ${cols}${rows > 1 ? `; grid-row: span ${rows}` : ""}`;
  return `<article class="works-feed__cell works-feed__cell--${esc(kind)}" data-work-id="${esc(
    item.id,
  )}" data-cols="${cols}" data-rows="${rows}" style="${place}">
    <div class="works-feed__media">${media}</div>
    ${whoMarkup(item)}
  </article>`;
}

async function paintFontCell(el) {
  const url = el.getAttribute("data-font-url");
  const id = el.getAttribute("data-work-id") || "font";
  const sample = (el.getAttribute("data-font-sample") || "").trim();
  if (!url) return;
  const family = `wrk-${id.replace(/[^a-z0-9]/gi, "") || "font"}`;
  try {
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    document.fonts.add(await face.load());
    if (sample) {
      el.textContent = sample;
      el.style.fontFamily = `"${family}", sans-serif`;
      return;
    }
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
    el.textContent = sample || pickWord(id, "en");
  }
}

function hydrateFonts(root) {
  root.querySelectorAll("[data-font-preview]").forEach((el) => {
    paintFontCell(el);
  });
}

function renderFeed(root, catalog) {
  const items = sortWorksByDate(catalog.items);
  const cells = items.map(workMarkup).filter(Boolean).join("");
  root.innerHTML = cells ? `<div class="works-feed__grid">${cells}</div>` : "";
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
