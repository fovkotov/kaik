import { isMobile } from "./tweaks.js";

/** Entering cards: `--ease-out`. */
const CARD_EASE = cubicBezierEase(0.23, 1, 0.32, 1);
/** micro-scale-fade signature easing from animate-text. */
const TEXT_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const CARD_MS = 1000;
const CARD_STAGGER_MS = 100;
/** micro-scale-fade 432ms × 3, after the stack has landed. */
const TEXT_MS = 1296;
const TEXT_FROM_SCALE = 0.96;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cubicBezierEase(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleDx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  return (t) => {
    const time = clamp(t, 0, 1);
    let x = time;
    for (let i = 0; i < 6; i += 1) {
      const z = sampleX(x) - time;
      const d = sampleDx(x);
      if (Math.abs(z) < 1e-5 || Math.abs(d) < 1e-6) break;
      x -= z / d;
    }
    return sampleY(x);
  };
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function markIntroReady() {
  document.documentElement.classList.add("intro-ready");
}

export function markIntroText() {
  document.documentElement.classList.add("intro-ready", "intro-text");
}

export function markIntroDone() {
  document.documentElement.classList.add("intro-ready", "intro-text", "intro-done");
}

export function canPlayCardIntro() {
  return !reducedMotion();
}

/** Desktop lockup / nav / lang. Mobile card type uses `text-appear.js`. */
export function canPlayTextIntro() {
  return !isMobile();
}

/**
 * First-load deck offset. Back of stack lands first so the pile deals from below
 * (mobile) or from the right (desktop). Distance is in deck-local px.
 */
export function createDeckIntro(count) {
  const t0 = performance.now();
  const n = Math.max(1, count);
  const lastDelay = (n - 1) * CARD_STAGGER_MS;
  return {
    armed: false,
    progress(index, now) {
      const delay = (n - 1 - index) * CARD_STAGGER_MS;
      return CARD_EASE(clamp((now - t0 - delay) / CARD_MS, 0, 1));
    },
    shift(index, now, distance) {
      return (1 - this.progress(index, now)) * distance;
    },
    done(now) {
      return now - t0 >= lastDelay + CARD_MS;
    },
  };
}

function clearIntroStyles(el) {
  el.style.opacity = "";
  el.style.transform = "";
  el.style.transformOrigin = "";
}

function animateWhole(el, { delay = 0, scale } = {}) {
  el.style.transformOrigin = "50% 55%";
  const from = scale
    ? { opacity: 0, transform: `translate3d(0, 0, 0) scale(${TEXT_FROM_SCALE})` }
    : { opacity: 0, transform: "translate3d(0, 0, 0) scale(1)" };
  const to = { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" };
  const anim = el.animate([from, to], {
    delay,
    duration: scale ? TEXT_MS : 200,
    easing: scale ? TEXT_EASE : "ease",
    fill: "forwards",
  });
  return anim.finished
    .then(() => {
      clearIntroStyles(el);
      anim.cancel();
    })
    .catch(() => {
      clearIntroStyles(el);
    });
}

/** One-shot micro-scale-fade on the fixed panel (enter only, existing copy). */
export function playTextIntro() {
  markIntroText();
  const hosts = [
    document.querySelector("[data-lockup]"),
    document.querySelector(".panel__nav"),
    document.querySelector(".panel__lang"),
  ].filter(Boolean);
  if (!hosts.length) {
    markIntroDone();
    return;
  }

  const scale = !reducedMotion();
  Promise.all(
    hosts.map((el) => animateWhole(el, { delay: 0, scale })),
  ).then(() => {
    markIntroDone();
  });
}
