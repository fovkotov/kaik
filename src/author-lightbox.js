import { focusScrollRoot } from "./focus-scrollbar.js";
import { publicUrl } from "./public-url.js";
import { t } from "./scriptik.js";
import { isMobile } from "./tweaks.js";

/** Full works, same order as the author collage (aspect-matched to each tile). */
export const AUTHOR_WORKS = [
  { src: publicUrl("assets/author/works/la-noche.webp"), width: 1920, height: 757 },
  { src: publicUrl("assets/author/works/el-invierno.webp"), width: 1920, height: 651 },
  { src: publicUrl("assets/author/works/euphoria.webp"), width: 1920, height: 740 },
  { src: publicUrl("assets/author/works/blue-script.webp"), width: 1920, height: 670 },
  { src: publicUrl("assets/author/works/mushrooms.webp"), width: 1920, height: 498 },
  { src: publicUrl("assets/author/works/buckle.webp"), width: 1920, height: 1436 },
  { src: publicUrl("assets/author/works/chrome.webp"), width: 1920, height: 1438 },
  { src: publicUrl("assets/author/works/wild-east.webp"), width: 1920, height: 1920 },
  { src: publicUrl("assets/author/works/grillz.webp"), width: 1920, height: 1920 },
  { src: publicUrl("assets/author/works/purple.webp"), width: 1920, height: 777 },
  { src: publicUrl("assets/author/works/mark.webp"), width: 1920, height: 2560 },
  { src: publicUrl("assets/author/works/teur.webp"), width: 1920, height: 558 },
];

const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const COARSE = window.matchMedia("(pointer: coarse)");
const AXIS_PX = 8;
const COMMIT_RATIO = 0.22;

let root = null;
let img = null;
let cursor = null;
let pager = null;
let dots = [];
let index = 0;
let open = false;
let savedScroll = 0;
let savedCard = null;
let lastShot = null;
let ignoreClickUntil = 0;
let swipe = null;

export function isAuthorLightboxOpen() {
  return open;
}

function wrap(i) {
  const n = AUTHOR_WORKS.length;
  return ((i % n) + n) % n;
}

function authorCard() {
  return document.querySelector(".author-card")?.closest("[data-card]") ?? null;
}

function cardOpen(card = authorCard()) {
  return Boolean(card?.classList.contains("is-program-open"));
}

function preload(i) {
  const work = AUTHOR_WORKS[wrap(i)];
  if (!work) return;
  const warm = new Image();
  warm.decoding = "async";
  warm.src = work.src;
}

function syncDots() {
  dots.forEach((dot, i) => {
    const on = i === index;
    dot.classList.toggle("is-active", on);
    dot.setAttribute("aria-current", on ? "true" : "false");
  });
}

function paint() {
  const work = AUTHOR_WORKS[index];
  if (!img || !work) return;
  img.src = work.src;
  img.width = work.width;
  img.height = work.height;
  img.alt = "";
  syncDots();
  preload(index + 1);
  preload(index - 1);
}

function go(step) {
  if (!open) return;
  index = wrap(index + step);
  paint();
}

function goTo(i) {
  if (!open) return;
  index = wrap(i);
  paint();
}

function lockScroll() {
  if (!savedCard) return;
  const scroller = focusScrollRoot(savedCard);
  if (scroller.scrollTop !== savedScroll) scroller.scrollTop = savedScroll;
}

function setOpen(next) {
  open = next;
  document.documentElement.classList.toggle("is-author-lb-open", next);
  if (!root) return;
  root.hidden = !next;
  root.setAttribute("aria-hidden", next ? "false" : "true");
  if (next) root.removeAttribute("inert");
  else root.setAttribute("inert", "");
}

function closeLb() {
  if (!open) return;
  const card = savedCard;
  const top = savedScroll;
  const shot = lastShot;
  setOpen(false);
  root?.classList.remove("is-cursor");
  const scroller = card ? focusScrollRoot(card) : null;
  const pin = () => {
    if (scroller) scroller.scrollTop = top;
  };
  pin();
  requestAnimationFrame(() => {
    pin();
    shot?.focus?.({ preventScroll: true });
    pin();
  });
}

function openAt(i, shot) {
  const card = authorCard();
  if (!cardOpen(card)) return;
  savedCard = card;
  savedScroll = focusScrollRoot(card).scrollTop;
  lastShot = shot instanceof HTMLElement ? shot : null;
  index = wrap(i);
  setOpen(true);
  paint();
  lockScroll();
}

function buildDots() {
  if (!pager) return;
  pager.replaceChildren();
  dots = AUTHOR_WORKS.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "img-slider__dot";
    dot.setAttribute("data-author-lb-dot", "");
    dot.setAttribute("aria-label", `${i + 1} / ${AUTHOR_WORKS.length}`);
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goTo(i);
    });
    pager.append(dot);
    return dot;
  });
}

function bindShots() {
  document.querySelectorAll("[data-author-work]").forEach((shot) => {
    shot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!cardOpen()) return;
      const i = Number(shot.getAttribute("data-author-work"));
      if (!Number.isFinite(i)) return;
      openAt(i, shot);
    });
    shot.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
  });
}

function finePointer() {
  return FINE.matches && !isMobile();
}

function moveCursor(event) {
  if (!open || !cursor || !root) return;
  if (!finePointer()) {
    root.classList.remove("is-cursor");
    return;
  }
  const chrome = event.target.closest?.(
    "[data-author-lb-close], [data-author-lb-dots], [data-author-lb-dot]",
  );
  if (chrome) {
    root.classList.remove("is-cursor");
    return;
  }
  root.classList.add("is-cursor");
  cursor.style.left = `${event.clientX}px`;
  cursor.style.top = `${event.clientY}px`;
  cursor.classList.toggle("is-prev", event.clientX < window.innerWidth / 2);
}

export function initAuthorLightbox() {
  root = document.querySelector("[data-author-lightbox]");
  if (!root) return;

  img = root.querySelector("[data-author-lb-img]");
  cursor = root.querySelector("[data-author-lb-cursor]");
  pager = root.querySelector("[data-author-lb-dots]");

  const collage = document.querySelector(".author-card__collage");
  const syncCollageInert = () => {
    if (!collage) return;
    if (cardOpen()) collage.removeAttribute("inert");
    else collage.setAttribute("inert", "");
  };
  syncCollageInert();
  const card = authorCard();
  if (card) {
    new MutationObserver(syncCollageInert).observe(card, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  buildDots();
  bindShots();
  setOpen(false);

  root.querySelector("[data-author-lb-close]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeLb();
  });

  const bindHit = (sel, step) => {
    root.querySelector(sel)?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < ignoreClickUntil) return;
      go(step);
    });
  };
  bindHit("[data-author-lb-prev]", -1);
  bindHit("[data-author-lb-next]", 1);

  root.addEventListener("pointermove", moveCursor);
  root.addEventListener("pointerleave", () => root.classList.remove("is-cursor"));

  root.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (event.isPrimary === false) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.("[data-author-lb-close], [data-author-lb-dots], [data-author-lb-dot]")) {
        return;
      }
      if (event.pointerType === "mouse" && !COARSE.matches) return;
      swipe = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        axis: null,
      };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (!swipe.axis) {
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
        swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.05 ? "x" : "y";
      }
      if (swipe.axis === "x" && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  const endSwipe = (event, cancelled) => {
    if (!swipe || (event && event.pointerId !== swipe.id)) return;
    const dx = event ? event.clientX - swipe.x : 0;
    const axis = swipe.axis;
    swipe = null;
    if (cancelled || axis !== "x") return;
    const w = root.clientWidth || window.innerWidth;
    if (Math.abs(dx) < w * COMMIT_RATIO) return;
    ignoreClickUntil = performance.now() + 450;
    go(dx < 0 ? 1 : -1);
  };

  window.addEventListener("pointerup", (event) => endSwipe(event, false));
  window.addEventListener("pointercancel", (event) => endSwipe(event, true));

  root.addEventListener(
    "wheel",
    (event) => {
      if (!open) return;
      event.preventDefault();
      lockScroll();
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
        closeLb();
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

  document.addEventListener("kaik:translated", () => {
    const closeBtn = root.querySelector("[data-author-lb-close]");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("author.lb.close"));
    const prev = root.querySelector("[data-author-lb-prev]");
    if (prev) prev.setAttribute("aria-label", t("author.lb.prev"));
    const next = root.querySelector("[data-author-lb-next]");
    if (next) next.setAttribute("aria-label", t("author.lb.next"));
  });
}
