/**
 * Stage nudge defaults (no UI). Desktop chrome matches Figma 117:975;
 * stage JSON stays lift 64 / lockup X 2 / nav·lang Y 0 / stack Y 44 /
 * focus Y 9 / scale 0.93. Mobile keeps the 110 global lift.
 */

import { onFrameMetrics, safeStorage } from "./embed.js";
import { CARD_SIZE, isMobile, MOBILE_MQ } from "./tweaks.js";

const storage = safeStorage();
const STORAGE_KEY = "kaik-stage-nudge-v6";
const LEGACY_KEYS = [
  "kaik-stage-nudge-v5",
  "kaik-stage-nudge-v4",
  "kaik-stage-nudge-v3",
  "kaik-stage-nudge-v2",
  "kaik-stage-nudge-v1",
];

const AXIS = { min: -240, max: 240, step: 1 };
const FOCUS_AXIS = { min: -400, max: 400, step: 1 };
const FOCUS_SCALE = { min: 0.5, max: 2, step: 0.01 };

export const DESKTOP_STAGE_DEFAULTS = {
  lift: 64,
  lockupX: 2,
  lockupY: 0,
  navX: 0,
  navY: 0,
  langX: 0,
  langY: 0,
  deckX: 0,
  deckY: 44,
  focusX: 0,
  focusY: 9,
  focusScale: 0.93,
  closeX: 0,
  closeY: 0,
};

/** Previous published defaults (lockup X 0 / nav·lang Y 18). */
const PREV_DESKTOP_DEFAULTS = {
  lift: 64,
  lockupX: 0,
  lockupY: 0,
  navX: 0,
  navY: 18,
  langX: 0,
  langY: 18,
  deckX: 0,
  deckY: 44,
  focusX: 0,
  focusY: 9,
  focusScale: 0.93,
  closeX: 0,
  closeY: 0,
};

/** Older uncustomized snapshots — treat as uncustomized too. */
const PREV_DESKTOP_ALSO = {
  lift: [0, 80],
  deckY: [0],
  focusY: [0, -47],
  focusScale: [1],
};

export const MOBILE_STAGE_DEFAULTS = {
  lift: 110,
  lockupX: 0,
  lockupY: 0,
  navX: 0,
  navY: 0,
  langX: 0,
  langY: 0,
  deckX: 0,
  deckY: 0,
  focusX: 0,
  focusY: 0,
  focusScale: 1,
  closeX: 0,
  closeY: 0,
};

const GROUPS = [
  {
    titleKey: "stage.group.all",
    items: [{ key: "lift", labelKey: "stage.lift", min: -40, max: 280, step: 1 }],
  },
  {
    titleKey: "stage.group.cards",
    desktopOnly: true,
    items: [
      {
        key: "cardSize",
        labelKey: "stage.cardScale",
        source: "tweaks",
        ...CARD_SIZE,
      },
    ],
  },
  {
    titleKey: "stage.group.lockup",
    items: [
      { key: "lockupX", labelKey: "stage.axisX", ...AXIS },
      { key: "lockupY", labelKey: "stage.axisY", ...AXIS },
    ],
  },
  {
    titleKey: "stage.group.nav",
    items: [
      { key: "navX", labelKey: "stage.axisX", ...AXIS },
      { key: "navY", labelKey: "stage.axisY", ...AXIS },
    ],
  },
  {
    titleKey: "stage.group.lang",
    desktopOnly: true,
    items: [
      { key: "langX", labelKey: "stage.axisX", ...AXIS },
      { key: "langY", labelKey: "stage.axisY", ...AXIS },
    ],
  },
  {
    titleKey: "stage.group.deck",
    items: [
      { key: "deckX", labelKey: "stage.axisX", ...AXIS },
      { key: "deckY", labelKey: "stage.axisY", ...AXIS },
    ],
  },
  {
    titleKey: "stage.group.focus",
    desktopOnly: true,
    items: [
      { key: "focusX", labelKey: "stage.axisX", ...FOCUS_AXIS },
      { key: "focusY", labelKey: "stage.axisY", ...FOCUS_AXIS },
      { key: "focusScale", labelKey: "stage.focusScale", ...FOCUS_SCALE },
    ],
  },
  {
    titleKey: "stage.group.close",
    desktopOnly: true,
    items: [
      { key: "closeX", labelKey: "stage.axisX", ...AXIS },
      { key: "closeY", labelKey: "stage.axisY", ...AXIS },
    ],
  },
];

const FIELD_BY_KEY = new Map(GROUPS.flatMap((group) => group.items.map((item) => [item.key, item])));

const desktop = { ...DESKTOP_STAGE_DEFAULTS };
const mobile = { ...MOBILE_STAGE_DEFAULTS };

function fieldDecimals(field) {
  const step = String(field?.step ?? 1);
  return step.includes(".") ? step.split(".")[1].length : 0;
}

function clampField(key, value) {
  const field = FIELD_BY_KEY.get(key);
  const n = Number(value);
  if (!field || !Number.isFinite(n)) return 0;
  const clamped = Math.min(field.max, Math.max(field.min, n));
  const step = field.step || 1;
  const rounded = Math.round(clamped / step) * step;
  return Number(rounded.toFixed(fieldDecimals(field)));
}

function getTarget() {
  return isMobile() ? mobile : desktop;
}

function migrateLegacy(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const next = { ...blob };
  if (next.navX == null && next.chromeX != null) next.navX = next.chromeX;
  if (next.navY == null && next.chromeY != null) next.navY = next.chromeY;
  return next;
}

function previousDefaultValues(key) {
  const values = [PREV_DESKTOP_DEFAULTS[key]];
  const extra = PREV_DESKTOP_ALSO[key];
  if (extra) values.push(...extra);
  return values;
}

function migrateOldDesktopDefaults(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const next = { ...blob };
  for (const key of Object.keys(DESKTOP_STAGE_DEFAULTS)) {
    if (next[key] == null) continue;
    const fresh = DESKTOP_STAGE_DEFAULTS[key];
    if (previousDefaultValues(key).includes(next[key]) && next[key] !== fresh) {
      next[key] = fresh;
    }
  }
  return next;
}

function loadSaved() {
  try {
    let raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_KEYS) {
        raw = storage.getItem(key);
        if (raw) break;
      }
    }
    if (!raw) return;
    const data = JSON.parse(raw);
    const desktopBlob = migrateOldDesktopDefaults(migrateLegacy(data.desktop));
    applyBlob(desktop, desktopBlob, DESKTOP_STAGE_DEFAULTS);
    applyBlob(mobile, migrateLegacy(data.mobile), MOBILE_STAGE_DEFAULTS);
    save();
  } catch {
    // ignore
  }
}

function applyBlob(target, blob, defaults) {
  if (!blob || typeof blob !== "object") return;
  for (const key of Object.keys(defaults)) {
    if (blob[key] == null) continue;
    target[key] = clampField(key, blob[key]);
  }
}

function save() {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ desktop, mobile }));
  } catch {
    // ignore
  }
}

export function getFocusNudge() {
  const s = getTarget();
  return { x: Number(s.focusX) || 0, y: Number(s.focusY) || 0 };
}

export function getFocusScale() {
  return clampField("focusScale", getTarget().focusScale) || 1;
}

export function applyStageNudge({ notify = false } = {}) {
  const s = getTarget();
  const root = document.documentElement;
  root.style.setProperty("--stage-lift", `${s.lift}px`);
  root.style.setProperty("--lockup-nudge-x", `${s.lockupX}px`);
  root.style.setProperty("--lockup-nudge-y", `${s.lockupY}px`);
  root.style.setProperty("--nav-nudge-x", `${s.navX}px`);
  root.style.setProperty("--nav-nudge-y", `${s.navY}px`);
  root.style.setProperty("--lang-nudge-x", `${s.langX}px`);
  root.style.setProperty("--lang-nudge-y", `${s.langY}px`);
  root.style.setProperty("--deck-nudge-x", `${s.deckX}px`);
  root.style.setProperty("--deck-nudge-y", `${s.deckY}px`);
  root.style.setProperty("--focus-nudge-x", `${s.focusX}px`);
  root.style.setProperty("--focus-nudge-y", `${s.focusY}px`);
  root.style.setProperty("--close-nudge-x", `${s.closeX}px`);
  root.style.setProperty("--close-nudge-y", `${s.closeY}px`);
  if (notify) {
    document.dispatchEvent(new CustomEvent("kaik:stage-nudge"));
  }
}

export function initStageSettings() {
  document.querySelector("[data-stage-settings]")?.remove();
  document.querySelectorAll(".stage-settings, .stage-settings__fab").forEach((el) => {
    el.remove();
  });
  loadSaved();
  applyStageNudge();
  onFrameMetrics(() => applyStageNudge());
  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    applyStageNudge({ notify: true });
  });
}
