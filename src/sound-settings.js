import {
  SCROLL_PX_DEFAULT,
  getScrollPx,
  playFirstScrollFromGesture,
  playScrollSound,
  tryUnlockAllAudio,
  warmAllAudio,
} from "./lib/sound-catalog.js";
import { isWikiAudioRunning } from "./lib/wiki-sounds.js";
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
  let unlocked = false;

  function markUnlocked() {
    unlocked = true;
  }

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
      if (!unlocked) warmAllAudio(event);
      return;
    }
    // Chromium: wheel is a user gesture. resume() then start() in this turn.
    if (playFirstScrollFromGesture(event)) {
      creditFirstPop();
      markUnlocked();
    } else if (!unlocked) {
      warmAllAudio(event);
      if (isWikiAudioRunning()) markUnlocked();
    }
  }

  function onScrollDriveMove(event, y) {
    if (!event.isTrusted || reduced()) return;
    if (y == null || !Number.isFinite(y)) return;
    if (lastDriveY != null && Math.abs(y - lastDriveY) < 2) return;
    lastDriveY = y;
    if (playFirstScrollFromGesture(event)) {
      creditFirstPop();
      markUnlocked();
    } else if (!unlocked) {
      warmAllAudio(event);
      if (isWikiAudioRunning()) markUnlocked();
    }
  }

  const scrollRoot = getScrollRoot();
  const capture = { capture: true, passive: true };

  // Iframe ticks live on the scroll root. Document still sees wheel over the
  // fixed panel so the first pop can unlock without a click.
  document.addEventListener("wheel", onWheelGesture, capture);
  scrollRoot?.addEventListener("wheel", onWheelGesture, capture);

  // Discrete unlock only — never mousemove / pointermove floods.
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "keydown", "click"]) {
    const onUnlock = (event) => {
      if (!event.isTrusted || unlocked) return;
      if (type === "touchstart") lastDriveY = event.touches?.[0]?.clientY ?? lastDriveY;
      tryUnlockAllAudio(event);
      if (isWikiAudioRunning()) markUnlocked();
    };
    document.addEventListener(type, onUnlock, capture);
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
      // Mouse moves must not unlock — that was the main-thread thrash.
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
