import { tryUnlockAllAudio } from "./lib/sound-catalog.js";
import { isWikiAudioRunning } from "./lib/wiki-sounds.js";
import { hasAudioGesture } from "./lib/gesture-audio.js";
import { isMobile } from "./tweaks.js";

export function initSoundSettings() {
  document.querySelector("[data-sound-settings]")?.remove();
  document.querySelectorAll(".sound-settings__fab, [data-sound-fab], [data-sound-open]").forEach((el) => {
    el.remove();
  });

  // Mobile: no AudioContext, no unlock listeners.
  if (isMobile()) return;

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

  const capture = { capture: true, passive: true };

  // First unlock: tap/click only — never wheel. Scroll ticks stay off.
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
