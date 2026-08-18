import { SCROLL_PX_DEFAULT, getScrollPx, playScrollSound } from "./lib/sound-catalog.js";
import { getScrollRoot } from "./embed.js";

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initSoundSettings() {
  document.querySelector("[data-sound-settings]")?.remove();
  document.querySelectorAll(".sound-settings__fab, [data-sound-fab], [data-sound-open]").forEach((el) => {
    el.remove();
  });

  let acc = 0;
  let lastMobileYPx = null;

  function onScrollPx(delta) {
    if (reduced()) return;
    const d = Math.abs(Number(delta));
    if (!Number.isFinite(d) || d === 0) return;
    acc += d;
    const step = getScrollPx() || SCROLL_PX_DEFAULT;
    while (acc >= step) {
      playScrollSound();
      acc -= step;
    }
  }

  const scrollRoot = getScrollRoot();
  let lastScrollTop = scrollRoot?.scrollTop || 0;
  scrollRoot?.addEventListener(
    "scroll",
    () => {
      const top = scrollRoot.scrollTop || 0;
      const delta = top - lastScrollTop;
      lastScrollTop = top;
      onScrollPx(delta);
    },
    { passive: true },
  );

  document.addEventListener("kaik:deck-progress", (event) => {
    const detail = event.detail || {};
    if (!detail.mobile) return;
    const yPx = Number(detail.yPx);
    if (!Number.isFinite(yPx)) return;
    if (lastMobileYPx == null) {
      lastMobileYPx = yPx;
      return;
    }
    const delta = yPx - lastMobileYPx;
    lastMobileYPx = yPx;
    onScrollPx(delta);
  });
}
