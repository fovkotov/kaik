import {
  SCROLL_PX_DEFAULT,
  getScrollPx,
  playFirstScrollFromGesture,
  playScrollSound,
  takeFirstScrollCredit,
  tryUnlockAllAudio,
} from "./lib/sound-catalog.js";
import { isWikiAudioRunning } from "./lib/wiki-sounds.js";
import { hasAudioGesture } from "./lib/gesture-audio.js";
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

  function onScrollPx(delta, event) {
    if (reduced()) return;
    if (!hasAudioGesture() && !isWikiAudioRunning()) return;
    const d = Math.abs(Number(delta));
    if (!Number.isFinite(d) || d === 0) return;
    if (takeFirstScrollCredit()) {
      acc -= getScrollPx() || SCROLL_PX_DEFAULT;
    }
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
    // Do not unlock on wheel — only tick after the first tap.
    if (!hasAudioGesture() && !isWikiAudioRunning()) return;
    if (reduced()) return;
    if (!unlocked) markUnlocked();
    playFirstScrollFromGesture(event);
  }

  const scrollRoot = getScrollRoot();
  const capture = { capture: true, passive: true };

  // Iframe ticks live on the scroll root. After the first tap, wheel over
  // the fixed panel still ticks in that same turn.
  document.addEventListener("wheel", onWheelGesture, capture);
  scrollRoot?.addEventListener("wheel", onWheelGesture, capture);

  // First unlock: tap/click only — never wheel, key, or move.
  for (const type of ["pointerdown", "click"]) {
    const onUnlock = (event) => {
      if (!event.isTrusted || unlocked) return;
      tryUnlockAllAudio(event);
      if (isWikiAudioRunning() || hasAudioGesture()) markUnlocked();
    };
    document.addEventListener(type, onUnlock, capture);
    unlockUnbinds.push(() => document.removeEventListener(type, onUnlock, capture));
  }

}
