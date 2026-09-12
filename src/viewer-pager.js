/** Windowed scale-weighted pager — same recipe as experiment-2 / fullscreen. */
export const DOTS_MAIN = 3;
export const DOTS_VISIBLE = DOTS_MAIN + 4;
export const DOT_SLOT = 16;
export const DOT_SCALE = [1, 0.75, 0.5, 0.33];

export function createPagerState() {
  return { anchor: 0, last: -1 };
}

export function resetPagerState(state) {
  state.anchor = 0;
  state.last = -1;
  return state;
}

/**
 * Scale + window the dots for `active`. Mutates `state` and CSS vars.
 * Active stays in a 3-dot main window; neighbors fade; the rest clip.
 */
export function layoutWeightedDots({ dots, track, pager, active, state }) {
  const n = dots.length;
  if (!n || !track) return;
  const main = Math.min(n, DOTS_MAIN);
  if (state.last < 0) state.anchor = Math.min(active, main - 1);
  else state.anchor = Math.max(0, Math.min(main - 1, state.anchor + (active - state.last)));
  state.last = active;
  const start = Math.max(0, Math.min(n - main, active - state.anchor));
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
  track.style.setProperty("--dots-x", `${x}px`);
  if (pager) pager.style.setProperty("--dots-visible", String(visible));
}
