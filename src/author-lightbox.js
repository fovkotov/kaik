import { getScrollRoot } from "./embed.js";
import { focusScrollRoot } from "./focus-scrollbar.js";
import { publicUrl } from "./public-url.js";
import { t } from "./scriptik.js";

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

const COARSE = window.matchMedia("(pointer: coarse)");
const AXIS_PX = 8;
const COMMIT_RATIO = 0.22;
const MIN_Z = 1;
const MAX_Z = 4;
const CHROME = "[data-author-lb-close], [data-author-lb-dots], [data-author-lb-dot]";

let root = null;
let img = null;
let pager = null;
let dots = [];
let index = 0;
let open = false;
let savedScroll = 0;
let savedDeckY = 0;
let savedFocused = false;
let savedCard = null;
let lastShot = null;
let ignoreClickUntil = 0;
let swipe = null;
let z = 1;
let panX = 0;
let panY = 0;
let gestureZ0 = 1;
let pointers = new Map();
let pinch = null;
let pan = null;
let lastTap = 0;

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

function applyZoom() {
  if (!img) return;
  img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${z})`;
  root?.classList.toggle("is-zoomed", z > 1.001);
}

function resetZoom() {
  z = 1;
  panX = 0;
  panY = 0;
  applyZoom();
}

function clampZ(next) {
  return Math.min(MAX_Z, Math.max(MIN_Z, next));
}

function zoomAround(cx, cy, nextZ) {
  const next = clampZ(nextZ);
  if (!img || Math.abs(next - z) < 0.001) return;
  const box = img.parentElement?.getBoundingClientRect();
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

function paint() {
  const work = AUTHOR_WORKS[index];
  if (!img || !work) return;
  resetZoom();
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
  const deckRoot = getScrollRoot();
  if (deckRoot && deckRoot.scrollTop !== savedDeckY) deckRoot.scrollTop = savedDeckY;
  if (!savedFocused || !savedCard) return;
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
  const deckY = savedDeckY;
  const wasFocused = savedFocused;
  const shot = lastShot;
  resetZoom();
  setOpen(false);
  const scroller = card ? focusScrollRoot(card) : null;
  const deckRoot = getScrollRoot();
  const pin = () => {
    if (deckRoot) deckRoot.scrollTop = deckY;
    if (wasFocused && scroller) scroller.scrollTop = top;
  };
  pin();
  requestAnimationFrame(() => {
    pin();
    if (wasFocused) shot?.focus?.({ preventScroll: true });
    pin();
  });
}

function openAt(i, shot) {
  const card = authorCard();
  savedCard = card;
  savedFocused = cardOpen(card);
  savedScroll = card ? focusScrollRoot(card).scrollTop : 0;
  savedDeckY = getScrollRoot()?.scrollTop ?? 0;
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
    const hold = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    shot.addEventListener("pointerdown", hold, true);
    shot.addEventListener(
      "click",
      (event) => {
        hold(event);
        const i = Number(shot.getAttribute("data-author-work"));
        if (!Number.isFinite(i)) return;
        openAt(i, shot);
      },
      true,
    );
  });
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

function toggleZoom(cx, cy) {
  if (z > 1.001) resetZoom();
  else zoomAround(cx, cy, 2);
}

export function initAuthorLightbox() {
  root = document.querySelector("[data-author-lightbox]");
  if (!root) return;

  img = root.querySelector("[data-author-lb-img]");
  pager = root.querySelector("[data-author-lb-dots]");

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

  root.querySelector("[data-author-lb-mid]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("dblclick", (event) => {
    if (!open) return;
    if (event.target.closest?.(CHROME)) return;
    event.preventDefault();
    toggleZoom(event.clientX, event.clientY);
  });

  root.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.(CHROME)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        swipe = null;
        pan = null;
        const dist = pinchDist();
        const mid = pinchCenter();
        pinch = { dist, z0: z, x: mid.x, y: mid.y };
        return;
      }

      if (z > 1.001) {
        pan = { id: event.pointerId, x: event.clientX, y: event.clientY, px: panX, py: panY };
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
      if (!open) return;
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pinch && pointers.size >= 2) {
        const dist = pinchDist();
        const mid = pinchCenter();
        if (pinch.dist > 8 && dist > 0) {
          if (event.cancelable) event.preventDefault();
          zoomAround(mid.x, mid.y, pinch.z0 * (dist / pinch.dist));
        }
        return;
      }

      if (pan && event.pointerId === pan.id) {
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
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
        swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.05 ? "x" : "y";
      }
      if (swipe.axis === "x" && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  const endPointer = (event, cancelled) => {
    const hadPinch = Boolean(pinch);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan && event.pointerId === pan.id) pan = null;

    if (hadPinch) {
      ignoreClickUntil = performance.now() + 450;
      swipe = null;
      return;
    }

    if (z <= 1.001 && event.pointerType === "touch") {
      const now = performance.now();
      const dx = swipe ? event.clientX - swipe.x : 0;
      const dy = swipe ? event.clientY - swipe.y : 0;
      if (!cancelled && Math.hypot(dx, dy) < AXIS_PX) {
        if (now - lastTap < 280) {
          toggleZoom(event.clientX, event.clientY);
          lastTap = 0;
          ignoreClickUntil = now + 450;
        } else {
          lastTap = now;
        }
      }
    }

    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const axis = swipe.axis;
    swipe = null;
    if (cancelled || axis !== "x" || z > 1.001) return;
    const w = root.clientWidth || window.innerWidth;
    if (Math.abs(dx) < w * COMMIT_RATIO) return;
    ignoreClickUntil = performance.now() + 450;
    go(dx < 0 ? 1 : -1);
  };

  window.addEventListener("pointerup", (event) => endPointer(event, false));
  window.addEventListener("pointercancel", (event) => endPointer(event, true));

  root.addEventListener(
    "wheel",
    (event) => {
      if (!open) return;
      event.preventDefault();
      lockScroll();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.012);
        zoomAround(event.clientX, event.clientY, z * factor);
      }
    },
    { passive: false },
  );

  const onGestureStart = (event) => {
    if (!open) return;
    event.preventDefault();
    gestureZ0 = z;
  };
  const onGestureChange = (event) => {
    if (!open) return;
    event.preventDefault();
    zoomAround(event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2, gestureZ0 * event.scale);
  };
  const onGestureEnd = (event) => {
    if (!open) return;
    event.preventDefault();
  };
  root.addEventListener("gesturestart", onGestureStart, { passive: false });
  root.addEventListener("gesturechange", onGestureChange, { passive: false });
  root.addEventListener("gestureend", onGestureEnd, { passive: false });

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
