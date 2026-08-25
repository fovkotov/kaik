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
import { isMobile } from "./tweaks.js";

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
  let unlocked = false;
  const unlockUnbinds = [];

  function markUnlocked() {
    if (unlocked) return;
    unlocked = true;
    while (unlockUnbinds.length) {
      try {
        unlockUnbinds.pop()();
      } catch {
        // ignore
      }
    }
  }

  function creditFirstPop() {
    acc -= getScrollPx() || SCROLL_PX_DEFAULT;
  }

  function onScrollPx(delta) {
    if (reduced()) return;
    const d = Math.abs(Number(delta));
    if (!Number.isFinite(d) || d === 0) return;
    // Mobile: never resume/decode from a scroll sample — only tick if Web
    // Audio is already running from a real tap. Distance-only (no time
    // throttle) so pops land in the same gesture turn as the drag.
    if (isMobile() && !isWikiAudioRunning()) return;
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
    } else if (!unlocked) {
      warmAllAudio(event);
    }
    if (isWikiAudioRunning()) markUnlocked();
  }

  const scrollRoot = getScrollRoot();
  const capture = { capture: true, passive: true };

  // Iframe ticks live on the scroll root. Document still sees wheel over the
  // fixed panel so the first pop can unlock without a click.
  document.addEventListener("wheel", onWheelGesture, capture);
  scrollRoot?.addEventListener("wheel", onWheelGesture, capture);

  // Discrete unlock only — never touchmove / pointermove (iOS main-thread jank).
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "keydown", "click"]) {
    const onUnlock = (event) => {
      if (!event.isTrusted || unlocked) return;
      tryUnlockAllAudio(event);
      if (isWikiAudioRunning()) markUnlocked();
    };
    document.addEventListener(type, onUnlock, capture);
    unlockUnbinds.push(() => document.removeEventListener(type, onUnlock, capture));
  }

  // Desktop native scroll ticks. Mobile stack is not this scroller — zeroing
  // scrollTop there would both jank and double-fire pops.
  let lastScrollTop = scrollRoot?.scrollTop || 0;
  scrollRoot?.addEventListener(
    "scroll",
    () => {
      if (isMobile()) {
        lastScrollTop = scrollRoot.scrollTop || 0;
        return;
      }
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
