import { playUISound } from "./ui-sounds.js";
import { playWikiSound, probeWikiAutoplay, warmWikiAudio } from "./wiki-sounds.js";
import { playSnd, playSoundcn, warmClipAudio } from "./clip-sounds.js";
import { unlockHtmlAudio } from "./gesture-audio.js";
import { getActionVolume } from "./sound-volume.js";
import { safeStorage } from "../embed.js";

export const ACTION_STORAGE_KEY = "kaik-action-sound-v1";
export const SCROLL_STORAGE_KEY = "kaik-scroll-sound-v1";
export const SCROLL_PX_KEY = "kaik-scroll-px-v1";
export const DEFAULT_ACTION_ID = "wiki:pop";
export const DEFAULT_SCROLL_ID = "wiki:pop";
export const SCROLL_PX_MIN = 20;
export const SCROLL_PX_MAX = 800;
/** Live scroll handler fires every 100px with no time throttle. */
export const SCROLL_PX_DEFAULT = 100;

const storage = safeStorage();

export const SOUND_OPTIONS = [
  { id: "wiki:pop", group: "wiki", labelKey: "sound.wiki.pop", kind: "wiki", name: "pop" },
  { id: "wiki:tick", group: "wiki", labelKey: "sound.wiki.tick", kind: "wiki", name: "tick" },
  { id: "wiki:click", group: "wiki", labelKey: "sound.wiki.click", kind: "wiki", name: "click" },
  { id: "wiki:whoosh", group: "wiki", labelKey: "sound.wiki.whoosh", kind: "wiki", name: "whoosh" },
  { id: "wiki:toggle", group: "wiki", labelKey: "sound.wiki.toggle", kind: "wiki", name: "toggle" },
  { id: "wiki:success", group: "wiki", labelKey: "sound.wiki.success", kind: "wiki", name: "success" },
  { id: "wiki:confirm", group: "wiki", labelKey: "sound.wiki.confirm", kind: "wiki", name: "confirm" },
  { id: "wiki:error", group: "wiki", labelKey: "sound.wiki.error", kind: "wiki", name: "error" },
  { id: "wiki:warning", group: "wiki", labelKey: "sound.wiki.warning", kind: "wiki", name: "warning" },
  { id: "deslop:tick", group: "deslop", labelKey: "sound.deslop.tick", kind: "deslop", name: "tick" },
  { id: "deslop:press", group: "deslop", labelKey: "sound.deslop.press", kind: "deslop", name: "press" },
  { id: "deslop:click", group: "deslop", labelKey: "sound.deslop.click", kind: "deslop", name: "click" },
  { id: "soundcn:belt-handle-1", group: "soundcn", kind: "soundcn", name: "belt-handle-1", label: "belt-handle-1" },
  { id: "soundcn:belt-handle-2", group: "soundcn", kind: "soundcn", name: "belt-handle-2", label: "belt-handle-2" },
  { id: "soundcn:cloth-1", group: "soundcn", kind: "soundcn", name: "cloth-1", label: "cloth-1" },
  { id: "soundcn:cloth-2", group: "soundcn", kind: "soundcn", name: "cloth-2", label: "cloth-2" },
  { id: "soundcn:cloth-3", group: "soundcn", kind: "soundcn", name: "cloth-3", label: "cloth-3" },
  { id: "soundcn:cloth-4", group: "soundcn", kind: "soundcn", name: "cloth-4", label: "cloth-4" },
  { id: "soundcn:cloth-belt", group: "soundcn", kind: "soundcn", name: "cloth-belt", label: "cloth-belt" },
  { id: "soundcn:cloth-belt-2", group: "soundcn", kind: "soundcn", name: "cloth-belt-2", label: "cloth-belt-2" },
  { id: "soundcn:drop-003", group: "soundcn", kind: "soundcn", name: "drop-003", label: "drop-003" },
  { id: "soundcn:drop-leather", group: "soundcn", kind: "soundcn", name: "drop-leather", label: "drop-leather" },
  { id: "soundcn:handle-coins", group: "soundcn", kind: "soundcn", name: "handle-coins", label: "handle-coins" },
  { id: "soundcn:handle-coins-2", group: "soundcn", kind: "soundcn", name: "handle-coins-2", label: "handle-coins-2" },
  { id: "soundcn:handle-small-leather", group: "soundcn", kind: "soundcn", name: "handle-small-leather", label: "handle-small-leather" },
  { id: "soundcn:handle-small-leather-2", group: "soundcn", kind: "soundcn", name: "handle-small-leather-2", label: "handle-small-leather-2" },
  { id: "snd:button", group: "snd", kind: "snd", name: "button", label: "button" },
  { id: "snd:caution", group: "snd", kind: "snd", name: "caution", label: "caution" },
  { id: "snd:celebration", group: "snd", kind: "snd", name: "celebration", label: "celebration" },
  { id: "snd:disabled", group: "snd", kind: "snd", name: "disabled", label: "disabled" },
  { id: "snd:notification", group: "snd", kind: "snd", name: "notification", label: "notification" },
  { id: "snd:select", group: "snd", kind: "snd", name: "select", label: "select" },
  { id: "snd:swipe", group: "snd", kind: "snd", name: "swipe", label: "swipe" },
  { id: "snd:tap_01", group: "snd", kind: "snd", name: "tap_01", label: "tap 1" },
  { id: "snd:tap_02", group: "snd", kind: "snd", name: "tap_02", label: "tap 2" },
  { id: "snd:tap_03", group: "snd", kind: "snd", name: "tap_03", label: "tap 3" },
  { id: "snd:tap_04", group: "snd", kind: "snd", name: "tap_04", label: "tap 4" },
  { id: "snd:tap_05", group: "snd", kind: "snd", name: "tap_05", label: "tap 5" },
  { id: "snd:toggle_off", group: "snd", kind: "snd", name: "toggle_off", label: "toggle off" },
  { id: "snd:toggle_on", group: "snd", kind: "snd", name: "toggle_on", label: "toggle on" },
  { id: "snd:transition_down", group: "snd", kind: "snd", name: "transition_down", label: "transition down" },
  { id: "snd:transition_up", group: "snd", kind: "snd", name: "transition_up", label: "transition up" },
];

export const SOUND_GROUPS = [
  ["wiki", "sound.group.wiki"],
  ["deslop", "sound.group.deslop"],
  ["soundcn", "sound.group.soundcn"],
  ["snd", "sound.group.snd"],
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function findSoundOption(id) {
  return SOUND_OPTIONS.find((opt) => opt.id === id) || null;
}

function readId(key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (findSoundOption(raw)) return raw;
  } catch {
    // Third-party iframe storage may still throw.
  }
  return fallback;
}

function writeId(key, id) {
  try {
    storage.setItem(key, id);
  } catch {
    // ignore
  }
}

let actionId = readId(ACTION_STORAGE_KEY, DEFAULT_ACTION_ID);
let scrollId = readId(SCROLL_STORAGE_KEY, DEFAULT_SCROLL_ID);
let scrollPx = readScrollPxStored();

function readScrollPxStored() {
  try {
    const raw = storage.getItem(SCROLL_PX_KEY);
    if (raw == null || raw === "") return SCROLL_PX_DEFAULT;
    const next = Number(raw);
    if (!Number.isFinite(next)) return SCROLL_PX_DEFAULT;
    return Math.round(clamp(next, SCROLL_PX_MIN, SCROLL_PX_MAX));
  } catch {
    return SCROLL_PX_DEFAULT;
  }
}

export function getActionSoundId() {
  return actionId;
}

export function getScrollSoundId() {
  return scrollId;
}

export function getScrollPx() {
  return scrollPx;
}

export function setActionSoundId(id) {
  if (!findSoundOption(id)) return actionId;
  actionId = id;
  writeId(ACTION_STORAGE_KEY, id);
  return actionId;
}

export function setScrollSoundId(id) {
  if (!findSoundOption(id)) return scrollId;
  scrollId = id;
  writeId(SCROLL_STORAGE_KEY, id);
  return scrollId;
}

export function setScrollPx(px) {
  scrollPx = Math.round(clamp(Number(px), SCROLL_PX_MIN, SCROLL_PX_MAX));
  if (!Number.isFinite(scrollPx)) scrollPx = SCROLL_PX_DEFAULT;
  try {
    storage.setItem(SCROLL_PX_KEY, String(scrollPx));
  } catch {
    // ignore
  }
  return scrollPx;
}

export function formatScrollPx(px) {
  return `${Math.round(clamp(Number(px) || SCROLL_PX_DEFAULT, SCROLL_PX_MIN, SCROLL_PX_MAX))}px`;
}

export function playSoundOption(opt, volume = getActionVolume(), extra = {}) {
  if (reduced()) return;
  if (!opt || volume <= 0) return;
  if (opt.kind === "wiki") {
    playWikiSound(opt.name, { volume, ...extra });
    return;
  }
  if (opt.kind === "deslop") {
    playUISound(opt.name, volume);
    return;
  }
  if (opt.kind === "soundcn") {
    playSoundcn(opt.name, volume);
    return;
  }
  if (opt.kind === "snd") {
    playSnd(opt.name, volume);
  }
}

export function playActionSound(extra = {}) {
  if (reduced()) return;
  const volume = getActionVolume();
  if (volume <= 0) return;
  playSoundOption(findSoundOption(actionId) || findSoundOption(DEFAULT_ACTION_ID), volume, extra);
}

export function playScrollSound(extra = {}) {
  if (reduced()) return;
  const volume = getActionVolume();
  if (volume <= 0) return;
  playSoundOption(findSoundOption(scrollId) || findSoundOption(DEFAULT_SCROLL_ID), volume, extra);
}

export function playFlySound(extra = {}) {
  if (reduced()) return;
  const volume = getActionVolume();
  if (volume <= 0) return;
  playWikiSound("whoosh", { volume, queue: true, ...extra });
}

export function playArriveSound(extra = {}) {
  if (reduced()) return;
  const volume = getActionVolume();
  if (volume <= 0) return;
  playWikiSound("pop", { volume, queue: true, ...extra });
}

let uiContextWarmed = false;
let firstScrollFromGesture = false;
let storageAccessTried = false;

function selectedKinds() {
  const action = findSoundOption(actionId) || findSoundOption(DEFAULT_ACTION_ID);
  const scroll = findSoundOption(scrollId) || findSoundOption(DEFAULT_SCROLL_ID);
  return new Set([action?.kind, scroll?.kind]);
}

export function warmAllAudio(event) {
  // iOS only — desktop HTMLAudio.play() spends the wheel/keydown activation.
  unlockHtmlAudio();
  const kinds = selectedKinds();
  if (kinds.has("wiki")) warmWikiAudio(event);
  if (kinds.has("soundcn") || kinds.has("snd")) warmClipAudio(event);
  if (!kinds.has("deslop") || uiContextWarmed) return;
  uiContextWarmed = true;
  try {
    playUISound("tick", 0);
  } catch {
    // ui-sounds lazy-inits; a 0-intensity call only resumes that context.
  }
}

/** Resume now even if autoplay later rejects. Safe on load / fly start. */
export function tryUnlockAllAudio(event) {
  if (!event) {
    // Fly / load: probe autoplay, never leave a suspended context behind.
    probeWikiAutoplay();
    return;
  }
  warmAllAudio(event);
  if (!storageAccessTried && typeof document.hasStorageAccess === "function") {
    storageAccessTried = true;
    try {
      void document.hasStorageAccess().then((ok) => {
        if (ok) warmAllAudio();
      });
    } catch {
      // Storage Access is a hint, not required for playback.
    }
  }
}

/** First wheel/drag: resume + start pop in this same turn. Do not await. */
export function playFirstScrollFromGesture(event) {
  if (reduced()) return false;
  if (firstScrollFromGesture) return false;
  warmAllAudio(event);
  firstScrollFromGesture = true;
  // Play in this gesture or skip — never queue for a late touchend dump.
  playScrollSound({ event });
  return true;
}
