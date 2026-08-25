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

/** Desktop deck wheel: ticks in that turn. No-op until init (and on mobile). */
let noteDesktopDeckDeltaImpl = () => {};

export function noteDesktopDeckDelta(deltaPx, event) {
  noteDesktopDeckDeltaImpl(deltaPx, event);
}

export function initSoundSettings() {
  document.querySelector("[data-sound-settings]")?.remove();
  document.querySelectorAll(".sound-settings__fab, [data-sound-fab], [data-sound-open]").forEach((el) => {
    el.remove();
  });

  // Mobile: no AudioContext, no unlock listeners, no scroll ticks.
  if (isMobile()) return;

  let acc = 0;
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

  function onScrollPx(delta, event) {
    if (reduced()) return;
    const d = Math.abs(Number(delta));
    if (!Number.isFinite(d) || d === 0) return;
    acc += d;
    const step = getScrollPx() || SCROLL_PX_DEFAULT;
    while (acc >= step) {
      playScrollSound(event ? { event } : {});
      acc -= step;
    }
  }

  noteDesktopDeckDeltaImpl = (deltaPx, event) => {
    onScrollPx(deltaPx, event);
  };

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
    markUnlocked();
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

}
