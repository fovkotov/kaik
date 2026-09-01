import { getScrollRoot } from "./embed.js";
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

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
const MIN_Z = 1;
const MAX_Z = 4;
const CHROME = "[data-author-lb-close], [data-author-lb-dots], [data-author-lb-dot]";
const NAV = "[data-author-lb-prev], [data-author-lb-next]";
const NO_ZOOM = `${CHROME}, ${NAV}`;
const ABSORB_MS = 400;

let root = null;
let track = null;
let slides = [];
let pager = null;
let dots = [];
let index = 0;
let pending = 0;
let shift = 0;
let velocity = 0;
let stopSpring = null;
let open = false;
let savedScroll = 0;
let savedDeckY = 0;
let savedFocused = false;
let savedCard = null;
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

function widthOf() {
  return track?.clientWidth || root?.clientWidth || window.innerWidth || 1;
}

/** Same wrap as history `img-slider.js` — nearest copy, even-count tie break. */
function wrapDelta(i, current, count, offset) {
  let d = i - current;
  d -= count * Math.round(d / count);
  if (count % 2 === 0 && Math.abs(d) === count / 2) {
    d = offset > 0 ? -count / 2 : count / 2;
  }
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
  const n = AUTHOR_WORKS.length;
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  return delta;
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

function activeImg() {
  return slides[index]?.querySelector("img") ?? null;
}

function syncSlides(active = index) {
  const current = wrap(active);
  slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
}

function syncDots(active = index) {
  const current = wrap(active);
  syncSlides(current);
  dots.forEach((dot, i) => {
    const on = i === current;
    dot.classList.toggle("is-active", on);
    dot.setAttribute("aria-current", on ? "true" : "false");
  });
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

function applyZoom() {
  const img = activeImg();
  if (!img) return;
  if (z <= 1.001 && Math.abs(panX) < 0.01 && Math.abs(panY) < 0.01) {
    img.style.transform = "";
    root?.classList.remove("is-zoomed");
    return;
  }
  img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${z})`;
  root?.classList.toggle("is-zoomed", z > 1.001);
}

function zoomAbsorbed() {
  return performance.now() < absorbZoomUntil;
}

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
    const img = slide.querySelector("img");
    if (img) img.style.transform = "";
  });
  root?.classList.remove("is-zoomed");
}

function clampZ(next) {
  return Math.min(MAX_Z, Math.max(MIN_Z, next));
}

function zoomAround(cx, cy, nextZ) {
  if (zoomAbsorbed()) return;
  const next = clampZ(nextZ);
  const img = activeImg();
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

function go(step) {
  goTo(pending + step);
}

function snapPending() {
  cancelSpring();
  if (pending !== index) finishIndex(pending);
  else {
    shift = 0;
    velocity = 0;
    paint(0);
  }
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
  cancelSpring();
  cancelZoomSession();
  resetZoom();
  setOpen(false);
  root?.classList.remove("is-dragging");
  root?.querySelectorAll(".author-lb__hit.is-aiming").forEach((hit) => hit.classList.remove("is-aiming"));
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
  cancelSpring();
  pending = wrap(i);
  index = pending;
  shift = 0;
  velocity = 0;
  setOpen(true);
  cancelZoomSession();
  resetZoom();
  slides.forEach((slide, s) => {
    slide.style.transition = "none";
    if (!isMobile()) {
      slide.style.opacity = s === index ? "1" : "0";
      slide.style.zIndex = s === index ? "1" : "0";
    } else {
      slide.style.opacity = "";
      slide.style.zIndex = "";
    }
  });
  paint(0);
  syncDots();
  preload(index + 1);
  preload(index - 1);
  lockScroll();
}

function buildSlides() {
  if (!track) return;
  track.replaceChildren();
  slides = AUTHOR_WORKS.map((work, i) => {
    const slide = document.createElement("div");
    slide.className = "author-lb__slide";
    slide.setAttribute("data-author-lb-slide", "");
    if (i === 0) slide.classList.add("is-active");
    const image = document.createElement("img");
    image.alt = "";
    image.width = work.width;
    image.height = work.height;
    image.draggable = false;
    image.setAttribute("draggable", "false");
    image.decoding = "async";
    image.src = work.src;
    slide.append(image);
    track.append(slide);
    return slide;
  });
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
  if (zoomAbsorbed()) return;
  if (z > 1.001) resetZoom();
  else zoomAround(cx, cy, 2);
}

function suppressClick() {
  ignoreClickUntil = performance.now() + 450;
}

export function initAuthorLightbox() {
  root = document.querySelector("[data-author-lightbox]");
  if (!root) return;

  track = root.querySelector("[data-author-lb-track]");
  pager = root.querySelector("[data-author-lb-dots]");

  buildSlides();
  buildDots();
  bindShots();
  setOpen(false);
  paint(0);

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

  const aimHit = (hit, event) => {
    if (!FINE.matches) return;
    const arrow = hit.querySelector(".author-lb__arrow");
    if (!arrow) return;
    arrow.style.left = `${event.clientX}px`;
    arrow.style.top = `${event.clientY}px`;
    hit.classList.add("is-aiming");
  };

  root.querySelectorAll("[data-author-lb-prev], [data-author-lb-next]").forEach((hit) => {
    hit.addEventListener("pointerenter", (event) => aimHit(hit, event));
    hit.addEventListener("pointermove", (event) => aimHit(hit, event));
    hit.addEventListener("pointerleave", () => hit.classList.remove("is-aiming"));
  });

  root.querySelector("[data-author-lb-mid]")?.addEventListener("click", (event) => {
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

  root.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

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
        const dist = pinchDist();
        const mid = pinchCenter();
        pinch = { dist, z0: z, x: mid.x, y: mid.y, gen: zoomGen };
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
      swipe = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin: shift,
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
    swipe = null;
    root.classList.remove("is-dragging");
    if (axis !== "x") {
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

  root.addEventListener(
    "wheel",
    (event) => {
      if (!open) return;
      event.preventDefault();
      lockScroll();
      if (event.ctrlKey || event.metaKey) {
        if (zoomAbsorbed() || gestureGen === zoomGen) return;
        const factor = Math.exp(-event.deltaY * 0.012);
        zoomAround(event.clientX, event.clientY, z * factor);
      }
    },
    { passive: false },
  );

  const onGestureStart = (event) => {
    if (!open) return;
    event.preventDefault();
    if (zoomAbsorbed()) return;
    gestureGen = zoomGen;
    gestureZ0 = z;
  };
  const onGestureChange = (event) => {
    if (!open) return;
    event.preventDefault();
    if (zoomAbsorbed() || gestureGen !== zoomGen) return;
    zoomAround(event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2, gestureZ0 * event.scale);
  };
  const onGestureEnd = (event) => {
    if (!open) return;
    event.preventDefault();
    gestureGen = -1;
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

  const refresh = () => {
    if (!slides.length) return;
    paint(shift);
  };
  new ResizeObserver(refresh).observe(root);

  document.addEventListener("kaik:translated", () => {
    const closeBtn = root.querySelector("[data-author-lb-close]");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("author.lb.close"));
    const prev = root.querySelector("[data-author-lb-prev]");
    if (prev) prev.setAttribute("aria-label", t("author.lb.prev"));
    const next = root.querySelector("[data-author-lb-next]");
    if (next) next.setAttribute("aria-label", t("author.lb.next"));
  });
}
