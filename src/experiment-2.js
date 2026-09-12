import Lenis from "lenis";
import { initEmbed, safeStorage } from "./embed.js";
import { playUISound } from "./lib/ui-sounds.js";
import { playTickClick } from "./tick-clicks.js";
import { applyTranslations, getLocale, setLocale, t } from "./scriptik.js";
import { planExperiment2 } from "./experiment-2-planner.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";
import {
  TYPE_DAILY,
  TYPE_FINAL,
  TYPE_FONT,
  TYPE_LETTERING,
  normalizeExperiment2Layout,
} from "./works/taxonomy.js";
import { fontFlags, settleFontText, shapeFontText } from "./works/font-display.js";

const VISUAL_TYPES = [TYPE_DAILY, TYPE_LETTERING, TYPE_FINAL, TYPE_FONT];
const FONT_RE = /\.(?:ttf|otf|woff2?)$/i;
const FONT_TESTER_MAX_CHARS = 60;
const FONT_TESTER_PX = 365;
/* Fallback only — the live value is `--font-card-h-mobile` in experiment-2.css. */
const FONT_TESTER_PX_MOBILE = 80;

const hero = document.querySelector("[data-lettering-hero]");
const letteringImage = document.querySelector("[data-lettering-image]");
const action = document.querySelector("[data-lettering-action]");
const credit = document.querySelector("[data-lettering-credit]");
const grid = document.querySelector("[data-works-grid]");
const page = document.querySelector(".works-page");
const empty = document.querySelector("[data-works-empty]");
const filters = [...document.querySelectorAll("[data-filter]")];
const settingsPanel = document.querySelector("[data-grid-settings]");
const storage = safeStorage();
const SETTINGS_KEY = "kaik:experiment-2:grid-v2";
const ENTER_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ENTER_MS = 520;
const ENTER_STAGGER_MS = 40;

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
/* The page's mobile breakpoint — same query as the CSS. Picks mobileColumns / heroVhMobile. */
const NARROW = window.matchMedia("(max-width: 760px)");

let catalog = [];
let catalogLayout = normalizeExperiment2Layout();
let layout = catalogLayout;
let catalogReady = false;
let workshopWorks = [];
let heroQueue = [];
let heroQueueIndex = -1;
let heroGeneration = 0;
const enabledTypes = new Set(VISUAL_TYPES);
let activeLettering = null;
let follower = null;
let viewer = null;
let measureGridGeometry = () => {};
let cardMeasureFrame = 0;
let cardGuardPasses = 0;
/* Card media (img src / webfont) is fetched only when the card nears the viewport. */
let mediaObserver = null;
const pendingHydration = new Map();
/* Lookahead for fetching card files: 1.5 screens on desktop, 1.5× that on mobile,
   where a thumb-flick covers more screens per second and the link is slower. */
const MEDIA_ROOT_MARGIN = "150% 0px";
const MEDIA_ROOT_MARGIN_MOBILE = "225% 0px";
/* How many hero letterings block the first reveal; the rest warm up in idle time. */
const HERO_EAGER = 1;
const HERO_WARM_CONCURRENCY = 2;
let pageLenis = null;
let enterObserver = null;
let enterIndex = 0;
/* Desktop-only: set once the interactive hero has been wired and its letterings requested. */
let heroStarted = false;

/* ---------- helpers ---------- */

function isMobile() {
  return COARSE.matches || window.innerWidth <= 760;
}

/** Live track count: `columns` on desktop, `mobileColumns` at the mobile breakpoint. */
function activeColumns() {
  return NARROW.matches ? layout.mobileColumns : layout.columns;
}

/** Desktop: interactive hero height. Mobile: height of the static illustration block. */
function activeHeroVh() {
  return NARROW.matches ? layout.heroVhMobile : layout.heroVh;
}

function imageFiles(item) {
  return (item?.files || []).filter((file) => !FONT_RE.test(file));
}

function isSvgFile(file) {
  return /\.svg$/i.test(String(file || ""));
}

/** Raster finals stay 16:9 cover. SVG covers keep their real aspect so swashes are not cropped. */
function usesCoverCrop(item) {
  return item?.type === TYPE_FINAL && !isSvgFile(imageFiles(item)[0]);
}

function fontFile(item) {
  return (item?.files || []).find((file) => FONT_RE.test(file)) || null;
}

/** The hero draws vector only: the first .svg of a work, or nothing. */
function svgFile(item) {
  return (item?.files || []).find((file) => /\.svg$/i.test(file)) || null;
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Trimmed catalog string, or "" when missing / whitespace-only. */
function fieldText(value) {
  return String(value ?? "").trim();
}

/** Cards only show a caption when the author has a name and/or nick. */
function hasAuthorIdentity(item) {
  return Boolean(fieldText(item?.author) || fieldText(item?.nick));
}

/** Name, @nick and stream as spans; muted parts get `.is-muted`. */
function metaNodes(item) {
  if (!hasAuthorIdentity(item)) return [];
  const nodes = [];
  const author = fieldText(item?.author);
  const nick = fieldText(item?.nick);
  const stream = fieldText(item?.stream);
  if (author) {
    const name = document.createElement("span");
    name.textContent = author;
    nodes.push(name);
  }
  if (nick) {
    const nickEl = document.createElement("span");
    nickEl.className = "is-muted";
    nickEl.textContent = `@${nick}`;
    nodes.push(nickEl);
  }
  if (stream) {
    const streamEl = document.createElement("span");
    streamEl.className = "is-muted";
    streamEl.textContent = t("exp2.stream").replace("{n}", stream);
    nodes.push(streamEl);
  }
  return nodes;
}

/** Fill or clear the hero credit so an empty identity leaves no leftover row. */
function syncLetteringCredit(item) {
  if (!credit) return;
  if (!hasAuthorIdentity(item)) {
    credit.replaceChildren();
    credit.hidden = true;
    return;
  }
  credit.hidden = false;
  credit.replaceChildren(...metaNodes(item));
}

function altFor(item) {
  const kind =
    item.type === TYPE_FINAL
      ? t("exp2.kind.final")
      : item.type === TYPE_DAILY
        ? t("exp2.kind.daily")
        : item.type === TYPE_FONT
          ? t("exp2.kind.font")
          : t("exp2.kind.workshop");
  const author = fieldText(item?.author);
  return author ? `${kind}, ${author}` : kind;
}

/** Ensure grid cards only keep `.work-card__meta` when author identity exists. */
function syncCardMeta(card, item) {
  let meta = card.querySelector(".work-card__meta");
  if (!hasAuthorIdentity(item)) {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement(card.tagName === "BUTTON" ? "span" : "div");
    meta.className = "work-card__meta";
    card.append(meta);
  }
  meta.replaceChildren(...metaNodes(item));
}

/* ---------- language ---------- */

/** Rewrites text we build in JS (captions, alt, specimen hint) after a locale change. */
function retranslateDynamic() {
  if (activeLettering) {
    letteringImage.alt = altFor(activeLettering);
    syncLetteringCredit(activeLettering);
  }
  grid.querySelectorAll(".work-card").forEach((card) => {
    const item = catalog.find((entry) => entry.id === card.dataset.workId);
    if (!item) return;
    syncCardMeta(card, item);
    const image = card.querySelector("img");
    if (image) image.alt = altFor(item);
    card.querySelector(".work-card__font-specimen")?.setAttribute("aria-label", t("works.fontTester"));
  });
  /* Captions may wrap differently in the other language. */
  scheduleCardMeasure();
}

/** Language chip shows the current locale; a click flips en ↔ ru.
    Two copies exist (desktop sticky row, mobile bottom bar); CSS shows one at a time. */
function setupLanguage() {
  const toggles = [...document.querySelectorAll("[data-lang-toggle]")];
  const labels = toggles.map((toggle) => toggle.querySelector("[data-lang-label]")).filter(Boolean);
  document.addEventListener("kaik:translated", (event) => {
    const locale = event.detail?.locale || getLocale();
    labels.forEach((label) => {
      label.textContent = locale;
    });
    retranslateDynamic();
  });
  toggles.forEach((toggle) => {
    toggle.addEventListener("click", (event) => {
      playTickClick(event);
      setLocale(getLocale() === "ru" ? "en" : "ru");
    });
  });
  applyTranslations(getLocale());
}

/* ---------- local grid settings ---------- */

function readStoredLayout() {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    return raw ? normalizeExperiment2Layout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function applyLayout(next, { persist = false } = {}) {
  layout = normalizeExperiment2Layout(next);
  grid.style.setProperty("--grid-columns", String(activeColumns()));
  page?.style.setProperty("--hero-vh", String(activeHeroVh()));
  grid.style.setProperty("--grid-gap-x", `${layout.gapX}px`);
  grid.style.setProperty("--grid-gap-y", `${layout.gapY}px`);
  grid.style.setProperty(
    "--cell-align-x",
    layout.alignX === "start" ? "left" : layout.alignX === "end" ? "right" : "center",
  );
  grid.style.setProperty(
    "--cell-align-y",
    layout.alignY === "start" ? "top" : layout.alignY === "end" ? "bottom" : "center",
  );
  grid.style.setProperty(
    "--cell-pack-x",
    layout.alignX === "start" ? "flex-start" : layout.alignX === "end" ? "flex-end" : "center",
  );
  grid.style.setProperty(
    "--cell-pack-y",
    layout.alignY === "start" ? "flex-start" : layout.alignY === "end" ? "flex-end" : "center",
  );
  grid.dataset.dense = layout.dense ? "true" : "false";
  if (persist) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(layout));
    } catch {
      // safeStorage normally absorbs this; storage can still disappear mid-session.
    }
  }
  measureGridGeometry();
  /* Hero height may have changed: re-fit the lettering and re-measure the sticky row. */
  follower?.measure();
  syncIslandSticky();
  syncSettingsPanel();
  renderGrid();
}

function syncSettingsPanel() {
  if (!settingsPanel) return;
  for (const name of ["columns", "mobileColumns", "heroVh", "heroVhMobile", "cellRatio", "gapX", "gapY"]) {
    const input = settingsPanel.querySelector(`[name="${name}"]`);
    if (input && document.activeElement !== input) input.value = String(Number(layout[name].toFixed?.(3) ?? layout[name]));
  }
  const dense = settingsPanel.querySelector('[name="dense"]');
  if (dense) dense.checked = Boolean(layout.dense);
  settingsPanel.querySelectorAll("[data-pattern]").forEach((group) => {
    const pattern = layout.typePatterns[group.dataset.pattern];
    if (!pattern) return;
    for (const name of ["baseSpan", "interval", "span"]) {
      const input = group.querySelector(`[name="${name}"]`);
      if (input && document.activeElement !== input && pattern[name] != null) {
        input.value = String(pattern[name]);
      }
    }
  });
  settingsPanel.querySelectorAll("[data-align]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      button.dataset.align === `${layout.alignX},${layout.alignY}` ? "true" : "false",
    );
  });
}

function setupGridSettings() {
  if (!settingsPanel) return;
  const updateNumber = (input) => {
    if (input.type === "checkbox") {
      applyLayout({ ...layout, [input.name]: input.checked }, { persist: true });
      return;
    }
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const group = input.closest("[data-pattern]");
    if (group) {
      applyLayout(
        {
          ...layout,
          typePatterns: {
            ...layout.typePatterns,
            [group.dataset.pattern]: {
              ...layout.typePatterns[group.dataset.pattern],
              [input.name]: value,
            },
          },
        },
        { persist: true },
      );
      return;
    }
    applyLayout({ ...layout, [input.name]: value }, { persist: true });
  };
  settingsPanel.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => updateNumber(input));
  });
  settingsPanel.querySelectorAll("[data-align]").forEach((button) => {
    button.addEventListener("click", () => {
      const [alignX, alignY] = button.dataset.align.split(",");
      applyLayout({ ...layout, alignX, alignY }, { persist: true });
    });
  });
  settingsPanel.querySelector("[data-grid-settings-close]")?.addEventListener("click", () => {
    settingsPanel.hidden = true;
  });
  settingsPanel.querySelector("[data-grid-settings-reset]")?.addEventListener("click", () => {
    storage.removeItem(SETTINGS_KEY);
    applyLayout(catalogLayout);
  });
  window.addEventListener("keydown", (event) => {
    const typing = event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable='true']");
    if (typing) return;
    if (event.key === "Escape" && !settingsPanel.hidden) {
      event.preventDefault();
      settingsPanel.hidden = true;
      return;
    }
    if ((event.key === "g" || event.key === "G") && !viewer?.isOpen) {
      event.preventDefault();
      settingsPanel.hidden = !settingsPanel.hidden;
      if (!settingsPanel.hidden) syncSettingsPanel();
    }
  });
  syncSettingsPanel();
}

/* ---------- mixed grid ---------- */

function plainSpecimenText(value) {
  return String(value || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, FONT_TESTER_MAX_CHARS);
}

/** Mobile tester strip height from CSS (`--font-card-h-mobile`), so the JS never disagrees with the stylesheet. */
function fontTesterMobilePx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--font-card-h-mobile");
  const px = Number.parseFloat(raw);
  return px > 0 ? px : FONT_TESTER_PX_MOBILE;
}

function fitFontSpecimen(specimen) {
  const width = specimen.clientWidth;
  const height = specimen.clientHeight || (NARROW.matches ? fontTesterMobilePx() : FONT_TESTER_PX);
  if (!width || !specimen.firstChild) return;
  const current = Number.parseFloat(specimen.style.getPropertyValue("--font-fit")) || 1;
  const range = document.createRange();
  range.selectNodeContents(specimen);
  const ink = range.getBoundingClientRect();
  const needed = ink.width;
  if (!(needed > 0)) return;
  let next = current;
  if (needed > width + 0.5) {
    next = Math.max(0.12, current * (width / needed) * 0.96);
  } else if (current < 1 && needed < width * 0.92) {
    next = Math.min(1, current * (width / needed) * 0.96);
  }
  if (ink.height > height + 0.5) {
    next = Math.max(0.12, Math.min(next, current * (height / ink.height) * 0.9));
  }
  const rounded = Math.round(next * 1000) / 1000;
  const prev = specimen.style.getPropertyValue("--font-fit");
  if (rounded >= 0.999) specimen.style.removeProperty("--font-fit");
  else specimen.style.setProperty("--font-fit", String(rounded));
  if (specimen.style.getPropertyValue("--font-fit") !== prev) scheduleCardMeasure();
}

function bindFontSpecimen(specimen, fallback, flags = {}) {
  const settle = () => {
    settleFontText(specimen, plainSpecimenText, flags);
    fitFontSpecimen(specimen);
  };
  specimen.addEventListener("focus", () => {
    const range = document.createRange();
    range.selectNodeContents(specimen);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  specimen.addEventListener("blur", () => {
    if (!specimen.textContent.trim()) specimen.textContent = fallback;
    settle();
  });
  specimen.addEventListener("input", settle);
  specimen.addEventListener("paste", (event) => {
    event.preventDefault();
    document.execCommand(
      "insertText",
      false,
      shapeFontText(plainSpecimenText(event.clipboardData?.getData("text/plain")), flags),
    );
    settle();
  });
  specimen.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      specimen.blur();
    }
    event.stopPropagation();
  });
  new ResizeObserver(() => {
    fitFontSpecimen(specimen);
    scheduleCardMeasure();
  }).observe(specimen);
}

/** Synchronous part: fallback text and editing; the webfont itself waits for the viewport. */
function mountFontSpecimen(specimen, item) {
  const flags = fontFlags(item);
  const fallback = shapeFontText(item.sample || "Käik", flags);
  specimen.textContent = fallback;
  bindFontSpecimen(specimen, fallback, flags);
}

async function hydrateFontSpecimen(specimen, item, file) {
  const family = `exp2-${String(item.id).replace(/[^a-z0-9]/gi, "") || "font"}`;
  try {
    const face = new FontFace(family, `url(${JSON.stringify(workFileUrl(file))})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
    specimen.style.fontFamily = `"${family}", sans-serif`;
    await document.fonts.ready;
    await document.fonts.load(`48px "${family}"`).catch(() => {});
    loaded.loaded.then(() => {
      fitFontSpecimen(specimen);
      scheduleCardMeasure();
    }).catch(() => {});
  } catch {
    specimen.classList.add("is-font-error");
  }
  try {
    await document.fonts.ready;
  } catch {
    /* third-party iframe can reject FontFaceSet */
  }
  fitFontSpecimen(specimen);
  scheduleCardMeasure();
  markCardEnterReady(specimen.closest(".work-card"));
}

function setArtworkDimensions(card, preview, width, height) {
  const intrinsicWidth = Number(width);
  const intrinsicHeight = Number(height);
  if (!(intrinsicWidth > 0 && intrinsicHeight > 0)) return false;
  card.dataset.artWidth = String(intrinsicWidth);
  card.dataset.artHeight = String(intrinsicHeight);
  /* Lettering/daily and SVG finals size from the img (width 100% / height auto).
     Raster finals keep a 16:9 cover plate. */
  if (card.dataset.fit === "cover") {
    preview.style.aspectRatio = "16 / 9";
  } else {
    preview.style.removeProperty("aspect-ratio");
  }
  return true;
}

/**
 * Cards are span-only grid items: `grid-column: span N` from the planner and
 * `grid-row: span M` from the intrinsic content height. The implicit row step
 * is a few px, so M snaps to the media plus caption and dense flow can slide
 * the next small card into whatever gap a large one leaves.
 */
function rowUnitPx() {
  return (
    Number.parseFloat(grid.style.getPropertyValue("--grid-row-unit")) ||
    Number.parseFloat(getComputedStyle(grid).getPropertyValue("--grid-row-unit")) ||
    0
  );
}

/** Scaled natural height of the media, never the already-clipped box. */
function intrinsicArtHeight(card, boxWidth) {
  if (card.dataset.fit === "cover") return boxWidth * (9 / 16);
  const image = card.querySelector(".work-card__preview img");
  /* Catalog dims reserve the span before the (lazy) file arrives; natural dims take over after. */
  const naturalW = image?.naturalWidth || Number(card.dataset.artWidth);
  const naturalH = image?.naturalHeight || Number(card.dataset.artHeight);
  if (naturalW > 0 && naturalH > 0) return boxWidth * (naturalH / naturalW);
  return 0;
}

/**
 * Desktop tester is 365px and ink may overflow, so we span painted glyphs.
 * Mobile is a fixed strip (`--font-card-h-mobile`) whose specimen is sized from
 * the strip and clipped, so the strip itself is the whole answer.
 */
function intrinsicSpecimenHeight(card) {
  if (NARROW.matches) return fontTesterMobilePx();
  const specimen = card.querySelector(".work-card__font-specimen");
  const art = card.querySelector(".work-card__art");
  if (!specimen) return art?.scrollHeight || FONT_TESTER_PX;
  let textHeight = 0;
  if (specimen.firstChild) {
    const range = document.createRange();
    range.selectNodeContents(specimen);
    textHeight = range.getBoundingClientRect().height;
  }
  return Math.max(
    FONT_TESTER_PX,
    specimen.scrollHeight,
    specimen.offsetHeight,
    art?.scrollHeight || 0,
    textHeight,
  );
}

/**
 * One pass over every card: read all geometry first, then write all row spans.
 * The needed height is the larger of the intrinsic estimate (catalog / natural
 * dims scaled to the span) and what is actually painted (art + caption, plus any
 * ink that overflows into the caption), so a single pass never ping-pongs
 * between a "measure" and a "guard" value. Returns true when a span changed.
 */
function measureCards() {
  const cards = grid.querySelectorAll(".work-card");
  if (!cards.length) return false;
  const rowUnit = rowUnitPx();
  if (!(rowUnit > 0)) return false;
  const rowPitch = rowUnit + layout.gapY;
  /* `.work-card { gap: 0 }` — one computed style per pass, not one per card. */
  const stackGap = Number.parseFloat(getComputedStyle(cards[0]).rowGap) || 0;
  const writes = [];
  for (const card of cards) {
    const boxWidth = card.clientWidth;
    if (!(boxWidth > 0)) continue;
    const art = card.querySelector(".work-card__art");
    const meta = card.querySelector(".work-card__meta");
    const metaBox = meta?.getBoundingClientRect();
    const metaHeight = meta ? Math.max(meta.scrollHeight, metaBox?.height || 0) : 0;
    const isFont = card.classList.contains("work-card--font");
    /* Mobile font strip: fixed height, clipped specimen — already contained, so no
       painted-overflow guard may bump it. */
    const fixedArt = isFont && NARROW.matches;
    let artHeight = isFont ? intrinsicSpecimenHeight(card) : intrinsicArtHeight(card, boxWidth);
    if (!fixedArt) artHeight = Math.max(artHeight, art?.scrollHeight || 0);
    /* Ink spilling into the caption: only meaningful while the caption is rendered —
       a `display: none` meta reports a zero rect at y=0, which would read as
       "overflows by the card's whole viewport offset". */
    if (isFont && !fixedArt && art && metaBox && metaBox.height > 0) {
      const artBox = art.getBoundingClientRect();
      if (artBox.bottom > metaBox.top + 0.5) {
        artHeight = Math.max(artHeight, artBox.height + (artBox.bottom - metaBox.top));
      }
    }
    if (!(artHeight > 0)) continue;
    const needed = artHeight + stackGap + metaHeight;
    const rowSpan = Math.max(1, Math.ceil((needed + layout.gapY) / rowPitch));
    if (card.dataset.rowSpan !== String(rowSpan)) writes.push([card, rowSpan]);
  }
  for (const [card, rowSpan] of writes) {
    card.dataset.rowSpan = String(rowSpan);
    card.style.setProperty("--card-row-span", String(rowSpan));
  }
  return writes.length > 0;
}

/** Double-rAF so styles/images have settled; re-runs while spans still move, a few times at most. */
function scheduleCardMeasure() {
  cancelAnimationFrame(cardMeasureFrame);
  cardMeasureFrame = requestAnimationFrame(() => {
    cardMeasureFrame = requestAnimationFrame(() => {
      const changed = measureCards();
      if (changed && cardGuardPasses < 4) {
        cardGuardPasses += 1;
        scheduleCardMeasure();
        return;
      }
      cardGuardPasses = 0;
    });
  });
}

/* ---------- lazy media ---------- */

/**
 * Card files (SVG/raster covers, specimen webfonts) start downloading only when
 * the card is within ~1.5 screens of the scroller. Spans are already reserved
 * from catalog dims, so hydration never shifts the grid.
 */
function observeCardMedia() {
  mediaObserver?.disconnect();
  const root = document.querySelector("[data-scroll-root]");
  mediaObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        hydrateCard(entry.target);
      }
    },
    { root, rootMargin: isMobile() ? MEDIA_ROOT_MARGIN_MOBILE : MEDIA_ROOT_MARGIN, threshold: 0 },
  );
  pendingHydration.forEach((_, card) => mediaObserver.observe(card));
}

function hydrateCard(card) {
  const run = pendingHydration.get(card);
  if (!run) return;
  pendingHydration.delete(card);
  mediaObserver?.unobserve(card);
  run();
}

function queueCardMedia(card, run) {
  pendingHydration.set(card, run);
}

function cardInScrollView(card) {
  const root = document.querySelector("[data-scroll-root]");
  const box = card.getBoundingClientRect();
  if (!(box.width || box.height)) return false;
  /* Edge rule: the card counts as in view the moment its top touches the fold. */
  if (!root) return box.bottom > 0 && box.top <= window.innerHeight;
  const view = root.getBoundingClientRect();
  return box.bottom > view.top && box.top <= view.bottom;
}

function playCardEnter(card) {
  if (!card || card.dataset.entered === "1") return;
  card.dataset.entered = "1";
  const delay = (enterIndex % 12) * ENTER_STAGGER_MS;
  enterIndex += 1;
  const from = REDUCE.matches
    ? { opacity: 0 }
    : { opacity: 0, transform: "translate3d(0px, 8px, 0) scale(1.04)" };
  const to = REDUCE.matches
    ? { opacity: 1 }
    : { opacity: 1, transform: "translate3d(0px, 0px, 0) scale(1)" };
  const anim = card.animate([from, to], {
    duration: REDUCE.matches ? 200 : ENTER_MS,
    delay,
    easing: REDUCE.matches ? "ease" : ENTER_EASE,
    fill: "forwards",
  });
  const settle = () => {
    anim.cancel();
    card.classList.remove("is-enter");
    card.classList.add("is-entered");
  };
  anim.finished.then(settle).catch(settle);
}

function requestCardEnter(card) {
  if (!card || card.dataset.entered === "1" || card.dataset.enterReady !== "1") return;
  if (cardInScrollView(card)) playCardEnter(card);
}

function markCardEnterReady(card) {
  if (!card) return;
  card.dataset.enterReady = "1";
  requestCardEnter(card);
}

function observeCardEnters() {
  enterObserver?.disconnect();
  enterIndex = 0;
  const root = document.querySelector("[data-scroll-root]");
  enterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) requestCardEnter(entry.target);
      });
    },
    /* The scale-down fade starts the moment the card's top edge crosses the fold
       (threshold 0, no margin), so the enter is visible on screen. The file itself
       was fetched screens earlier by the media observer. */
    { root, threshold: 0 },
  );
  grid.querySelectorAll(".work-card").forEach((card) => enterObserver.observe(card));
}

function bindArtworkMetrics(card, preview, image) {
  const applyNatural = () => {
    const src = image.currentSrc || image.src || "";
    if (/\.svg(?:$|\?)/i.test(src) || card.dataset.fit === "contain") {
      card.dataset.fit = "contain";
      preview.style.overflow = "visible";
      image.style.objectFit = "contain";
      image.style.width = "100%";
      image.style.height = "auto";
      image.style.overflow = "visible";
    }
    if (!setArtworkDimensions(card, preview, image.naturalWidth, image.naturalHeight)) return;
    scheduleCardMeasure();
  };
  /* `load` alone: an eager decode() would force every lazy image to download at once. */
  image.addEventListener("load", applyNatural);
  image.addEventListener("error", () => scheduleCardMeasure(), { once: true });
  if (image.complete && image.naturalWidth) queueMicrotask(applyNatural);
}

function cardFor(item, span) {
  if (item.type === TYPE_FONT) return fontCardFor(item, span);
  const cover = imageFiles(item)[0];
  const card = document.createElement("button");
  card.type = "button";
  card.className = "work-card is-enter";
  card.dataset.workId = item.id;
  card.dataset.type = item.type;
  card.dataset.span = String(span);
  card.style.setProperty("--card-span", String(span));

  const art = document.createElement("span");
  art.className = "work-card__art";
  const preview = document.createElement("span");
  preview.className = "work-card__preview";
  const coverCrop = usesCoverCrop(item);
  card.dataset.fit = coverCrop ? "cover" : "contain";
  if (coverCrop) setArtworkDimensions(card, preview, 16, 9);
  else if (setArtworkDimensions(card, preview, item.width, item.height)) {
    /* Placeholder box from catalog dims until the file arrives; applyNatural clears it. */
    preview.style.aspectRatio = `${Number(item.width)} / ${Number(item.height)}`;
  }
  const image = document.createElement("img");
  /* Not `loading="lazy"`: the viewport gate is our IntersectionObserver (with its
     wider mobile lookahead). The browser's own lazy distance (~1250px on 4G in
     Chrome) would otherwise hold the fetch back until the card is much closer. */
  image.loading = "eager";
  image.decoding = "async";
  image.draggable = false;
  revealOnLoad(image, preview, { skeleton: coverCrop });
  const ready = () => markCardEnterReady(card);
  image.addEventListener("load", ready, { once: true });
  image.addEventListener("error", ready, { once: true });
  if (coverCrop) image.addEventListener("load", () => scheduleCardMeasure());
  else bindArtworkMetrics(card, preview, image);
  preview.append(image);
  art.append(preview);

  card.append(art);
  if (hasAuthorIdentity(item)) {
    const meta = document.createElement("span");
    meta.className = "work-card__meta";
    meta.append(...metaNodes(item));
    card.append(meta);
  }
  card.addEventListener("click", (event) => openViewerFor(item, card, event));
  /* src (and alt, so an src-less img never paints alt text) wait for the viewport. */
  queueCardMedia(card, () => {
    image.alt = altFor(item);
    image.src = workFileUrl(cover);
    if (image.complete && image.naturalWidth) queueMicrotask(ready);
  });
  return card;
}

function fontCardFor(item, span) {
  const file = fontFile(item);
  const card = document.createElement("article");
  card.className = "work-card work-card--font is-enter";
  card.dataset.workId = item.id;
  card.dataset.type = item.type;
  card.dataset.span = String(span);
  card.style.setProperty("--card-span", String(span));

  const art = document.createElement("div");
  art.className = "work-card__art";
  const specimen = document.createElement("div");
  specimen.className = "work-card__font-specimen";
  specimen.contentEditable = "true";
  specimen.spellcheck = false;
  specimen.setAttribute("role", "textbox");
  specimen.setAttribute("aria-label", t("works.fontTester"));
  art.append(specimen);

  card.append(art);
  if (hasAuthorIdentity(item)) {
    const meta = document.createElement("div");
    meta.className = "work-card__meta";
    meta.append(...metaNodes(item));
    card.append(meta);
  }
  mountFontSpecimen(specimen, item);
  queueCardMedia(card, () => hydrateFontSpecimen(specimen, item, file));
  return card;
}

function visibleWorks() {
  return catalog.filter(
    (item) =>
      !item.hidden &&
      enabledTypes.has(item.type) &&
      VISUAL_TYPES.includes(item.type) &&
      (item.type === TYPE_FONT ? Boolean(fontFile(item)) : imageFiles(item).length > 0),
  );
}

function slideFor(item, file) {
  return { src: workFileUrl(file), alt: altFor(item), caption: () => metaNodes(item) };
}

/**
 * A final project pages through its own files. Daily and workshop cards share
 * one non-final browsing sequence in the currently visible filtered order.
 */
function openViewerFor(item, card, event) {
  if (!viewer) return;
  playTickClick(event);
  if (item.type === TYPE_FINAL) {
    viewer.open(imageFiles(item).map((file) => slideFor(item, file)), 0, card);
    return;
  }
  const works = visibleWorks().filter((work) => work.type !== TYPE_FINAL);
  const slides = works.map((work) => slideFor(work, imageFiles(work)[0]));
  const start = Math.max(0, works.findIndex((work) => work.id === item.id));
  viewer.open(slides, start, card);
}

function renderGrid() {
  if (!catalogReady) {
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "true");
    empty.hidden = true;
    return;
  }
  const works = visibleWorks();
  const planned = planExperiment2(works, layout, activeColumns());
  const fragment = document.createDocumentFragment();
  pendingHydration.clear();
  planned.forEach(({ item, span }) => fragment.append(cardFor(item, span)));
  grid.replaceChildren(fragment);
  /* One synchronous pass so the first paint already has spans from catalog dims. */
  measureCards();
  observeCardMedia();
  observeCardEnters();
  scheduleCardMeasure();
  empty.hidden = works.length > 0;
}

function setupGridGeometry() {
  measureGridGeometry = () => {
    const columns = activeColumns();
    const gaps = Math.max(0, columns - 1) * layout.gapX;
    const track = Math.max(1, (grid.clientWidth - gaps) / columns);
    grid.style.setProperty("--grid-row-h", `${track / layout.cellRatio}px`);
    // Row step scales with the column: ~4% of a track (min 4px), so the snap
    // slack stays invisible and the implicit row count stays bounded.
    grid.style.setProperty("--grid-row-unit", `${Math.max(4, Math.round(track / 24))}px`);
    scheduleCardMeasure();
  };
  new ResizeObserver(measureGridGeometry).observe(grid);
  measureGridGeometry();
  /* Crossing the breakpoint swaps columns and hero height: re-plan the feed with the other set.
     Widening past it for the first time also brings the interactive hero to life. */
  NARROW.addEventListener("change", () => {
    if (catalogReady) applyLayout(layout);
    startHero();
  });
}

/**
 * Exclusive chips: a tap on an inactive chip shows only that type, a tap on
 * another chip switches to it, a tap on the active chip returns to everything.
 */
function setupFilters() {
  let exclusiveType = null;
  const syncFilters = () => {
    filters.forEach((button) => {
      button.setAttribute("aria-checked", enabledTypes.has(button.dataset.filter) ? "true" : "false");
    });
    /* Full-width specimens while only fonts are shown. A grid state class rather than
       a layout edit, so returning to the mixed feed restores the planned span. */
    grid.classList.toggle("is-fonts-only", exclusiveType === TYPE_FONT);
  };
  filters.forEach((button) => {
    button.addEventListener("click", (event) => {
      const type = button.dataset.filter;
      if (!VISUAL_TYPES.includes(type)) return;
      playTickClick(event);
      enabledTypes.clear();
      if (exclusiveType === type) {
        exclusiveType = null;
        VISUAL_TYPES.forEach((visual) => enabledTypes.add(visual));
      } else {
        exclusiveType = type;
        enabledTypes.add(type);
      }
      syncFilters();
      renderGrid();
    });
  });
  syncFilters();
}

/** Finals keep a 16:9 plate until pixels arrive. Lettering enters as a whole card. */
function revealOnLoad(image, frame, { skeleton = true } = {}) {
  if (!skeleton) {
    frame.classList.add("is-loaded");
    return;
  }
  const done = () => frame.classList.add("is-loaded");
  image.addEventListener("load", done, { once: true });
  image.addEventListener("error", done, { once: true });
  if (image.complete && image.naturalWidth) done();
}

/* ---------- hero ---------- */

function preloadHeroImage(item) {
  return new Promise((resolve) => {
    const image = new Image();
    const done = (ok) => resolve(ok ? item : null);
    image.decoding = "async";
    image.addEventListener("load", () => done(true), { once: true });
    image.addEventListener("error", () => done(false), { once: true });
    image.src = workFileUrl(svgFile(item));
    if (image.complete) done(image.naturalWidth > 0);
  });
}

const idle =
  typeof requestIdleCallback === "function"
    ? (fn) => requestIdleCallback(fn, { timeout: 1500 })
    : (fn) => setTimeout(fn, 200);

/**
 * Reveal the hero as soon as the first lettering has pixels; the rest of the
 * deck warms the image cache in idle time, a couple of files at a time, and
 * joins `workshopWorks` as it lands — so a tap always hits a cached SVG, but
 * the first paint on a slow link no longer waits for all ~50 downloads.
 */
async function preloadHeroWorks(items) {
  const queue = [...items];
  const ready = [];
  while (queue.length && ready.length < HERO_EAGER) {
    const item = await preloadHeroImage(queue.shift());
    if (item) ready.push(item);
  }
  const warm = () => {
    if (!queue.length) return;
    const batch = queue.splice(0, HERO_WARM_CONCURRENCY);
    Promise.all(batch.map(preloadHeroImage)).then((loaded) => {
      /* `ready` becomes `workshopWorks` in boot; pushing here grows the live deck. */
      loaded.filter(Boolean).forEach((item) => ready.push(item));
      idle(warm);
    });
  };
  idle(warm);
  return ready;
}

function refillHeroQueue() {
  heroQueue = shuffled(workshopWorks);
  if (heroQueue.length > 1 && heroQueue[0]?.id === activeLettering?.id) {
    [heroQueue[0], heroQueue[1]] = [heroQueue[1], heroQueue[0]];
  }
  heroQueueIndex = 0;
}

function setHero(item) {
  const file = svgFile(item);
  if (!file) return;
  const generation = ++heroGeneration;
  activeLettering = item;
  letteringImage.src = workFileUrl(file);
  letteringImage.alt = altFor(item);
  syncLetteringCredit(item);

  /* Loader/fade belongs only to startup. Ignore superseded load events. */
  if (!hero.classList.contains("is-loaded")) {
    const reveal = () => {
      letteringImage.removeEventListener("load", reveal);
      letteringImage.removeEventListener("error", reveal);
      if (generation === heroGeneration) hero.classList.add("is-loaded");
    };
    letteringImage.addEventListener("load", reveal);
    letteringImage.addEventListener("error", reveal);
    if (letteringImage.complete && letteringImage.naturalWidth) queueMicrotask(reveal);
  }
}

function nextHero() {
  if (!workshopWorks.length) return;
  if (heroQueueIndex < 0 || heroQueueIndex >= heroQueue.length) refillHeroQueue();
  const next = heroQueue[heroQueueIndex];
  heroQueueIndex += 1;
  setHero(next);
}

/**
 * The lettering is the cursor: its centre eases toward the pointer, nothing else.
 * Offsets are measured from the hero centre so the CSS centring stays intact,
 * and are clamped so the artwork never leaves the hero box.
 */
function createFollower() {
  const EASE = 0.16;
  const current = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const limit = { x: 0, y: 0 };
  let frame = 0;
  let active = true;

  /** Half the free room on each axis: how far the centre may drift from the middle. */
  function measure() {
    const box = hero.getBoundingClientRect();
    const art = letteringImage.getBoundingClientRect();
    limit.x = Math.max(0, (box.width - art.width) / 2);
    limit.y = Math.max(0, (box.height - art.height) / 2);
    target.x = Math.max(-limit.x, Math.min(limit.x, target.x));
    target.y = Math.max(-limit.y, Math.min(limit.y, target.y));
    wake();
  }

  function apply() {
    letteringImage.style.transform = `translate(calc(-50% + ${current.x.toFixed(2)}px), calc(-50% + ${current.y.toFixed(2)}px))`;
  }

  function tick() {
    frame = 0;
    if (!active) return;
    current.x += (target.x - current.x) * EASE;
    current.y += (target.y - current.y) * EASE;
    apply();
    const settled = Math.abs(target.x - current.x) < 0.1 && Math.abs(target.y - current.y) < 0.1;
    if (settled) {
      current.x = target.x;
      current.y = target.y;
      apply();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (active && !frame) frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    const rect = hero.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    target.x = Math.max(-limit.x, Math.min(limit.x, x));
    target.y = Math.max(-limit.y, Math.min(limit.y, y));
    wake();
  }

  function onPointerLeave() {
    target.x = 0;
    target.y = 0;
    wake();
  }

  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerleave", onPointerLeave, { passive: true });
  /* A new SVG has a new aspect, so the free room changes with every pick. */
  letteringImage.addEventListener("load", measure);
  window.addEventListener("resize", measure, { passive: true });
  new ResizeObserver(measure).observe(hero);
  measure();

  return {
    /** Hidden tab: stop animating; back on the tab: resume from wherever we are. */
    setActive(on) {
      active = Boolean(on);
      wake();
    },
    /** Re-clamp after the hero box changes size (G-panel hero height). */
    measure,
  };
}

function setupHero() {
  if (REDUCE.matches || COARSE.matches) {
    hero.classList.add("is-static");
    return;
  }
  follower = createFollower();
}

/**
 * Desktop only (>760px): wire the pointer follower / tap-to-swap and fetch the
 * lettering deck. On mobile the hero block is the static scooter illustration —
 * nothing is wired and no hero SVG is ever requested. Runs at most once, either
 * at boot or the first time the frame widens past the breakpoint.
 */
async function startHero() {
  if (heroStarted || NARROW.matches || !catalogReady) return;
  heroStarted = true;
  setupHero();
  action.addEventListener("click", (event) => {
    playTickClick(event);
    nextHero();
  });
  const heroCandidates = catalog.filter(
    (item) => !item.hidden && item.type === TYPE_LETTERING && svgFile(item),
  );
  workshopWorks = await preloadHeroWorks(heroCandidates);
  if (workshopWorks.length) nextHero();
  else hero.classList.add("is-loaded");
}

/* ---------- fullscreen viewer (port of src/author-lightbox.js mechanics) ---------- */

const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
const MIN_Z = 1;
const MAX_Z = 4;
const ABSORB_MS = 400;
const DOTS_MAIN = 3;
const DOTS_VISIBLE = DOTS_MAIN + 4;
const DOT_SLOT = 16;
const DOT_SCALE = [1, 0.75, 0.5, 0.33];

function createViewer(root) {
  const track = root.querySelector("[data-viewer-track]");
  const pager = root.querySelector("[data-viewer-dots]");
  const caption = root.querySelector("[data-viewer-caption]");
  const CHROME = "[data-viewer-close], [data-viewer-dots], [data-viewer-dot]";
  const NAV = "[data-viewer-prev], [data-viewer-next]";
  const NO_ZOOM = `${CHROME}, ${NAV}`;
  const scrollRoot = document.querySelector("[data-scroll-root]");

  let items = [];
  let slides = [];
  let dots = [];
  let dotsTrack = null;
  let dotAnchor = 0;
  let dotLast = -1;
  let index = 0;
  let pending = 0;
  let shift = 0;
  let velocity = 0;
  let stopSpring = null;
  let open = false;
  let savedScroll = 0;
  let lastShot = null;
  let ignoreClickUntil = 0;
  let swipe = null;
  let gestureSamples = [];
  let z = 1;
  let panX = 0;
  let panY = 0;
  let gestureZ0 = 1;
  let zoomGen = 0;
  let gestureGen = -1;
  let absorbZoomUntil = 0;
  const pointers = new Map();
  let pinch = null;
  let pan = null;
  let lastTap = 0;
  let wheelPos = 0;
  let wheelVel = 0;
  let wheelLastAt = 0;
  let wheelLastPageAt = 0;
  let wheelRaf = 0;
  let wheelCoastAt = 0;
  let wheelTickAt = 0;

  const MEDIA_WINDOW = 2;
  const count = () => items.length;
  const wrap = (i) => {
    const n = count();
    if (n <= 0) return 0;
    return ((Math.trunc(i) % n) + n) % n;
  };
  const widthOf = () => track?.clientWidth || root.clientWidth || window.innerWidth || 1;

  /* Same wrap as the site slider — nearest copy, even-count tie break. */
  function wrapDelta(i, current, n, offset) {
    if (n <= 0) return 0;
    let d = i - current;
    d -= n * Math.round(d / n);
    if (n % 2 === 0 && Math.abs(d) === n / 2) d = offset > 0 ? -n / 2 : n / 2;
    return d;
  }

  function sampleVel(samples) {
    if (samples.length < 2) return 0;
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = b.t - a.t;
    if (dt < 8) return 0;
    return ((b.x - a.x) / dt) * 1000;
  }

  function shortestSteps(from, to) {
    let delta = to - from;
    const n = count();
    if (n <= 0) return 0;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    return delta;
  }

  function cancelNodeAnimations(node) {
    if (!node?.getAnimations) return;
    for (const anim of node.getAnimations({ subtree: true })) anim.cancel();
  }

  function ensureMedia(i) {
    const at = wrap(i);
    const slide = slides[at];
    const entry = items[at];
    if (!slide || !entry?.src) return null;
    let image = slide.querySelector("img");
    if (!image) {
      image = document.createElement("img");
      image.draggable = false;
      image.setAttribute("draggable", "false");
      image.decoding = "async";
      slide.append(image);
    }
    if (image.getAttribute("src") !== entry.src) {
      image.alt = entry.alt || "";
      image.src = entry.src;
    }
    return image;
  }

  function hydrateAround(active) {
    const current = wrap(active);
    const n = count();
    const keep = new Set();
    if (n > 0) {
      for (let delta = -MEDIA_WINDOW; delta <= MEDIA_WINDOW; delta += 1) {
        keep.add(wrap(current + delta));
      }
    }
    slides.forEach((slide, i) => {
      if (keep.has(i)) ensureMedia(i);
      else slide.replaceChildren();
    });
    return ensureMedia(current);
  }

  const activeMedia = () => ensureMedia(index);

  function syncSlides(active = index) {
    const current = wrap(active);
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
  }

  function settleSlideVisuals(active = index) {
    const current = wrap(active);
    cancelNodeAnimations(track);
    slides.forEach((slide, i) => {
      const on = i === current;
      slide.classList.toggle("is-active", on);
      slide.style.transition = "none";
      if (!isMobile()) {
        slide.style.opacity = on ? "1" : "0";
        slide.style.visibility = on ? "visible" : "hidden";
        slide.style.transform = "none";
        slide.style.zIndex = on ? "1" : "0";
      } else {
        slide.style.opacity = "";
        slide.style.visibility = "";
        slide.style.zIndex = "";
      }
    });
    const media = slides[current]?.querySelector("img");
    if (!media) return;
    cancelNodeAnimations(media);
    media.style.opacity = "1";
    media.style.visibility = "visible";
    if (z <= 1.001) media.style.transform = "none";
  }

  let captionFor = -1;

  /** Caption follows the highlighted slide (also mid-drag, together with the dots). */
  function syncCaption(current) {
    if (current === captionFor) return;
    captionFor = current;
    const nodes = items[current]?.caption?.() ?? [];
    caption.replaceChildren(...nodes);
    caption.hidden = nodes.length === 0;
  }

  function syncDots(active = index) {
    const current = wrap(active);
    hydrateAround(current);
    syncSlides(current);
    syncCaption(current);
    layoutDots(current);
  }

  function layoutDots(active) {
    const n = dots.length;
    if (!n || !dotsTrack) return;
    const main = Math.min(n, DOTS_MAIN);
    if (dotLast < 0) dotAnchor = Math.min(active, main - 1);
    else dotAnchor = Math.max(0, Math.min(main - 1, dotAnchor + (active - dotLast)));
    dotLast = active;
    const start = Math.max(0, Math.min(n - main, active - dotAnchor));
    const end = start + main - 1;
    dots.forEach((dot, i) => {
      const distance = i < start ? start - i : i > end ? i - end : 0;
      dot.style.setProperty("--dot-scale", String(DOT_SCALE[Math.min(distance, DOT_SCALE.length - 1)]));
      const on = i === active;
      dot.classList.toggle("is-active", on);
      dot.setAttribute("aria-current", on ? "true" : "false");
    });
    const visible = Math.min(n, DOTS_VISIBLE);
    const x = n > DOTS_VISIBLE ? ((visible - 1) / 2 - (start + end) / 2) * DOT_SLOT : 0;
    dotsTrack.style.setProperty("--dots-x", `${x}px`);
  }

  function paint(offset) {
    if (!isMobile()) return;
    const w = widthOf();
    const n = slides.length;
    slides.forEach((slide, i) => {
      const x = wrapDelta(i, index, n, offset) * w + offset;
      slide.style.transform = `translate3d(${x}px,0,0)`;
      slide.style.opacity = "";
    });
  }

  /* ---- zoom (pinch / double tap / ctrl+wheel / trackpad gesture) ---- */

  function applyZoom() {
    const media = activeMedia();
    if (!media) return;
    if (z <= 1.001 && Math.abs(panX) < 0.01 && Math.abs(panY) < 0.01) {
      media.style.transform = "";
      root.classList.remove("is-zoomed");
      return;
    }
    media.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${z})`;
    root.classList.toggle("is-zoomed", z > 1.001);
  }

  const zoomAbsorbed = () => performance.now() < absorbZoomUntil;

  function cancelZoomSession() {
    pointers.clear();
    pinch = null;
    pan = null;
    swipe = null;
    gestureZ0 = 1;
    gestureGen = -1;
    lastTap = 0;
    zoomGen += 1;
    absorbZoomUntil = performance.now() + ABSORB_MS;
  }

  function resetZoom() {
    z = 1;
    panX = 0;
    panY = 0;
    slides.forEach((slide) => {
      const media = slide.querySelector("img");
      if (media) media.style.transform = "";
    });
    root.classList.remove("is-zoomed");
  }

  const clampZ = (next) => Math.min(MAX_Z, Math.max(MIN_Z, next));

  function zoomAround(cx, cy, nextZ) {
    if (zoomAbsorbed()) return;
    const next = clampZ(nextZ);
    const media = activeMedia();
    if (!media || Math.abs(next - z) < 0.001) return;
    const box = media.parentElement?.getBoundingClientRect();
    if (!box) {
      z = next;
      if (z <= 1.001) resetZoom();
      else applyZoom();
      return;
    }
    const sx = cx - (box.left + box.width / 2);
    const sy = cy - (box.top + box.height / 2);
    const k = next / z;
    panX = sx - (sx - panX) * k;
    panY = sy - (sy - panY) * k;
    z = next;
    if (z <= 1.001) resetZoom();
    else applyZoom();
  }

  function toggleZoom(cx, cy) {
    if (zoomAbsorbed()) return;
    if (z > 1.001) resetZoom();
    else zoomAround(cx, cy, 2);
  }

  function pinchDist() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function pinchCenter() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return { x: 0, y: 0 };
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  /* ---- spring + index bookkeeping ---- */

  function cancelSpring() {
    if (!stopSpring) return;
    stopSpring();
    stopSpring = null;
  }

  function springTo(dest, vel, onDone) {
    cancelSpring();
    if (REDUCE.matches) {
      shift = dest;
      paint(shift);
      onDone();
      return;
    }
    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    const zeta = Math.abs(vel) > 800 ? 0.86 : 1;
    let x = shift;
    let v = vel;
    let last = performance.now();
    let raf = 0;
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const acc = -omega * omega * (x - dest) - 2 * zeta * omega * v;
      v += acc * dt;
      x += v * dt;
      shift = x;
      velocity = v;
      paint(shift);
      if (Math.abs(x - dest) < 0.5 && Math.abs(v) < 12) {
        shift = dest;
        velocity = 0;
        paint(shift);
        stopSpring = null;
        onDone();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    stopSpring = () => cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  function finishIndex(next) {
    const target = wrap(next);
    const changed = target !== index;
    if (changed) {
      cancelZoomSession();
      resetZoom();
    }
    index = target;
    pending = index;
    shift = 0;
    velocity = 0;
    hydrateAround(target);
    settleSlideVisuals(target);
    paint(0);
    syncDots();
  }

  /** Keep the painted offset when adopting `pending` as the live index. */
  function adoptPending() {
    if (pending === index) return;
    const steps = shortestSteps(index, pending);
    shift += steps * widthOf();
    index = pending;
    paint(shift);
  }

  function committedSteps(vel = 0) {
    const w = widthOf();
    if (Math.abs(shift) > w * COMMIT_RATIO) return shift < 0 ? 1 : -1;
    if (Math.abs(vel) > FLICK_VEL) return vel < 0 ? 1 : -1;
    return 0;
  }

  function settleShift(dest, vel, nextIndex) {
    pending = wrap(nextIndex);
    if (pending !== index) {
      cancelZoomSession();
      resetZoom();
    }
    syncDots(nextIndex);
    springTo(dest, vel, () => finishIndex(nextIndex));
  }

  function commitFromRelease(vel) {
    const steps = committedSteps(vel);
    settleShift(-steps * widthOf(), vel, index + steps);
  }

  function goTo(next, vel = 0) {
    if (!open || count() < 1) return;
    const target = wrap(next);
    pending = target;
    if (!isMobile()) {
      finishIndex(target);
      return;
    }
    const steps = shortestSteps(index, target);
    if (!steps && Math.abs(shift) < 0.5) {
      finishIndex(target);
      return;
    }
    settleShift(-steps * widthOf(), vel, target);
  }

  const go = (step) => goTo(pending + step);

  function snapPending() {
    cancelSpring();
    if (pending !== index) finishIndex(pending);
    else {
      shift = 0;
      velocity = 0;
      paint(0);
    }
  }

  const suppressClick = () => {
    ignoreClickUntil = performance.now() + 450;
  };

  /* ---- scroll pinning: the page under the viewer must not move ---- */

  function lockScroll() {
    pinPageScroll(savedScroll);
  }

  /* ---- build ---- */

  function buildSlides(start) {
    track.replaceChildren();
    slides = items.map((_, i) => {
      const slide = document.createElement("div");
      slide.className = "viewer__slide";
      if (i === start) slide.classList.add("is-active");
      track.append(slide);
      return slide;
    });
    hydrateAround(start);
  }

  function buildDots() {
    dotsTrack = document.createElement("div");
    dotsTrack.className = "viewer__dots-track";
    pager.replaceChildren(dotsTrack);
    pager.style.setProperty("--dots-visible", String(Math.min(items.length, DOTS_VISIBLE)));
    dotAnchor = 0;
    dotLast = -1;
    dots = items.map((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "viewer__dot";
      dot.setAttribute("data-viewer-dot", "");
      dot.setAttribute("aria-label", `${i + 1} / ${items.length}`);
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        playTickClick(event);
        goTo(i);
      });
      dotsTrack.append(dot);
      return dot;
    });
  }

  function setOpen(next) {
    open = next;
    document.documentElement.classList.toggle("is-viewer-open", next);
    root.hidden = !next;
    root.setAttribute("aria-hidden", next ? "false" : "true");
    if (next) {
      root.removeAttribute("inert");
      pageLenis?.stop();
    } else {
      root.setAttribute("inert", "");
      pageLenis?.start();
    }
  }

  function close() {
    if (!open) return;
    resetWheel();
    const top = savedScroll;
    const shot = lastShot;
    cancelSpring();
    cancelZoomSession();
    resetZoom();
    setOpen(false);
    root.classList.remove("is-dragging");
    root.querySelectorAll(".viewer__hit.is-aiming").forEach((hit) => hit.classList.remove("is-aiming"));
    const pin = () => {
      pinPageScroll(top);
    };
    pin();
    requestAnimationFrame(() => {
      pin();
      shot?.focus?.({ preventScroll: true });
      pin();
    });
  }

  /**
   * @param {{ src: string, alt?: string, caption?: () => Node[] }[]} list
   * @param {number} startIndex
   * @param {HTMLElement|null} shot — element that opened the viewer; focus returns to it.
   */
  function openSlides(list, startIndex = 0, shot = null) {
    items = Array.isArray(list) ? list.filter((entry) => entry?.src) : [];
    if (!items.length) return;
    const start = wrap(startIndex);
    lastShot = shot instanceof HTMLElement ? shot : null;
    savedScroll = pageLenis?.scroll ?? scrollRoot?.scrollTop ?? 0;
    captionFor = -1;
    buildSlides(start);
    buildDots();
    root.classList.toggle("is-single", items.length === 1);
    root.classList.toggle("is-mobile", isMobile());
    cancelSpring();
    pending = start;
    index = start;
    shift = 0;
    velocity = 0;
    setOpen(true);
    resetWheel();
    cancelZoomSession();
    resetZoom();
    finishIndex(start);
    lockScroll();
  }

  /* ---- chrome ---- */

  root.querySelector("[data-viewer-close]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playTickClick(event);
    close();
  });

  const bindHit = (sel, step) => {
    root.querySelector(sel)?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < ignoreClickUntil) return;
      playTickClick(event);
      go(step);
    });
  };
  bindHit("[data-viewer-prev]", -1);
  bindHit("[data-viewer-next]", 1);

  const aimHit = (hit, event) => {
    if (!FINE.matches) return;
    const arrow = hit.querySelector(".viewer__arrow");
    if (!arrow) return;
    arrow.style.left = `${event.clientX}px`;
    arrow.style.top = `${event.clientY}px`;
    hit.classList.add("is-aiming");
  };
  root.querySelectorAll(NAV).forEach((hit) => {
    hit.addEventListener("pointerenter", (event) => aimHit(hit, event));
    hit.addEventListener("pointermove", (event) => aimHit(hit, event));
    hit.addEventListener("pointerleave", () => hit.classList.remove("is-aiming"));
  });

  /* Middle third swallows the click — the site lightbox does not close on backdrop. */
  root.querySelector("[data-viewer-mid]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("dblclick", (event) => {
    if (!open) return;
    if (event.target.closest?.(NO_ZOOM)) return;
    if (zoomAbsorbed()) return;
    event.preventDefault();
    toggleZoom(event.clientX, event.clientY);
  });

  root.addEventListener("dragstart", (event) => event.preventDefault());

  /* ---- pointers: pinch, pan, swipe ---- */

  root.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.(CHROME)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        snapPending();
        swipe = null;
        pan = null;
        root.classList.remove("is-dragging");
        pinch = { dist: pinchDist(), z0: z, gen: zoomGen };
        return;
      }

      if (z > 1.001) {
        pan = { id: event.pointerId, x: event.clientX, y: event.clientY, px: panX, py: panY };
        return;
      }

      if (!isMobile()) return;
      if (event.pointerType === "mouse" && !COARSE.matches) return;

      cancelSpring();
      adoptPending();
      gestureSamples = [{ x: shift, t: event.timeStamp || performance.now() }];
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: shift, axis: null };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!open) return;
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pinch && pointers.size >= 2) {
        if (pinch.gen !== zoomGen || zoomAbsorbed()) return;
        const dist = pinchDist();
        const mid = pinchCenter();
        if (pinch.dist > 8 && dist > 0) {
          if (event.cancelable) event.preventDefault();
          zoomAround(mid.x, mid.y, pinch.z0 * (dist / pinch.dist));
        }
        return;
      }

      if (pan && event.pointerId === pan.id) {
        if (zoomAbsorbed()) return;
        if (event.cancelable) event.preventDefault();
        panX = pan.px + (event.clientX - pan.x);
        panY = pan.py + (event.clientY - pan.y);
        applyZoom();
        return;
      }

      if (!swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (!swipe.axis) {
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < TAP_PX) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.05) {
          swipe.axis = "x";
          suppressClick();
          root.classList.add("is-dragging");
        } else {
          swipe.axis = "y";
        }
      }
      if (swipe.axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      shift = swipe.origin + dx;
      velocity = 0;
      gestureSamples.push({ x: shift, t: event.timeStamp || performance.now() });
      if (gestureSamples.length > 5) gestureSamples.shift();
      if (gestureSamples.length >= 2) velocity = sampleVel(gestureSamples);
      paint(shift);
      syncDots(index + committedSteps(0));
    },
    { passive: false },
  );

  const endPointer = (event, cancelled) => {
    const hadPinch = Boolean(pinch);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;

    if (pan && event.pointerId === pan.id) {
      const moved = Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > TAP_PX;
      pan = null;
      if (moved) suppressClick();
    }

    if (hadPinch) {
      suppressClick();
      swipe = null;
      root.classList.remove("is-dragging");
      return;
    }

    if (z <= 1.001 && event.pointerType === "touch") {
      const now = performance.now();
      const dx = swipe ? event.clientX - swipe.x : 0;
      const dy = swipe ? event.clientY - swipe.y : 0;
      const onNav = Boolean(event.target?.closest?.(NO_ZOOM));
      if (!cancelled && !onNav && !zoomAbsorbed() && Math.hypot(dx, dy) < TAP_PX) {
        if (now - lastTap < 280) {
          toggleZoom(event.clientX, event.clientY);
          lastTap = 0;
          suppressClick();
        } else {
          lastTap = now;
        }
      } else if (onNav || zoomAbsorbed()) {
        lastTap = 0;
      }
    }

    if (!swipe || event.pointerId !== swipe.id) return;
    const axis = swipe.axis;
    const startY = swipe.y;
    swipe = null;
    root.classList.remove("is-dragging");
    if (axis !== "x") {
      if (axis === "y" && count() > 1 && z <= 1.001) {
        const dy = event.clientY - startY;
        if (Math.abs(dy) > 56) {
          playUISound("tick");
          go(dy > 0 ? -1 : 1);
        }
      }
      if (Math.abs(shift) > 0.5) settleShift(0, 0, index);
      return;
    }
    suppressClick();
    if (cancelled || z > 1.001) {
      settleShift(0, 0, index);
      return;
    }
    commitFromRelease(sampleVel(gestureSamples) || velocity);
  };
  window.addEventListener("pointerup", (event) => endPointer(event, false));
  window.addEventListener("pointercancel", (event) => endPointer(event, true));

  root.addEventListener(
    "touchmove",
    (event) => {
      if (!open) return;
      if (pinch || pan || swipe?.axis === "x") {
        if (event.cancelable) event.preventDefault();
      }
    },
    { passive: false },
  );

  const WHEEL_STEP = 48;
  /* Min time between successive pages — 127ms / 3. Leftover motion is kept, not locked out. */
  const WHEEL_PAGE_MS = 42;
  const WHEEL_COAST_IDLE = 24;
  const WHEEL_FRICTION = 0.0046;
  const WHEEL_MIN_VEL = 0.035;
  const WHEEL_MAX_VEL = 10;
  const WHEEL_MAX_QUEUE = WHEEL_STEP * 10;
  const WHEEL_NOTCH_GAP = 80;
  const WHEEL_TICK_MS = 42;

  function resetWheel() {
    wheelPos = 0;
    wheelVel = 0;
    wheelLastAt = 0;
    wheelLastPageAt = 0;
    wheelCoastAt = 0;
    if (wheelRaf) {
      cancelAnimationFrame(wheelRaf);
      wheelRaf = 0;
    }
  }

  function tickWheelPage() {
    const now = performance.now();
    if (now - wheelTickAt < WHEEL_TICK_MS) return;
    wheelTickAt = now;
    playUISound("tick");
  }

  function pageFromWheel(dir) {
    tickWheelPage();
    go(dir);
  }

  function consumeWheelPages(now) {
    if (!open || count() < 2) return;
    if (Math.abs(wheelPos) < WHEEL_STEP) return;
    if (now - wheelLastPageAt < WHEEL_PAGE_MS) return;
    const dir = wheelPos > 0 ? 1 : -1;
    wheelPos -= dir * WHEEL_STEP;
    wheelLastPageAt = now;
    pageFromWheel(dir);
  }

  function coastWheel(now) {
    if (!open) {
      resetWheel();
      return;
    }
    const prev = wheelCoastAt || now;
    const dt = Math.min(32, now - prev);
    wheelCoastAt = now;
    const idle = now - wheelLastAt;
    if (idle > WHEEL_COAST_IDLE && Math.abs(wheelVel) > WHEEL_MIN_VEL) {
      wheelPos += wheelVel * dt;
      wheelPos = Math.max(-WHEEL_MAX_QUEUE, Math.min(WHEEL_MAX_QUEUE, wheelPos));
      wheelVel *= Math.exp(-WHEEL_FRICTION * dt);
      if (Math.abs(wheelVel) < WHEEL_MIN_VEL) wheelVel = 0;
    }
    consumeWheelPages(now);
    if (Math.abs(wheelVel) > WHEEL_MIN_VEL || Math.abs(wheelPos) >= WHEEL_STEP) {
      wheelRaf = requestAnimationFrame(coastWheel);
      return;
    }
    wheelRaf = 0;
    wheelVel = 0;
  }

  function startWheelCoast() {
    if (wheelRaf) return;
    wheelCoastAt = performance.now();
    wheelRaf = requestAnimationFrame(coastWheel);
  }

  /**
   * Wheel / trackpad is a velocity stream, like native or Lenis scroll.
   * Deltas accumulate into virtual position; leftover velocity coasts with
   * friction and keeps paging until it decays. Discrete mouse notches still
   * advance one slide. preventDefault keeps Lenis and the page pinned.
   */
  function onViewerWheel(event) {
    if (!open) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    lockScroll();
    if (event.ctrlKey || event.metaKey) {
      if (zoomAbsorbed() || gestureGen === zoomGen) return;
      const factor = Math.exp(-event.deltaY * 0.012);
      zoomAround(event.clientX, event.clientY, z * factor);
      return;
    }
    if (z > 1.001 || count() < 2) return;
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= 16;
    if (event.deltaMode === 2) dy *= window.innerHeight || 800;
    const now = performance.now();
    const gap = wheelLastAt ? now - wheelLastAt : 16;
    const dt = Math.max(8, Math.min(48, gap));
    const abs = Math.abs(dy);
    wheelLastAt = now;

    const notch = event.deltaMode !== 0 || (abs >= 80 && gap > WHEEL_NOTCH_GAP);
    if (notch) {
      wheelPos = 0;
      wheelVel = 0;
      if (now - wheelLastPageAt >= WHEEL_PAGE_MS) {
        wheelLastPageAt = now;
        pageFromWheel(dy > 0 ? 1 : -1);
      }
      return;
    }

    wheelPos += dy;
    wheelPos = Math.max(-WHEEL_MAX_QUEUE, Math.min(WHEEL_MAX_QUEUE, wheelPos));
    const instant = dy / dt;
    wheelVel = Math.max(-WHEEL_MAX_VEL, Math.min(WHEEL_MAX_VEL, wheelVel * 0.35 + instant * 0.65));
    consumeWheelPages(now);
    startWheelCoast();
  }

  document.addEventListener("wheel", onViewerWheel, { capture: true, passive: false });

  /* Safari trackpad pinch. */
  root.addEventListener(
    "gesturestart",
    (event) => {
      if (!open) return;
      event.preventDefault();
      if (zoomAbsorbed()) return;
      gestureGen = zoomGen;
      gestureZ0 = z;
    },
    { passive: false },
  );
  root.addEventListener(
    "gesturechange",
    (event) => {
      if (!open) return;
      event.preventDefault();
      if (zoomAbsorbed() || gestureGen !== zoomGen) return;
      zoomAround(event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2, gestureZ0 * event.scale);
    },
    { passive: false },
  );
  root.addEventListener(
    "gestureend",
    (event) => {
      if (!open) return;
      event.preventDefault();
      gestureGen = -1;
    },
    { passive: false },
  );

  document.addEventListener(
    "scroll",
    () => {
      if (open) lockScroll();
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "j" || event.key === "J") {
        event.preventDefault();
        event.stopImmediatePropagation();
        go(-1);
        return;
      }
      if (event.key === "ArrowRight" || event.key === "k" || event.key === "K") {
        event.preventDefault();
        event.stopImmediatePropagation();
        go(1);
      }
    },
    true,
  );

  new ResizeObserver(() => {
    if (!slides.length) return;
    root.classList.toggle("is-mobile", isMobile());
    if (!isMobile()) settleSlideVisuals(index);
    paint(shift);
  }).observe(root);

  return {
    open: openSlides,
    close,
    get isOpen() {
      return open;
    },
  };
}

function pinPageScroll(top) {
  if (pageLenis) {
    pageLenis.scrollTo(top, { immediate: true });
    return;
  }
  const root = document.querySelector("[data-scroll-root]");
  if (root) root.scrollTop = top;
}

/** The sticky row floats over the grid: its measured height feeds the negative margin. */
function syncIslandSticky() {
  const bar = document.querySelector("[data-filter-bar]");
  if (!bar) return;
  const height = bar.getBoundingClientRect().height;
  if (!(height > 0)) return;
  (bar.closest(".works-page") || bar.parentElement).style.setProperty("--island-h", `${height}px`);
}

function initSmoothScroll() {
  const wrapper = document.querySelector("[data-scroll-root]");
  const content = document.querySelector("[data-scroll-content]");
  if (!wrapper || !content || REDUCE.matches || pageLenis) return;
  pageLenis = new Lenis({
    wrapper,
    content,
    eventsTarget: wrapper,
    orientation: "vertical",
    gestureOrientation: "vertical",
    smoothWheel: true,
    overscroll: false,
    autoRaf: false,
  });
  const tick = (time) => {
    pageLenis?.raf(time);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- boot ---------- */

async function boot() {
  initEmbed();
  setupLanguage();
  initSmoothScroll();
  /* Hero height and track count before the catalog arrives, so the first paint does not jump. */
  layout = readStoredLayout() ?? catalogLayout;
  page?.style.setProperty("--hero-vh", String(activeHeroVh()));
  grid.style.setProperty("--grid-columns", String(activeColumns()));
  setupGridGeometry();
  setupFilters();
  document.querySelectorAll("[data-enroll]").forEach((link) => {
    link.addEventListener("click", (event) => playTickClick(event));
  });
  syncIslandSticky();
  new ResizeObserver(syncIslandSticky).observe(document.querySelector("[data-filter-bar]") || grid);
  viewer = createViewer(document.querySelector("[data-viewer]"));
  setupGridSettings();

  grid.replaceChildren();
  grid.setAttribute("aria-busy", "true");
  empty.hidden = true;

  let data;
  try {
    data = await loadWorksCatalog({ bust: true });
  } catch (error) {
    console.warn("Experiment 2 catalog unavailable", error);
    data = { items: [] };
  }
  catalog = shuffled(data.items || []);
  catalogLayout = normalizeExperiment2Layout(data.layout);
  catalogReady = true;
  grid.removeAttribute("aria-busy");
  /* Desktop: the hero request goes out before the grid's so it wins the network queue.
     Mobile: no-op — the grid is the only thing that loads. */
  const heroReady = startHero();
  applyLayout(readStoredLayout() ?? catalogLayout);
  await heroReady;
  document.fonts.ready.then(() => scheduleCardMeasure()).catch(() => {});
  document.fonts.addEventListener("loadingdone", () => scheduleCardMeasure());
  document.fonts.addEventListener("loadingerror", () => scheduleCardMeasure());
}

boot();
