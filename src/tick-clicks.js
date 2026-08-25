import { isWikiAudioRunning, playWikiSound, warmWikiAudio } from "./lib/wiki-sounds.js";
import { hasAudioGesture } from "./lib/gesture-audio.js";
import { getActionVolume } from "./lib/sound-volume.js";
import { isMobile } from "./tweaks.js";

const STEP_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function clickTarget(event) {
  const raw = event.target;
  if (raw instanceof Element) return raw;
  return raw?.parentElement ?? null;
}

function isDisabledControl(target) {
  const control = target.closest(
    "button, a, input, select, textarea, option, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='option']",
  );
  if (!control) return false;
  if (control.matches(":disabled") || control.disabled) return true;
  if (control.getAttribute("aria-disabled") === "true") return true;
  if (control.closest("fieldset")?.disabled) return true;
  return Boolean(control.closest("[aria-disabled='true']"));
}

function isTextEntry(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("textarea, [contenteditable='true']")) return true;
  const input = target.closest("input");
  if (!input) return false;
  const type = (input.getAttribute("type") || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "radio",
    "range",
    "file",
    "submit",
    "reset",
    "color",
    "hidden",
    "image",
  ].includes(type);
}

function isStepKey(event) {
  if (STEP_KEYS.has(event.key)) return true;
  if (event.key === "Escape") return true;
  if (event.key === "j" || event.key === "J" || event.key === "k" || event.key === "K") {
    return Boolean(document.querySelector(".is-program-open"));
  }
  return false;
}

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function playAction(event) {
  if (reduced()) return;
  const volume = getActionVolume();
  if (volume <= 0) return;
  playWikiSound("pop", { volume, event });
}

export function initTickClicks() {
  if (isMobile()) return;

  let skipClickUntil = 0;
  let downX = 0;
  let downY = 0;
  let playedGesture = false;
  const TAP_PX = 14;
  const capture = { capture: true, passive: true };

  const unlockUnbinds = [];

  function stopUnlockListeners() {
    while (unlockUnbinds.length) {
      try {
        unlockUnbinds.pop()();
      } catch {
        // ignore
      }
    }
  }

  function unlock(event) {
    // Unlock only on tap/click. Key/wheel must not create a context.
    if (event && (event.type === "keydown" || event.type === "keyup" || event.type === "wheel")) {
      if (!hasAudioGesture() && !isWikiAudioRunning()) return;
    }
    if (isWikiAudioRunning()) {
      stopUnlockListeners();
      return;
    }
    warmWikiAudio(event);
    if (isWikiAudioRunning()) stopUnlockListeners();
  }

  function playOnce(event) {
    if (playedGesture) return false;
    playAction(event);
    // Desktop: consume this pointerdown/key even if resume() has not settled.
    // Waiting for `running` deferred the pop to click/mouseup.
    playedGesture = true;
    skipClickUntil = performance.now() + 700;
    return true;
  }

  function blockedTarget(target) {
    if (!target) return true;
    if (target.closest?.("[data-sound-settings]")) return true;
    if (isDisabledControl(target)) return true;
    return false;
  }

  // Tap/click only — never wheel, key, or move (those caused lag and ghost ticks).
  for (const type of ["pointerdown", "click"]) {
    const onUnlock = (event) => {
      if (!event.isTrusted) return;
      unlock(event);
    };
    document.addEventListener(type, onUnlock, capture);
    unlockUnbinds.push(() => document.removeEventListener(type, onUnlock, capture));
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isTrusted) return;
      if (event.button != null && event.button !== 0) return;
      downX = event.clientX;
      downY = event.clientY;
      playedGesture = false;
      unlock(event);
      const target = clickTarget(event);
      if (blockedTarget(target)) return;
      // Mouse: play on pointerdown. Click is skipped via skipClickUntil so
      // the pop is not deferred to mouseup.
      if (event.pointerType !== "mouse") return;
      playOnce(event);
    },
    true,
  );

  function onTapLift(event, x, y) {
    if (!event.isTrusted) return;
    unlock(event);
    if (playedGesture) return;
    if (Math.hypot((x ?? 0) - downX, (y ?? 0) - downY) > TAP_PX) return;
    const target = clickTarget(event);
    if (blockedTarget(target)) return;
    playOnce(event);
  }

  document.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches?.[0];
      onTapLift(event, touch?.clientX, touch?.clientY);
    },
    capture,
  );

  document.addEventListener(
    "pointerup",
    (event) => {
      if (event.pointerType === "mouse") return;
      if (event.button != null && event.button !== 0) return;
      onTapLift(event, event.clientX, event.clientY);
    },
    capture,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      if (event.button !== 0) return;
      if (performance.now() < skipClickUntil) return;
      const target = clickTarget(event);
      if (blockedTarget(target)) return;
      unlock(event);
      playOnce(event);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted) return;
      if (!hasAudioGesture() && !isWikiAudioRunning()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isStepKey(event)) return;
      const target = clickTarget(event);
      if (target && isTextEntry(target)) return;
      if (target && isDisabledControl(target)) return;
      if (target?.closest?.("input[type='range']")) return;
      if (target?.closest?.("[data-sound-settings]")) return;
      unlock(event);
      playedGesture = false;
      playOnce(event);
    },
    true,
  );
}
