import {
  SCROLL_PX_DEFAULT,
  getScrollPx,
  playFirstScrollFromGesture,
  playScrollSound,
  warmAllAudio,
} from "./lib/sound-catalog.js";
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
  let lastDriveY = null;

  function creditFirstPop() {
    acc -= getScrollPx() || SCROLL_PX_DEFAULT;
  }

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

  function onWheelGesture(event) {
    if (!event.isTrusted) return;
    if (reduced()) {
      warmAllAudio();
      return;
    }
    // Chromium: wheel is a user gesture. resume() then start() in this turn.
    if (playFirstScrollFromGesture()) creditFirstPop();
    else warmAllAudio();
  }

  function onScrollDriveMove(event, y) {
    if (!event.isTrusted || reduced()) return;
    if (y == null || !Number.isFinite(y)) return;
    if (lastDriveY != null && Math.abs(y - lastDriveY) < 2) return;
    lastDriveY = y;
    if (playFirstScrollFromGesture()) creditFirstPop();
    else warmAllAudio();
  }

  const scrollRoot = getScrollRoot();
  const capture = { capture: true, passive: true };

  document.addEventListener("wheel", onWheelGesture, capture);
  scrollRoot?.addEventListener("wheel", onWheelGesture, capture);

  for (const type of ["pointerdown", "touchstart", "keydown", "click"]) {
    document.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted) return;
        warmAllAudio();
        if (type === "touchstart") lastDriveY = event.touches?.[0]?.clientY ?? lastDriveY;
      },
      capture,
    );
  }

  document.addEventListener(
    "touchmove",
    (event) => {
      onScrollDriveMove(event, event.touches?.[0]?.clientY);
    },
    capture,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "mouse") return;
      onScrollDriveMove(event, event.clientY);
    },
    capture,
  );

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
