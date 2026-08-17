import { playSound } from "./lib/sound-engine.ts";
import { drop003Sound } from "./lib/drop-003.ts";

/** Controls that already play press/click/tap/select/toggle, soundcn, or wiki preview. */
const ALREADY_SOUNDING =
  "[data-sound-play], [data-sound-cn], [data-sound-wiki], [data-sound-snd], [data-sound-open], [data-sound-close], [data-sound-settings] button, [data-sound-settings] a, [data-sound-settings] [role='button']";

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
  playSound(drop003Sound.dataUri, { volume: 0.5 }).catch(() => {});
}

export function initTickClicks() {
  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      if (event.button !== 0) return;
      const target = clickTarget(event);
      if (!target) return;
      if (target.closest(ALREADY_SOUNDING)) return;
      if (isDisabledControl(target)) return;
      playAction();
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
      playAction();
    },
    true,
  );
}
