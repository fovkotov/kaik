import { openLightboxGallery } from "./author-lightbox.js";

const STRIP = "[data-program-strip]";
const TRACK = "[data-program-track]";
const PREV = "[data-program-strip-prev]";
const NEXT = "[data-program-strip-next]";
const NAV = "[data-program-strip-prev], [data-program-strip-next]";
const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const COARSE = window.matchMedia("(pointer: coarse)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function isTouchPointer(event) {
  return event.pointerType === "touch" || (COARSE.matches && event.pointerType !== "mouse");
}

function cardOf(root) {
  return root.closest("[data-card]");
}

function cardOpen(root) {
  return Boolean(cardOf(root)?.classList.contains("is-program-open"));
}

function fromImg(img) {
  return {
    src: img.currentSrc || img.src || "",
    width: img.naturalWidth || Number(img.getAttribute("width")) || 1920,
    height: img.naturalHeight || Number(img.getAttribute("height")) || 1080,
  };
}

function collectMedia(track) {
  const items = [];
  const seen = new Set();
  track.querySelectorAll(".program-card__shot").forEach((shot) => {
    const img = shot.querySelector("img");
    if (!img || seen.has(img)) return;
    seen.add(img);
    const item = fromImg(img);
    if (item.src) items.push({ el: shot, ...item });
  });
  track.querySelectorAll("img.program-card__mark").forEach((img) => {
    if (seen.has(img) || img.closest(".program-card__shot")) return;
    seen.add(img);
    const item = fromImg(img);
    if (item.src) items.push({ el: img, ...item });
  });
  return items;
}

function mediaFromEvent(event, track) {
  const shot = event.target.closest?.(".program-card__shot");
  if (shot && track.contains(shot)) return shot;
  const mark = event.target.closest?.("img.program-card__mark");
  if (mark && track.contains(mark)) return mark;
  return null;
}

function bindStrip(root) {
  const track = root.querySelector(TRACK);
  const prev = root.querySelector(PREV);
  const next = root.querySelector(NEXT);
  if (!track) return;

  let x = 0;
  let swipe = null;
  let press = null;
  let didSlide = false;

  const viewW = () => root.clientWidth || 1;
  const minX = () => Math.min(0, viewW() - track.scrollWidth);
  const overflowing = () => track.scrollWidth > viewW() + 1;

  const paint = () => {
    track.style.transform = `translate3d(${x}px,0,0)`;
  };

  const syncNav = () => {
    const overflow = overflowing();
    const atStart = x >= -1;
    const atEnd = x <= minX() + 1;
    root.classList.toggle("is-overflow", overflow);
    if (prev) {
      const gone = !overflow || atStart;
      prev.hidden = gone;
      prev.disabled = gone;
      prev.setAttribute("aria-disabled", gone ? "true" : "false");
    }
    if (next) {
      const gone = !overflow || atEnd;
      next.hidden = gone;
      next.disabled = gone;
      next.setAttribute("aria-disabled", gone ? "true" : "false");
    }
  };

  const apply = (nextX, animate) => {
    x = clamp(nextX, minX(), 0);
    if (animate && !REDUCE.matches) {
      track.style.transition = "transform 320ms cubic-bezier(0.23, 1, 0.32, 1)";
    } else {
      track.style.transition = "none";
    }
    paint();
    syncNav();
  };

  const step = (dir) => {
    apply(x + dir * viewW() * 0.72, true);
  };

  const onPrev = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overflowing() || prev?.disabled) return;
    step(1);
  };

  const onNext = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overflowing() || next?.disabled) return;
    step(-1);
  };

  prev?.addEventListener("click", onPrev);
  next?.addEventListener("click", onNext);
  prev?.addEventListener("pointerdown", (event) => event.stopPropagation());
  next?.addEventListener("pointerdown", (event) => event.stopPropagation());

  const onPointerDown = (event) => {
    if (event.target.closest?.(NAV)) return;
    if (event.button && event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    didSlide = false;
    if (!isTouchPointer(event)) return;
    if (!cardOpen(root)) return;
    if (!overflowing()) return;
    track.style.transition = "none";
    swipe = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: x,
      axis: null,
      lastX: event.clientX,
      lastT: event.timeStamp,
      vel: 0,
    };
  };

  const onPointerMove = (event) => {
    if (press && event.pointerId === press.id && !press.moved) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_PX) {
        press.moved = true;
      }
    }
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (!swipe.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
      swipe.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (swipe.axis !== "x") return;
      root.classList.add("is-swiping");
    }
    if (swipe.axis !== "x") return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    didSlide = true;
    const dt = event.timeStamp - swipe.lastT;
    if (dt > 0) {
      swipe.vel = ((event.clientX - swipe.lastX) / dt) * 1000;
      swipe.lastX = event.clientX;
      swipe.lastT = event.timeStamp;
    }
    apply(swipe.origin + dx, false);
  };

  const onPointerUp = (event) => {
    if (press && event.pointerId === press.id) {
      // Keep `press` until click so a scroll-swipe does not open the lightbox.
    } else {
      press = null;
    }
    if (!swipe || event.pointerId !== swipe.id) return;
    const drifted = swipe.axis === "x";
    const vel = swipe.vel;
    swipe = null;
    root.classList.remove("is-swiping");
    if (!drifted) {
      apply(x, false);
      return;
    }
    const coast = REDUCE.matches ? 0 : clamp(vel * 0.18, -420, 420);
    apply(x + coast, true);
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove, { passive: false });
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", (event) => {
    if (press && event.pointerId === press.id) press = null;
    onPointerUp(event);
  });

  root.addEventListener("click", (event) => {
    if (event.target.closest?.(NAV)) return;
    const moved = Boolean(press?.moved) || didSlide;
    press = null;
    didSlide = false;
    if (moved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const media = mediaFromEvent(event, track);
    if (!media) return;
    const items = collectMedia(track);
    const index = items.findIndex((item) => item.el === media);
    if (!items.length || index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    openLightboxGallery(
      items.map(({ src, width, height }) => ({ src, width, height })),
      index,
      media,
    );
  });

  const refresh = () => {
    apply(x, false);
    const first = track.querySelector(".program-card__shot, img.program-card__mark");
    if (first) {
      root.style.setProperty("--strip-media-mid", `${first.offsetHeight / 2}px`);
    }
  };

  const ro = new ResizeObserver(refresh);
  ro.observe(root);
  ro.observe(track);
  track.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", refresh, { once: true });
  });

  refresh();
  root.classList.toggle("is-fine", FINE.matches);
  FINE.addEventListener?.("change", () => {
    root.classList.toggle("is-fine", FINE.matches);
  });
}

export function initProgramStrips(scope = document) {
  scope.querySelectorAll(STRIP).forEach(bindStrip);
}
