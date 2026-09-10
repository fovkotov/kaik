import { initEmbed, safeStorage } from "./embed.js";
import { playUISound } from "./lib/ui-sounds.js";
import { planExperiment2 } from "./experiment-2-planner.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";
import {
  TYPE_DAILY,
  TYPE_FINAL,
  TYPE_FONT,
  TYPE_LETTERING,
  normalizeExperiment2Layout,
} from "./works/taxonomy.js";

const VISUAL_TYPES = [TYPE_DAILY, TYPE_LETTERING, TYPE_FINAL, TYPE_FONT];
const FONT_RE = /\.(?:ttf|otf|woff2?)$/i;
const FONT_TESTER_MAX_CHARS = 60;

const hero = document.querySelector("[data-lettering-hero]");
const letteringImage = document.querySelector("[data-lettering-image]");
const action = document.querySelector("[data-lettering-action]");
const credit = document.querySelector("[data-lettering-credit]");
const grid = document.querySelector("[data-works-grid]");
const empty = document.querySelector("[data-works-empty]");
const filters = [...document.querySelectorAll("[data-filter]")];
const settingsPanel = document.querySelector("[data-grid-settings]");
const storage = safeStorage();
const SETTINGS_KEY = "kaik:experiment-2:grid";

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

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
let cardGeometryObserver = null;
let cardMeasureFrame = 0;

/* ---------- helpers ---------- */

function isMobile() {
  return COARSE.matches || window.innerWidth <= 760;
}

function imageFiles(item) {
  return (item?.files || []).filter((file) => !FONT_RE.test(file));
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

/** Name, @nick and stream as spans; muted parts get `.is-muted`. */
function metaNodes(item) {
  const nodes = [];
  if (item.author) {
    const name = document.createElement("span");
    name.textContent = item.author;
    nodes.push(name);
  }
  if (item.nick) {
    const nick = document.createElement("span");
    nick.className = "is-muted";
    nick.textContent = `@${item.nick}`;
    nodes.push(nick);
  }
  if (item.stream) {
    const stream = document.createElement("span");
    stream.className = "is-muted";
    stream.textContent = `${item.stream} поток`;
    nodes.push(stream);
  }
  if (!nodes.length) {
    const anon = document.createElement("span");
    anon.className = "is-muted";
    anon.textContent = "автор не указан";
    nodes.push(anon);
  }
  return nodes;
}

function altFor(item) {
  const kind =
    item.type === TYPE_FINAL
      ? "Финальный проект"
      : item.type === TYPE_DAILY
        ? "Daily Practice"
        : item.type === TYPE_FONT
          ? "Шрифт"
        : "Работа воркшопа";
  return item.author ? `${kind}, ${item.author}` : kind;
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
  grid.style.setProperty("--grid-columns", String(layout.columns));
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
  if (persist) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(layout));
    } catch {
      // safeStorage normally absorbs this; storage can still disappear mid-session.
    }
  }
  measureGridGeometry();
  syncSettingsPanel();
  renderGrid();
}

function syncSettingsPanel() {
  if (!settingsPanel) return;
  for (const name of ["columns", "cellRatio", "gapX", "gapY"]) {
    const input = settingsPanel.querySelector(`[name="${name}"]`);
    if (input && document.activeElement !== input) input.value = String(Number(layout[name].toFixed?.(3) ?? layout[name]));
  }
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

function fitFontSpecimen(specimen) {
  specimen.style.removeProperty("--font-fit");
  if (!specimen.clientWidth || !specimen.firstChild) return;
  const range = document.createRange();
  range.selectNodeContents(specimen);
  const needed = range.getBoundingClientRect().width;
  if (needed > specimen.clientWidth) {
    specimen.style.setProperty("--font-fit", String(Math.max(0.12, (specimen.clientWidth / needed) * 0.96)));
  }
}

function bindFontSpecimen(specimen, fallback) {
  const settle = () => {
    const next = plainSpecimenText(specimen.textContent);
    if (next !== specimen.textContent) specimen.textContent = next;
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
    document.execCommand("insertText", false, plainSpecimenText(event.clipboardData?.getData("text/plain")));
    settle();
  });
  specimen.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      specimen.blur();
    }
    event.stopPropagation();
  });
  new ResizeObserver(() => fitFontSpecimen(specimen)).observe(specimen);
}

async function hydrateFontSpecimen(specimen, item, file) {
  const fallback = item.sample || "Käik";
  const family = `exp2-${String(item.id).replace(/[^a-z0-9]/gi, "") || "font"}`;
  specimen.textContent = fallback;
  bindFontSpecimen(specimen, fallback);
  try {
    const face = new FontFace(family, `url(${JSON.stringify(workFileUrl(file))})`);
    document.fonts.add(await face.load());
    specimen.style.fontFamily = `"${family}", sans-serif`;
  } catch {
    specimen.classList.add("is-font-error");
  }
  fitFontSpecimen(specimen);
  requestAnimationFrame(() => {
    const card = specimen.closest(".work-card");
    setCardRowSpan(card, card?.getBoundingClientRect().height);
  });
}

function setArtworkDimensions(card, preview, width, height) {
  const intrinsicWidth = Number(width);
  const intrinsicHeight = Number(height);
  if (!(intrinsicWidth > 0 && intrinsicHeight > 0)) return false;
  card.dataset.artWidth = String(intrinsicWidth);
  card.dataset.artHeight = String(intrinsicHeight);
  preview.style.aspectRatio = `${intrinsicWidth} / ${intrinsicHeight}`;
  return true;
}

function setCardRowSpan(card, neededCardHeight) {
  const rowHeight = Number.parseFloat(grid.style.getPropertyValue("--grid-row-h"));
  if (!(neededCardHeight > 0 && rowHeight > 0)) return;
  const rowPitch = rowHeight + layout.gapY;
  const rowSpan = Math.max(1, Math.ceil((neededCardHeight + layout.gapY) / rowPitch - 0.001));
  if (card.dataset.rowSpan === String(rowSpan)) return;
  card.dataset.rowSpan = String(rowSpan);
  card.style.setProperty("--card-row-span", String(rowSpan));
}

function measureArtworkCard(card) {
  if (!card?.querySelector(".work-card__preview")) return;
  const intrinsicWidth = Number(card.dataset.artWidth);
  const intrinsicHeight = Number(card.dataset.artHeight);
  const cardWidth = card.getBoundingClientRect().width;
  if (!(intrinsicWidth > 0 && intrinsicHeight > 0 && cardWidth > 0)) return;

  const meta = card.querySelector(".work-card__meta");
  const metaHeight = meta?.getBoundingClientRect().height || 0;
  const cardGap = Number.parseFloat(getComputedStyle(card).rowGap) || 0;
  const neededArtHeight = cardWidth * intrinsicHeight / intrinsicWidth;
  const neededCardHeight = neededArtHeight + cardGap + metaHeight;
  setCardRowSpan(card, neededCardHeight);
}

function measureCardRows() {
  grid.querySelectorAll(".work-card").forEach((card) => {
    if (card.querySelector(".work-card__preview")) {
      measureArtworkCard(card);
      return;
    }
    // Font specimens retain their configured one-cell art height; their grid
    // occupancy still grows enough to contain that art and its caption.
    setCardRowSpan(card, card.getBoundingClientRect().height);
  });
}

function observeCardGeometry() {
  cardGeometryObserver?.disconnect();
  cardGeometryObserver = new ResizeObserver((entries) => {
    const cards = new Set(
      entries.map((entry) => entry.target.closest(".work-card")).filter(Boolean),
    );
    cancelAnimationFrame(cardMeasureFrame);
    cardMeasureFrame = requestAnimationFrame(() => {
      cards.forEach((card) => {
        if (card.querySelector(".work-card__preview")) measureArtworkCard(card);
        else setCardRowSpan(card, card.getBoundingClientRect().height);
      });
    });
  });
  grid.querySelectorAll(".work-card").forEach((card) => {
    cardGeometryObserver.observe(card);
    card.querySelectorAll(".work-card__preview, .work-card__meta, .work-card__font-specimen")
      .forEach((node) => cardGeometryObserver.observe(node));
  });
}

function cardFor(item, span) {
  if (item.type === TYPE_FONT) return fontCardFor(item, span);
  const cover = imageFiles(item)[0];
  const card = document.createElement("button");
  card.type = "button";
  card.className = "work-card";
  card.dataset.workId = item.id;
  card.dataset.type = item.type;
  card.dataset.span = String(span);
  card.style.setProperty("--card-span", String(span));

  const art = document.createElement("span");
  art.className = "work-card__art";
  const preview = document.createElement("span");
  preview.className = "work-card__preview";
  const hasCatalogDimensions =
    item.type === TYPE_FINAL
      ? setArtworkDimensions(card, preview, 16, 9)
      : setArtworkDimensions(card, preview, item.width, item.height);
  const image = document.createElement("img");
  image.alt = altFor(item);
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  revealOnLoad(image, preview);
  if (!hasCatalogDimensions) {
    const useNaturalDimensions = () => {
      if (!setArtworkDimensions(card, preview, image.naturalWidth, image.naturalHeight)) return;
      requestAnimationFrame(() => measureArtworkCard(card));
    };
    image.addEventListener("load", useNaturalDimensions, { once: true });
    if (image.complete && image.naturalWidth) queueMicrotask(useNaturalDimensions);
  }
  image.src = workFileUrl(cover);
  preview.append(image);
  art.append(preview);

  const meta = document.createElement("span");
  meta.className = "work-card__meta";
  meta.append(...metaNodes(item));

  card.append(art, meta);
  card.addEventListener("click", () => openViewerFor(item, card));
  return card;
}

function fontCardFor(item, span) {
  const file = fontFile(item);
  const card = document.createElement("article");
  card.className = "work-card work-card--font";
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
  specimen.setAttribute("aria-label", "Введите свой текст для проверки шрифта");
  art.append(specimen);

  const meta = document.createElement("div");
  meta.className = "work-card__meta";
  meta.append(...metaNodes(item));
  card.append(art, meta);
  hydrateFontSpecimen(specimen, item, file);
  return card;
}

function visibleWorks() {
  return catalog.filter(
    (item) =>
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
function openViewerFor(item, card) {
  if (!viewer) return;
  playUISound("tap");
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
    renderSkeletons();
    return;
  }
  const works = visibleWorks();
  const planned = planExperiment2(works, layout);
  const fragment = document.createDocumentFragment();
  planned.forEach(({ item, span }) => fragment.append(cardFor(item, span)));
  grid.replaceChildren(fragment);
  measureCardRows();
  observeCardGeometry();
  empty.hidden = works.length > 0;
}

/* ---------- skeletons ---------- */

const SKELETON_CARDS = 18;

/** Shimmer plates in the exact card geometry so the real grid drops in without a shift. */
function renderSkeletons() {
  const fragment = document.createDocumentFragment();
  const placeholders = Array.from({ length: SKELETON_CARDS }, (_, index) => ({
    id: `skeleton-${index}`,
    type:
      index === 4 || index === 11
        ? TYPE_FINAL
        : index === 2 || index === 9
          ? TYPE_DAILY
          : TYPE_LETTERING,
  }));
  for (const { item, span } of planExperiment2(placeholders, layout)) {
    const card = document.createElement("div");
    card.className = "work-card is-skeleton";
    card.dataset.type = item.type;
    card.dataset.span = String(span);
    card.style.setProperty("--card-span", String(span));
    card.setAttribute("aria-hidden", "true");
    const art = document.createElement("span");
    art.className = "work-card__art";
    const preview = document.createElement("span");
    preview.className = "work-card__preview skeleton";
    if (item.type === TYPE_FINAL) setArtworkDimensions(card, preview, 16, 9);
    art.append(preview);
    const meta = document.createElement("span");
    meta.className = "work-card__meta";
    const lineA = document.createElement("span");
    lineA.className = "skeleton skeleton-line";
    const lineB = document.createElement("span");
    lineB.className = "skeleton skeleton-line skeleton-line--short";
    meta.append(lineA, lineB);
    card.append(art, meta);
    fragment.append(card);
  }
  grid.replaceChildren(fragment);
  measureCardRows();
  observeCardGeometry();
  grid.setAttribute("aria-busy", "true");
  empty.hidden = true;
}

function setupGridGeometry() {
  measureGridGeometry = () => {
    const gaps = Math.max(0, layout.columns - 1) * layout.gapX;
    const track = Math.max(1, (grid.clientWidth - gaps) / layout.columns);
    grid.style.setProperty("--grid-row-h", `${track / layout.cellRatio}px`);
    measureCardRows();
  };
  new ResizeObserver(measureGridGeometry).observe(grid);
  measureGridGeometry();
}

function setupFilters() {
  filters.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.filter;
      if (!VISUAL_TYPES.includes(type)) return;
      if (enabledTypes.has(type)) enabledTypes.delete(type);
      else enabledTypes.add(type);
      button.setAttribute("aria-checked", enabledTypes.has(type) ? "true" : "false");
      renderGrid();
    });
  });
}

/** Fade the image in once it has pixels; until then the frame keeps its skeleton plate. */
function revealOnLoad(image, frame) {
  const done = () => frame.classList.add("is-loaded");
  image.addEventListener("load", done, { once: true });
  image.addEventListener("error", done, { once: true });
  if (image.complete && image.naturalWidth) done();
}

/* ---------- hero ---------- */

/**
 * Start every workshop request together and wait before revealing the first
 * one. Once the hero is interactive, every queued URL is already in the
 * browser image cache instead of making the user's tap wait on the network.
 */
async function preloadHeroWorks(items) {
  const loaded = await Promise.all(
    items.map(
      (item) =>
        new Promise((resolve) => {
          const image = new Image();
          const done = (ok) => resolve(ok ? item : null);
          image.decoding = "async";
          image.addEventListener("load", () => done(true), { once: true });
          image.addEventListener("error", () => done(false), { once: true });
          image.src = workFileUrl(svgFile(item));
          if (image.complete) done(image.naturalWidth > 0);
        }),
    ),
  );
  return loaded.filter(Boolean);
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
  credit.replaceChildren(...metaNodes(item));

  /* Skeleton/fade belongs only to startup. Ignore superseded load events. */
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
  };
}

function setupHero() {
  if (REDUCE.matches || COARSE.matches) {
    hero.classList.add("is-static");
    return;
  }
  follower = createFollower();
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
  let wheelAcc = 0;
  let wheelLockUntil = 0;
  let wheelResetTimer = 0;

  const count = () => items.length || 1;
  const wrap = (i) => ((i % count()) + count()) % count();
  const widthOf = () => track?.clientWidth || root.clientWidth || window.innerWidth || 1;

  /* Same wrap as the site slider — nearest copy, even-count tie break. */
  function wrapDelta(i, current, n, offset) {
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
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    return delta;
  }

  function preload(i) {
    const src = items[wrap(i)]?.src;
    if (!src) return;
    const warm = new Image();
    warm.decoding = "async";
    warm.src = src;
  }

  const activeMedia = () => slides[index]?.querySelector("img") ?? null;

  function syncSlides(active = index) {
    const current = wrap(active);
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
  }

  let captionFor = -1;

  /** Caption follows the highlighted slide (also mid-drag, together with the dots). */
  function syncCaption(current) {
    if (current === captionFor) return;
    captionFor = current;
    const nodes = items[current]?.caption?.() ?? [];
    caption.replaceChildren(...nodes);
  }

  function syncDots(active = index) {
    const current = wrap(active);
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
    if (!isMobile()) {
      slides.forEach((slide) => {
        slide.style.transform = "translate3d(0,0,0)";
      });
      return;
    }
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
    index = target;
    pending = index;
    shift = 0;
    velocity = 0;
    slides.forEach((slide, i) => {
      slide.style.transition = "none";
      if (!isMobile()) {
        slide.style.opacity = i === index ? "1" : "0";
        slide.style.zIndex = i === index ? "1" : "0";
      } else {
        slide.style.opacity = "";
        slide.style.zIndex = "";
      }
    });
    if (changed) {
      cancelZoomSession();
      resetZoom();
    }
    paint(0);
    syncDots();
    preload(index + 1);
    preload(index - 1);
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
    if (!open) return;
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
    if (scrollRoot && scrollRoot.scrollTop !== savedScroll) scrollRoot.scrollTop = savedScroll;
  }

  /* ---- build ---- */

  function buildSlides(start) {
    track.replaceChildren();
    slides = items.map((entry, i) => {
      const slide = document.createElement("div");
      slide.className = "viewer__slide";
      if (i === start) slide.classList.add("is-active");
      const image = document.createElement("img");
      image.alt = entry.alt || "";
      image.draggable = false;
      image.setAttribute("draggable", "false");
      image.decoding = "async";
      image.src = entry.src;
      slide.append(image);
      track.append(slide);
      return slide;
    });
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
        playUISound("click");
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
    if (next) root.removeAttribute("inert");
    else root.setAttribute("inert", "");
  }

  function close() {
    if (!open) return;
    wheelAcc = 0;
    wheelLockUntil = 0;
    window.clearTimeout(wheelResetTimer);
    const top = savedScroll;
    const shot = lastShot;
    cancelSpring();
    cancelZoomSession();
    resetZoom();
    setOpen(false);
    root.classList.remove("is-dragging");
    root.querySelectorAll(".viewer__hit.is-aiming").forEach((hit) => hit.classList.remove("is-aiming"));
    const pin = () => {
      if (scrollRoot) scrollRoot.scrollTop = top;
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
    savedScroll = scrollRoot?.scrollTop ?? 0;
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
    wheelAcc = 0;
    wheelLockUntil = 0;
    window.clearTimeout(wheelResetTimer);
    cancelZoomSession();
    resetZoom();
    finishIndex(start);
    lockScroll();
  }

  /* ---- chrome ---- */

  root.querySelector("[data-viewer-close]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUISound("click");
    close();
  });

  const bindHit = (sel, step) => {
    root.querySelector(sel)?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < ignoreClickUntil) return;
      playUISound("click");
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
  const WHEEL_LOCK = 380;

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
    if (now < wheelLockUntil) return;
    wheelAcc += dy;
    window.clearTimeout(wheelResetTimer);
    wheelResetTimer = window.setTimeout(() => {
      wheelAcc = 0;
    }, 160);
    if (Math.abs(wheelAcc) < WHEEL_STEP) return;
    const step = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    wheelLockUntil = now + WHEEL_LOCK;
    playUISound("tick");
    go(step);
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

/* ---------- boot ---------- */

async function boot() {
  initEmbed();
  setupHero();
  setupGridGeometry();
  setupFilters();
  viewer = createViewer(document.querySelector("[data-viewer]"));
  setupGridSettings();

  action.addEventListener("click", nextHero);

  /* Skeleton hero + grid while the catalog and hero image cache are in flight. */
  renderSkeletons();

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
  const heroCandidates = catalog.filter((item) => item.type === TYPE_LETTERING && svgFile(item));
  applyLayout(readStoredLayout() ?? catalogLayout);
  workshopWorks = await preloadHeroWorks(heroCandidates);
  if (workshopWorks.length) nextHero();
  else hero.classList.add("is-loaded");
}

boot();
