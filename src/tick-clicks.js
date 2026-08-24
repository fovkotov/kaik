import { isWikiAudioRunning, playWikiSound, warmWikiAudio } from "./lib/wiki-sounds.js";
import { getActionVolume } from "./lib/sound-volume.js";

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

function playAction() {
  if (reduced()) return;
  const volume = getActionVolume();
  if (volume <= 0) return;
  playWikiSound("pop", { volume });
}

function isImmediateControl(target) {
  return Boolean(
    target.closest?.(
      "a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], summary, label, input, select, [data-work-nav], [data-program-nav], [data-fly-close], [data-article-close], [data-open-program], [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings]",
    ),
  );
}

export function initTickClicks() {
  let skipClickUntil = 0;
  let downX = 0;
  let downY = 0;
  let playedGesture = false;
  const TAP_PX = 14;
  const capture = { capture: true, passive: true };

  function unlock() {
    warmWikiAudio();
  }

  function playOnce() {
    if (playedGesture) return false;
    playAction();
    // iOS: pointerdown often starts oscillators on a still-suspended context.
    // Don't consume the later touchend/click that actually unlocks.
    if (!isWikiAudioRunning()) return false;
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

  function onUnlockEvent(event) {
    if (!event.isTrusted) return;
    unlock();
  }

  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "keydown", "click"]) {
    document.addEventListener(type, onUnlockEvent, capture);
    window.addEventListener(type, onUnlockEvent, capture);
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isTrusted) return;
      if (event.button != null && event.button !== 0) return;
      downX = event.clientX;
      downY = event.clientY;
      playedGesture = false;
      unlock();
      const target = clickTarget(event);
      if (blockedTarget(target)) return;
      if (!isImmediateControl(target)) return;
      // Mouse: play here for snappy desktop clicks. Touch/pen: wait for
      // touchend — that is the WebKit user-activation event. Empty
      // pointerType on iOS must not play-and-skip the later unlock.
      if (event.pointerType !== "mouse") return;
      playOnce();
    },
    true,
  );

  function onTapLift(event, x, y) {
    if (!event.isTrusted) return;
    unlock();
    if (playedGesture) return;
    if (Math.hypot((x ?? 0) - downX, (y ?? 0) - downY) > TAP_PX) return;
    const target = clickTarget(event);
    if (blockedTarget(target)) return;
    playOnce();
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
      unlock();
      playOnce();
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isStepKey(event)) return;
      const target = clickTarget(event);
      if (target && isTextEntry(target)) return;
      if (target && isDisabledControl(target)) return;
      if (target?.closest?.("input[type='range']")) return;
      if (target?.closest?.("[data-sound-settings]")) return;
      unlock();
      playedGesture = false;
      playOnce();
    },
    true,
  );
}
