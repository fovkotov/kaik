/**
 * Student project viewer — the experiment-2 fullscreen deck, in page.
 *
 * A program-strip slide marked `data-project-viewer="<nick>"` (or a work id)
 * opens this overlay instead of the plain image lightbox: the student's own
 * deck from the works catalog, pale `.viewer-btn` chrome, scale-weighted
 * pager and the `name @nick · stream` caption. Fixed to the iframe, so the
 * focused card keeps its inner scroll and comes back untouched on close.
 */

import "./project-viewer.css";
import { getScrollRoot } from "./embed.js";
import { liveFocusScrollRoot } from "./focus-scrollbar.js";
import { publicUrl } from "./public-url.js";
import { t } from "./scriptik.js";
import { isMobile } from "./tweaks.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

const MARK = "[data-project-viewer]";
const CHROME = "[data-pv-close], [data-pv-dots], [data-pv-dot]";
const NAV = "[data-pv-prev], [data-pv-next]";
const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
/* Same windowed pager as experiment-2: 3 full-size dots, two faded neighbours
   on each side, the rest clipped. The active dot stays in the main window. */
const DOTS_MAIN = 3;
const DOTS_VISIBLE = DOTS_MAIN + 4;
const DOT_SLOT = 16;
const DOT_SCALE = [1, 0.75, 0.5, 0.33];

let root = null;
let track = null;
let pager = null;
let caption = null;
let slides = [];
let dots = [];
let dotsTrack = null;
let dotAnchor = 0;
let dotLast = -1;
let deck = [];
let index = 0;
let pending = 0;
let shift = 0;
let velocity = 0;
let stopSpring = null;
let open = false;
let swipe = null;
let samples = [];
let ignoreClickUntil = 0;
let shot = null;
let savedScroller = null;
let savedScroll = 0;
let savedDeckY = 0;
let catalogOnce = null;

export function isProjectViewerOpen() {
  return open;
}

function isFontFile(name) {
  return /\.(ttf|otf|woff2?)$/i.test(String(name || ""));
}

function catalogItems() {
  if (!catalogOnce) {
    catalogOnce = loadWorksCatalog()
      .then((catalog) => catalog.items || [])
      .catch(() => []);
  }
  return catalogOnce;
}

/** Warm the catalog so the first click opens without a fetch wait. */
function prefetchCatalog() {
  const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 1200));
  idle(() => catalogItems());
}

function imagesOf(item) {
  return (item?.files || []).filter((file) => !isFontFile(file));
}

function newest(a, b) {
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

/**
 * Resolve `data-project-viewer` to one student deck. A `wrk_…` value is that
 * exact work; anything else is an Instagram nick — their final project if
 * they have one (the richest deck), else every visible work they submitted.
 */
function deckFor(items, key) {
  const want = String(key || "").trim().toLowerCase().replace(/^@/, "");
  if (!want) return [];
  const byId = items.find((item) => String(item.id).toLowerCase() === want);
  if (byId) return slidesOf([byId]);
  const mine = items.filter(
    (item) => !item.hidden && String(item.nick || "").toLowerCase() === want,
  );
  if (!mine.length) return [];
  const finals = mine
    .filter((item) => item.type === "final" && imagesOf(item).length)
    .sort((a, b) => imagesOf(b).length - imagesOf(a).length || newest(a, b));
  if (finals.length) return slidesOf([finals[0]]);
  return slidesOf([...mine].sort((a, b) => newest(b, a)));
}

function slidesOf(works) {
  const out = [];
  works.forEach((work) => {
    imagesOf(work).forEach((file) => {
      out.push({
        work,
        src: workFileUrl(file),
        width: Number(work.width) || 16,
        height: Number(work.height) || 9,
      });
    });
  });
  return out;
}

/** Name, then muted @nick and stream — same line as the experiment-2 viewer. */
function captionNodes(work) {
  const nodes = [];
  const add = (text, muted) => {
    if (!text) return;
    const span = document.createElement("span");
    if (muted) span.className = "is-muted";
    span.textContent = text;
    nodes.push(span);
  };
  add(work?.author, false);
  if (work?.nick) add(`@${work.nick}`, true);
  if (work?.stream) add(t("exp2.stream").replace("{n}", work.stream), true);
  return nodes;
}

const count = () => deck.length || 1;
const wrap = (i) => ((i % count()) + count()) % count();
const widthOf = () => track?.clientWidth || root?.clientWidth || window.innerWidth || 1;

/** Nearest copy of slide `i`, even-count tie broken by drag direction. */
function wrapDelta(i, current, n, offset) {
  let d = i - current;
  d -= n * Math.round(d / n);
  if (n % 2 === 0 && Math.abs(d) === n / 2) d = offset > 0 ? -n / 2 : n / 2;
  return d;
}

function sampleVel(list) {
  if (list.length < 2) return 0;
  const a = list[0];
  const b = list[list.length - 1];
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

/**
 * Swiper dynamic-bullets layout: the active dot sits at `dotAnchor` inside a
 * DOTS_MAIN-wide window; only once it reaches an edge does the strip move.
 * Dots outside the window shrink by distance.
 */
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

function syncDots(active = index) {
  const current = wrap(active);
  slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
  layoutDots(current);
}

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

function preload(i) {
  const img = slides[wrap(i)]?.querySelector("img");
  if (img) img.loading = "eager";
}

function finishIndex(next) {
  index = wrap(next);
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
  syncDots(nextIndex);
  springTo(dest, vel, () => finishIndex(nextIndex));
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

function suppressClick() {
  ignoreClickUntil = performance.now() + 450;
}

function buildSlides() {
  track.replaceChildren();
  slides = deck.map((entry, i) => {
    const slide = document.createElement("div");
    slide.className = "pviewer__slide";
    const image = document.createElement("img");
    /* One project, many slides: only the first one carries the alt. */
    image.alt = i === 0 ? [entry.work?.author, entry.work?.nick && `@${entry.work.nick}`].filter(Boolean).join(" ") : "";
    image.width = entry.width;
    image.height = entry.height;
    image.draggable = false;
    image.setAttribute("draggable", "false");
    image.decoding = "async";
    image.loading = i === 0 ? "eager" : "lazy";
    image.src = entry.src;
    slide.append(image);
    track.append(slide);
    return slide;
  });
}

function buildDots() {
  dotsTrack = document.createElement("div");
  dotsTrack.className = "pviewer__dots-track";
  pager.replaceChildren(dotsTrack);
  pager.style.setProperty("--dots-visible", String(Math.min(deck.length, DOTS_VISIBLE)));
  dotAnchor = 0;
  dotLast = -1;
  dots = deck.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "pviewer__dot";
    dot.setAttribute("data-pv-dot", "");
    dot.setAttribute("aria-label", `${i + 1} / ${deck.length}`);
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goTo(i);
    });
    dotsTrack.append(dot);
    return dot;
  });
}

function plate(kind) {
  const span = document.createElement("span");
  span.className = "pviewer__arrow viewer-btn";
  span.setAttribute("aria-hidden", "true");
  const icon = document.createElement("img");
  icon.className = "pviewer__chevron viewer-btn__icon";
  icon.src = publicUrl("assets/author/exp2-chevron.svg");
  icon.alt = "";
  icon.width = 34;
  icon.height = 34;
  icon.draggable = false;
  icon.setAttribute("draggable", "false");
  span.append(icon);
  span.dataset.kind = kind;
  return span;
}

function hitButton(kind, key) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `pviewer__hit pviewer__hit--${kind}`;
  btn.setAttribute(kind === "prev" ? "data-pv-prev" : "data-pv-next", "");
  btn.setAttribute("data-i18n-aria", key);
  btn.setAttribute("aria-label", t(key));
  btn.append(plate(kind));
  return btn;
}

function buildRoot() {
  root = document.createElement("div");
  root.className = "pviewer";
  root.setAttribute("data-project-viewer-root", "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("data-i18n-aria", "author.lb.label");
  root.setAttribute("aria-label", t("author.lb.label"));
  root.tabIndex = -1;
  root.hidden = true;
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");

  track = document.createElement("figure");
  track.className = "pviewer__stage";
  track.setAttribute("data-pv-track", "");

  const prev = hitButton("prev", "author.lb.prev");
  const next = hitButton("next", "author.lb.next");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "pviewer__close viewer-btn";
  close.setAttribute("data-pv-close", "");
  close.setAttribute("data-i18n-aria", "author.lb.close");
  close.setAttribute("aria-label", t("author.lb.close"));
  const closeIcon = document.createElement("img");
  closeIcon.className = "viewer-btn__icon";
  closeIcon.src = publicUrl("assets/author/exp2-close.svg");
  closeIcon.alt = "";
  closeIcon.width = 34;
  closeIcon.height = 34;
  closeIcon.draggable = false;
  close.append(closeIcon);

  caption = document.createElement("p");
  caption.className = "pviewer__caption";
  caption.setAttribute("data-pv-caption", "");

  pager = document.createElement("div");
  pager.className = "pviewer__dots";
  pager.setAttribute("data-pv-dots", "");
  pager.setAttribute("role", "tablist");

  root.append(track, prev, next, close, caption, pager);
  document.body.append(root);
  bindRoot();
}

function setOpen(next) {
  open = next;
  document.documentElement.classList.toggle("is-project-viewer-open", next);
  root.hidden = !next;
  root.setAttribute("aria-hidden", next ? "false" : "true");
  if (next) root.removeAttribute("inert");
  else root.setAttribute("inert", "");
}

/** The focused card must not have moved while the overlay covered it. */
function pinScroll() {
  const deckRoot = getScrollRoot();
  if (deckRoot && deckRoot.scrollTop !== savedDeckY) deckRoot.scrollTop = savedDeckY;
  if (savedScroller && savedScroller.scrollTop !== savedScroll) savedScroller.scrollTop = savedScroll;
}

function close() {
  if (!open) return;
  const returnTo = shot;
  cancelSpring();
  swipe = null;
  setOpen(false);
  root.classList.remove("is-dragging");
  root.querySelectorAll(".pviewer__hit.is-aiming").forEach((hit) => hit.classList.remove("is-aiming"));
  pinScroll();
  requestAnimationFrame(() => {
    pinScroll();
    returnTo?.focus?.({ preventScroll: true });
    pinScroll();
  });
  shot = null;
}

/** Tab must not walk out of the overlay while it is up. */
function trapFocus(event) {
  const focusable = [...root.querySelectorAll("button:not([disabled])")].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function bindRoot() {
  root.querySelector("[data-pv-close]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  const bindHit = (sel, step) => {
    root.querySelector(sel).addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < ignoreClickUntil) return;
      go(step);
    });
  };
  bindHit("[data-pv-prev]", -1);
  bindHit("[data-pv-next]", 1);

  /* The plate follows the cursor inside its third, as on experiment-2. */
  const aimHit = (hit, event) => {
    if (!FINE.matches || isMobile()) return;
    const arrow = hit.querySelector(".pviewer__arrow");
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

  /* Backdrop: the bare middle band closes, the thirds navigate. */
  root.addEventListener("click", (event) => {
    if (!open) return;
    if (event.target !== root) return;
    if (performance.now() < ignoreClickUntil) return;
    event.preventDefault();
    close();
  });

  root.addEventListener("dragstart", (event) => event.preventDefault());

  root.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.(CHROME)) return;
      if (!isMobile()) return;
      if (event.pointerType === "mouse" && !COARSE.matches) return;
      cancelSpring();
      adoptPending();
      samples = [{ x: shift, t: event.timeStamp || performance.now() }];
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: shift, axis: null };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!open || !swipe || event.pointerId !== swipe.id) return;
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
      samples.push({ x: shift, t: event.timeStamp || performance.now() });
      if (samples.length > 5) samples.shift();
      if (samples.length >= 2) velocity = sampleVel(samples);
      paint(shift);
      syncDots(index + committedSteps(0));
    },
    { passive: false },
  );

  const endPointer = (event, cancelled) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const axis = swipe.axis;
    swipe = null;
    root.classList.remove("is-dragging");
    if (axis !== "x") {
      if (Math.abs(shift) > 0.5) settleShift(0, 0, index);
      return;
    }
    suppressClick();
    if (cancelled) {
      settleShift(0, 0, index);
      return;
    }
    const vel = sampleVel(samples) || velocity;
    const steps = committedSteps(vel);
    settleShift(-steps * widthOf(), vel, index + steps);
  };
  window.addEventListener("pointerup", (event) => endPointer(event, false));
  window.addEventListener("pointercancel", (event) => endPointer(event, true));

  root.addEventListener(
    "touchmove",
    (event) => {
      if (open && swipe?.axis === "x" && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  /* Wheel stays in the overlay: no deck scroll, no chaining to the parent page. */
  root.addEventListener(
    "wheel",
    (event) => {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      pinScroll();
    },
    { passive: false },
  );

  document.addEventListener(
    "scroll",
    () => {
      if (open) pinScroll();
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
      if (event.key === "Tab") {
        event.stopImmediatePropagation();
        trapFocus(event);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        go(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        go(1);
      }
    },
    true,
  );

  new ResizeObserver(() => {
    if (!open || !slides.length) return;
    finishIndex(pending);
  }).observe(root);

  document.addEventListener("kaik:translated", () => {
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
  });
}

/**
 * Open the deck marked on `el` (`data-project-viewer`). Resolves `true` when
 * the overlay took the click, `false` when the catalog has nothing for it —
 * the caller then falls back to the plain image lightbox.
 */
export async function openProjectViewer(key, el = null) {
  if (!root) buildRoot();
  const items = await catalogItems();
  const next = deckFor(items, key);
  if (!next.length) return false;

  deck = next;
  shot = el instanceof HTMLElement ? el : null;
  const card = shot?.closest?.("[data-card]") || null;
  savedScroller = card ? liveFocusScrollRoot(card) : null;
  savedScroll = savedScroller?.scrollTop ?? 0;
  savedDeckY = getScrollRoot()?.scrollTop ?? 0;
  caption.replaceChildren(...captionNodes(deck[0].work));
  root.classList.toggle("is-single", deck.length < 2);
  buildSlides();
  buildDots();
  cancelSpring();
  shift = 0;
  velocity = 0;
  setOpen(true);
  finishIndex(0);
  pinScroll();
  /* The dialog itself takes focus, so Tab starts inside and no control
     lights up a focus ring the visitor did not ask for. */
  root.focus({ preventScroll: true });
  return true;
}

/** The strip slide that a click should route to the viewer, if any. */
export function projectViewerKey(el) {
  const marked = el instanceof HTMLElement ? el.closest(MARK) : null;
  return marked?.getAttribute("data-project-viewer") || "";
}

export function initProjectViewer(scope = document) {
  if (!scope.querySelector(MARK)) return;
  if (!root) buildRoot();
  prefetchCatalog();
}
