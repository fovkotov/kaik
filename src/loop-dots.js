/** Sportross-style looping pager: fixed window, sizes rotate around the current slide. */

/** Dist 0–1 large, 2 medium, 3+ small, as a fraction of the 7px disc. */
const SCALES = [1, 1, 0.75, 0.5];
const VISIBLE_MAX = 7;

function wrap(i, n) {
  return ((i % n) + n) % n;
}

function circularAbs(delta, n) {
  if (n <= 1) return 0;
  let d = ((delta % n) + n) % n;
  if (d > n / 2) d = n - d;
  return d;
}

function shortestRing(from, to, ring) {
  if (ring <= 1) return 0;
  let d = wrap(to - from, ring);
  if (d > ring / 2) d -= ring;
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
  return loopVisibleCount(n);
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
 * `index` is an unwrapped phase (grows by ±1 per slide) so wrapping 12→0
 * still rotates the 7-dot ring by one step.
 * `progress` is toward the next slide (positive = next / images move left).
 */
export function paintLoopDots(dots, { count, index, progress = 0 }) {
  const n = count;
  const w = dots.length;
  if (!w || !n) return;
  const showAll = n <= VISIBLE_MAX;
  const p = Number.isFinite(progress) ? progress : 0;
  const phase = index + p;
  const row = dots[0]?.parentElement;
  if (row) row.style.transform = "";

  const ring = w;
  const center = showAll ? 0 : (w - 1) / 2;
  const current = Math.round(phase);
  const slideNow = wrap(current, n);
  const activeSlot = wrap(current + center, ring);

  dots.forEach((dot, s) => {
    const dist = circularAbs(s - (phase + center), ring);
    const slide = showAll ? s : wrap(slideNow + shortestRing(activeSlot, s, ring), n);
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
