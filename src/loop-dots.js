/** Sportross-style looping pager: fixed window, sizes rotate around the current slide. */

export const SLIDE_FADE_MS = 320;
export const SLIDE_FADE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Dist 0–1 large, 2 medium, 3+ small, as a fraction of the 7px disc. */
const SCALES = [1, 1, 0.75, 0.5];
const VISIBLE_MAX = 7;
const BUFFER = 1;

function wrap(i, n) {
  return ((i % n) + n) % n;
}

function circularAbs(delta, n) {
  if (n <= 1) return 0;
  let d = ((delta % n) + n) % n;
  if (d > n / 2) d = n - d;
  return d;
}

export function scaleAt(dist) {
  const max = SCALES.length - 1;
  if (dist <= 0) return SCALES[0];
  if (dist >= max) return SCALES[max];
  const i = Math.floor(dist);
  const t = dist - i;
  return SCALES[i] + (SCALES[i + 1] - SCALES[i]) * t;
}

export function loopVisibleCount(n) {
  return Math.min(VISIBLE_MAX, Math.max(n, 0));
}

export function loopSlotCount(n) {
  const visible = loopVisibleCount(n);
  if (n <= VISIBLE_MAX) return visible;
  return visible + BUFFER * 2;
}

export function mountLoopDots(pager, { count, onPick, attr = "data-img-slider-dot" }) {
  if (!pager) return [];
  const slots = loopSlotCount(count);
  pager.classList.add("img-slider__dots--loop");
  pager.style.setProperty("--dots-visible", String(loopVisibleCount(count)));
  const row = document.createElement("div");
  row.className = "img-slider__dots-row";
  pager.replaceChildren(row);
  const dots = [];
  for (let s = 0; s < slots; s++) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "img-slider__dot";
    if (attr) dot.setAttribute(attr, "");
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const slide = Number(dot.dataset.slide);
      if (Number.isFinite(slide)) onPick(slide);
    });
    row.append(dot);
    dots.push(dot);
  }
  return dots;
}

/**
 * @param {HTMLElement[]} dots
 * @param {{ count: number, index: number, progress?: number }} state
 * `progress` is toward the next slide (positive = next / images move left / dots shift left).
 */
export function paintLoopDots(dots, { count, index, progress = 0 }) {
  const n = count;
  const w = dots.length;
  if (!w || !n) return;
  const showAll = n <= VISIBLE_MAX;
  const visible = loopVisibleCount(n);
  const p = Number.isFinite(progress) ? progress : 0;
  const row = dots[0]?.parentElement;
  if (row) {
    row.style.transform = showAll ? "" : `translate3d(calc((${-BUFFER} - ${p}) * var(--dot-pitch)),0,0)`;
  }

  const center = showAll ? (w - 1) / 2 : BUFFER + (visible - 1) / 2;

  dots.forEach((dot, s) => {
    let slide;
    let dist;
    if (showAll) {
      slide = s;
      dist = circularAbs(s - (index + p), n);
    } else {
      slide = wrap(Math.round(index) + s - Math.round(center), n);
      dist = Math.abs(s - center - p);
    }
    const scale = scaleAt(dist);
    const glow = Math.max(0, 1 - dist);
    const on = dist < 0.55;
    dot.dataset.slide = String(slide);
    dot.setAttribute("aria-label", `${slide + 1} / ${n}`);
    dot.classList.toggle("is-active", on);
    dot.setAttribute("aria-current", on ? "true" : "false");
    dot.style.setProperty("--dot-scale", scale.toFixed(3));
    dot.style.setProperty("--dot-glow", glow.toFixed(3));
  });
}
