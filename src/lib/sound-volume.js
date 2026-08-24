import { safeStorage } from "../embed.js";

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;
export const VOLUME_DEFAULT = 0.5;
/** One global scale so production is 1.8× quieter than stored / default gain. */
export const VOLUME_PLAYBACK_SCALE = 5 / 9;
export const SLIDER_MIN = 0;
export const SLIDER_MAX = 100;
export const STORAGE_KEY = "kaik-sound-volume-v3";

const storage = safeStorage();
let current = readStored();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readStored() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return VOLUME_DEFAULT;
    const next = Number(raw);
    if (!Number.isFinite(next)) return VOLUME_DEFAULT;
    return clamp(next, VOLUME_MIN, VOLUME_MAX);
  } catch {
    return VOLUME_DEFAULT;
  }
}

/**
 * Quadratic map so the bottom half of the track covers 0–0.5,
 * and the full travel covers 0–2. Quiet settings stay adjustable.
 */
export function sliderToVolume(pos) {
  const t = clamp(Number(pos), SLIDER_MIN, SLIDER_MAX) / SLIDER_MAX;
  if (!Number.isFinite(t) || t <= 0) return VOLUME_MIN;
  return VOLUME_MAX * t * t;
}

export function volumeToSlider(volume) {
  const v = clamp(Number(volume), VOLUME_MIN, VOLUME_MAX);
  if (!Number.isFinite(v) || v <= 0) return SLIDER_MIN;
  return Math.round(Math.sqrt(v / VOLUME_MAX) * SLIDER_MAX);
}

export function formatVolumePercent(volume) {
  const v = Number.isFinite(volume) ? volume : VOLUME_DEFAULT;
  return `${Math.round(clamp(v, VOLUME_MIN, VOLUME_MAX) * 100)}%`;
}

export function getActionVolume() {
  return current * VOLUME_PLAYBACK_SCALE;
}

export function setActionVolume(volume) {
  const next = Number(volume);
  current = Number.isFinite(next) ? clamp(next, VOLUME_MIN, VOLUME_MAX) : VOLUME_DEFAULT;
  try {
    storage.setItem(STORAGE_KEY, String(current));
  } catch {
    // Third-party iframe storage may still throw after the probe.
  }
  return current;
}
