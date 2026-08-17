import { isMobile } from "./tweaks.js";

/** Entering cards: `--ease-out`. */
const CARD_EASE = cubicBezierEase(0.23, 1, 0.32, 1);
/** micro-scale-fade signature easing from animate-text. */
const TEXT_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const CARD_MS = 1000;
const CARD_STAGGER_MS = 100;
/** Mobile deal-from-above: snappier than desktop’s from-the-right. */
const MOBILE_CARD_MS = 500;
const MOBILE_CARD_STAGGER_MS = 50;
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

/** Desktop lockup / nav / lang. Stacked mobile cards keep type painted (no inner reveal). */
export function canPlayTextIntro() {
  return !isMobile();
}

/**
 * First-load deck offset. Distance is in deck-local px.
 * Desktop: back of stack first, from the right (1000ms / 100ms).
 * Mobile (`frontFirst`): focus card first, then the ones behind, from above
 * (500ms ease-out / 50ms stagger). Pass a negative distance for from-above.
 *
 * Clock starts on `arm()` (first painted from-state), not at module init —
 * otherwise a slow first frame skips the front card and it pops in at rest.
 */
export function createDeckIntro(count, { frontFirst = false } = {}) {
  let t0 = 0;
  const n = Math.max(1, count);
  const duration = frontFirst ? MOBILE_CARD_MS : CARD_MS;
  const stagger = frontFirst ? MOBILE_CARD_STAGGER_MS : CARD_STAGGER_MS;
  const lastDelay = (n - 1) * stagger;
  return {
    armed: false,
    arm(now) {
      if (this.armed) return;
      this.armed = true;
      t0 = now;
    },
    progress(index, now) {
      if (!this.armed) return 0;
      const delay = (frontFirst ? index : n - 1 - index) * stagger;
      return CARD_EASE(clamp((now - t0 - delay) / duration, 0, 1));
    },
    shift(index, now, distance) {
      return (1 - this.progress(index, now)) * distance;
    },
    done(now) {
      return this.armed && now - t0 >= lastDelay + duration;
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
      anim.cancel();
      clearIntroStyles(el);
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
