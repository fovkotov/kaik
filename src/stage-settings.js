/**
 * Stage nudge panel (desktop + mobile gear). Desktop chrome sits in the left
 * half of the frame (Figma 117:975), under cards. Cluster X/Y are optional
 * overrides on top of that geometry (default X -90). Mobile: lift → footer, deck → stack.
 */

import { getViewportSize, onFrameMetrics, safeStorage } from "./embed.js";
import { t } from "./scriptik.js";
import {
  CARD_SIZE,
  getCardSize,
  isMobile,
  MOBILE_CARD_SIZE,
  MOBILE_MQ,
  resetCardSize,
  setCardSize,
} from "./tweaks.js";

const storage = safeStorage();
const STORAGE_KEY = "kaik-stage-nudge-v7";
const LEGACY_KEYS = [
  "kaik-stage-nudge-v5",
  "kaik-stage-nudge-v4",
  "kaik-stage-nudge-v3",
  "kaik-stage-nudge-v2",
  "kaik-stage-nudge-v1",
];

const AXIS = { min: -240, max: 240, step: 1 };
const MOBILE_CARD_Y = { min: -120, max: 280, step: 1 };
const FOCUS_AXIS = { min: -400, max: 400, step: 1 };
const FOCUS_SCALE = { min: 0.5, max: 2, step: 0.01 };

export const DESKTOP_STAGE_DEFAULTS = {
  lift: 64,
  lockupX: 0,
  lockupY: 0,
  navX: 0,
  navY: 0,
  langX: 0,
  langY: 0,
  deckX: 59,
  deckY: 44,
  focusX: 0,
  focusY: 9,
  focusScale: 0.93,
  closeX: 0,
  closeY: 0,
  clusterX: -90,
  clusterY: 0,
  clusterLinked: 1,
};

/** Previous published defaults (deck X 0, cluster X 0). Stored 0 → 59. */
const PREV_DESKTOP_DEFAULTS = {
  lift: 64,
  lockupX: 0,
  lockupY: 0,
  navX: 0,
  navY: 0,
  langX: 0,
  langY: 0,
  deckX: 0,
  focusX: 0,
  focusY: 9,
  focusScale: 0.93,
  closeX: 0,
  closeY: 0,
  clusterX: 0,
  clusterY: 0,
  clusterLinked: 1,
};

const CLUSTER_KEYS = new Set(["clusterX", "clusterY", "clusterLinked"]);

/** Older uncustomized snapshots — treat as uncustomized too. */
const PREV_DESKTOP_ALSO = {
  lift: [0, 80],
  lockupX: [2],
  navY: [18],
  langY: [18],
  focusY: [0, -47],
  focusScale: [1],
  clusterX: [-65],
};

export const MOBILE_STAGE_DEFAULTS = {
  lift: 146,
  lockupX: 0,
  lockupY: 0,
  navX: 0,
  navY: 0,
  langX: 0,
  langY: 0,
  deckX: 0,
  deckY: 71,
  focusX: 0,
  focusY: 0,
  focusScale: 1,
  closeX: 0,
  closeY: 0,
};

/** Previous published mobile defaults (lift 110, deck Y 81). */
const PREV_MOBILE_DEFAULTS = {
  lift: 110,
  lockupX: 0,
  lockupY: 0,
  navX: 0,
  navY: 0,
  langX: 0,
  langY: 0,
  deckX: 0,
  deckY: 81,
  focusX: 0,
  focusY: 0,
  focusScale: 1,
  closeX: 0,
  closeY: 0,
};

const GROUPS = [
  {
    titleKey: "stage.group.all",
    mobileTitleKey: "stage.group.footer",
    items: [
      {
        key: "lift",
        labelKey: "stage.lift",
        mobileLabelKey: "stage.footerY",
        min: -40,
        max: 280,
        step: 1,
      },
    ],
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
    titleKey: "stage.group.text",
    desktopOnly: true,
    items: [
      {
        key: "clusterLinked",
        type: "toggle",
        labelKey: "stage.textPos",
        min: 0,
        max: 1,
        step: 1,
      },
      { key: "clusterX", labelKey: "stage.axisX", linkedOnly: true, ...AXIS },
      { key: "clusterY", labelKey: "stage.axisY", linkedOnly: true, ...AXIS },
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
    mobileTitleKey: "stage.group.cards",
    items: [
      { key: "deckX", labelKey: "stage.axisX", ...AXIS },
      {
        key: "deckY",
        labelKey: "stage.axisY",
        mobileLabelKey: "stage.cardY",
        ...AXIS,
        mobileMin: MOBILE_CARD_Y.min,
        mobileMax: MOBILE_CARD_Y.max,
        mobileStep: MOBILE_CARD_Y.step,
      },
      {
        key: "cardSize",
        labelKey: "stage.cardScale",
        source: "tweaks",
        mobileOnly: true,
        ...MOBILE_CARD_SIZE,
      },
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

const DESKTOP_PINNED_GROUPS = new Set([
  "stage.group.all",
  "stage.group.cards",
  "stage.group.deck",
  "stage.group.text",
]);
const MOBILE_PINNED_GROUPS = new Set(["stage.group.all", "stage.group.deck"]);

const FIELD_BY_KEY = new Map(GROUPS.flatMap((group) => group.items.map((item) => [item.key, item])));

const desktop = { ...DESKTOP_STAGE_DEFAULTS };
const mobile = { ...MOBILE_STAGE_DEFAULTS };

/** Custom FAB position per breakpoint; null = CSS default (top-right). */
const fabPos = { desktop: null, mobile: null };

const FAB_EDGE = 8;
const FAB_TOP_GAP = 0;
const PREV_FAB_TOP_GAP = 8;
const FAB_TOP_TOLERANCE = 3;
const FAB_DRAG_THRESHOLD = 8;
const FAB_LONG_PRESS_MS = 300;
const PANEL_GAP = 8;
const PANEL_EDGE = 8;
const PANEL_MIN_HEIGHT = 140;

function fieldDecimals(field, mobile = isMobile()) {
  const step = String(fieldBounds(field, mobile).step ?? 1);
  return step.includes(".") ? step.split(".")[1].length : 0;
}

function fieldBounds(field, mobile = isMobile()) {
  if (mobile && field?.mobileMin != null) {
    return {
      min: field.mobileMin,
      max: field.mobileMax ?? field.max,
      step: field.mobileStep ?? field.step,
    };
  }
  return { min: field?.min, max: field?.max, step: field?.step };
}

function clampField(key, value, mobile = isMobile()) {
  const field = FIELD_BY_KEY.get(key);
  const n = Number(value);
  if (!field || !Number.isFinite(n)) return 0;
  const { min, max, step = 1 } = fieldBounds(field, mobile);
  const clamped = Math.min(max, Math.max(min, n));
  const rounded = Math.round(clamped / step) * step;
  return Number(rounded.toFixed(fieldDecimals(field, mobile)));
}

function formatFieldValue(key, value) {
  const field = FIELD_BY_KEY.get(key);
  const decimals = fieldDecimals(field);
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return decimals ? n.toFixed(decimals) : String(n);
}

function getTarget() {
  return isMobile() ? mobile : desktop;
}

function getDefaults() {
  return isMobile() ? MOBILE_STAGE_DEFAULTS : DESKTOP_STAGE_DEFAULTS;
}

function isTweakField(key) {
  return FIELD_BY_KEY.get(key)?.source === "tweaks";
}

function readField(key) {
  if (key === "cardSize") return getCardSize();
  return getTarget()[key];
}

function writeField(key, value) {
  if (key === "cardSize") return setCardSize(value);
  const next = clampField(key, value);
  getTarget()[key] = next;
  return next;
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

function migrateClusterDefaults(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const next = { ...blob };
  const x = next.clusterX == null ? null : Number(next.clusterX);
  const y = next.clusterY == null ? null : Number(next.clusterY);
  const prevX = previousDefaultValues("clusterX");
  if (next.clusterX == null || (Number.isFinite(x) && prevX.includes(x))) {
    next.clusterX = DESKTOP_STAGE_DEFAULTS.clusterX;
  }
  if (next.clusterY == null) {
    next.clusterY = DESKTOP_STAGE_DEFAULTS.clusterY;
  } else if (Number.isFinite(y) && previousDefaultValues("clusterY").includes(y)) {
    next.clusterY = DESKTOP_STAGE_DEFAULTS.clusterY;
  }
  if (next.clusterLinked == null) {
    next.clusterLinked = DESKTOP_STAGE_DEFAULTS.clusterLinked;
  }
  return next;
}

function migrateOldDesktopDefaults(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const next = { ...blob };
  if (next.deckY == null) next.deckY = DESKTOP_STAGE_DEFAULTS.deckY;
  for (const key of Object.keys(DESKTOP_STAGE_DEFAULTS)) {
    if (CLUSTER_KEYS.has(key)) continue;
    if (next[key] == null) continue;
    const fresh = DESKTOP_STAGE_DEFAULTS[key];
    if (previousDefaultValues(key).includes(next[key]) && next[key] !== fresh) {
      next[key] = fresh;
    }
  }
  return migrateClusterDefaults(next);
}

function migrateOldMobileDefaults(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const next = { ...blob };
  for (const key of Object.keys(MOBILE_STAGE_DEFAULTS)) {
    if (next[key] == null) continue;
    const fresh = MOBILE_STAGE_DEFAULTS[key];
    const prev = PREV_MOBILE_DEFAULTS[key];
    if (prev != null && next[key] === prev && next[key] !== fresh) {
      next[key] = fresh;
    }
  }
  return next;
}

function readFabPos(blob) {
  if (!blob || typeof blob !== "object") return null;
  const x = Number(blob.x);
  const y = Number(blob.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function getFabPos() {
  return isMobile() ? fabPos.mobile : fabPos.desktop;
}

function setFabPos(next) {
  if (isMobile()) fabPos.mobile = next;
  else fabPos.desktop = next;
}

function loadFabPos(data) {
  if (!data || typeof data !== "object") return;
  fabPos.desktop = readFabPos(data.desktop);
  fabPos.mobile = readFabPos(data.mobile);
}

function frameClipInsets() {
  const rootStyle = getComputedStyle(document.documentElement);
  return {
    top: parseFloat(rootStyle.getPropertyValue("--frame-clip-top")) || 0,
    bottom: parseFloat(rootStyle.getPropertyValue("--frame-clip-bottom")) || 0,
  };
}

function readSafeAreaTop() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const inset = probe.offsetTop || 0;
  probe.remove();
  return inset;
}

function fabTopInset(mobile = isMobile()) {
  if (!mobile) return FAB_TOP_GAP;
  return FAB_TOP_GAP + readSafeAreaTop();
}

function prevFabTopInset(mobile) {
  if (!mobile) return PREV_FAB_TOP_GAP;
  return Math.max(PREV_FAB_TOP_GAP, readSafeAreaTop());
}

function fabDefaultPos(mobile, { prev = false } = {}) {
  const { width } = getViewportSize();
  const { top: clipTop } = frameClipInsets();
  const fabW = mobile ? 44 : 40;
  const right = mobile ? 12 : FAB_EDGE;
  const inset = prev ? prevFabTopInset(mobile) : fabTopInset(mobile);
  return {
    x: width - fabW - right,
    y: clipTop + inset,
  };
}

function fabPosNearDefault(pos, mobile, { prev = false } = {}) {
  const def = fabDefaultPos(mobile, { prev });
  return (
    Math.abs(pos.x - def.x) <= FAB_TOP_TOLERANCE &&
    Math.abs(pos.y - def.y) <= FAB_TOP_TOLERANCE
  );
}

function migrateFabDefaults(data) {
  if (!data || typeof data !== "object") return data;
  const next = { ...data };
  for (const [key, mobile] of [
    ["desktop", false],
    ["mobile", true],
  ]) {
    const pos = readFabPos(next[key]);
    if (pos && fabPosNearDefault(pos, mobile, { prev: true })) {
      next[key] = null;
    }
  }
  return next;
}

function clampFabPos(x, y, fabEl) {
  const { width, height } = getViewportSize();
  const fabRect = fabEl.getBoundingClientRect();
  const fabW = fabRect.width || (isMobile() ? 44 : 40);
  const fabH = fabRect.height || fabW;
  const { top: clipTop, bottom: clipBottom } = frameClipInsets();
  const minX = FAB_EDGE;
  const minY = clipTop + fabTopInset();
  const maxX = Math.max(minX, width - fabW - FAB_EDGE);
  const maxY = Math.max(minY, height - clipBottom - fabH - FAB_EDGE);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

function applyFabPos(root, fabEl) {
  const pos = getFabPos();
  if (!pos) {
    root.classList.remove("is-fab-custom");
    root.style.removeProperty("left");
    root.style.removeProperty("top");
    root.style.removeProperty("right");
    return;
  }
  const clamped = clampFabPos(pos.x, pos.y, fabEl);
  if (clamped.x !== pos.x || clamped.y !== pos.y) setFabPos(clamped);
  root.classList.add("is-fab-custom");
  root.style.left = `${clamped.x}px`;
  root.style.top = `${clamped.y}px`;
  root.style.right = "auto";
}

function layoutPanel(root, fabEl, panelEl) {
  if (!root.classList.contains("is-open")) {
    root.classList.remove("is-panel-above");
    panelEl.style.removeProperty("max-height");
    return;
  }

  const { height: vh } = getViewportSize();
  const { top: clipTop, bottom: clipBottom } = frameClipInsets();
  const fabRect = fabEl.getBoundingClientRect();
  const spaceBelow = vh - clipBottom - fabRect.bottom - PANEL_GAP - PANEL_EDGE;
  const spaceAbove = fabRect.top - clipTop - PANEL_GAP - PANEL_EDGE;

  let openAbove = false;
  if (spaceBelow < PANEL_MIN_HEIGHT) {
    openAbove = spaceAbove >= PANEL_MIN_HEIGHT;
  } else {
    openAbove = spaceAbove > spaceBelow;
  }

  root.classList.toggle("is-panel-above", openAbove);
  const maxH = Math.max(PANEL_MIN_HEIGHT, openAbove ? spaceAbove : spaceBelow);
  panelEl.style.maxHeight = `${maxH}px`;
}

function clearFabPos() {
  fabPos.desktop = null;
  fabPos.mobile = null;
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
    applyBlob(mobile, migrateOldMobileDefaults(migrateLegacy(data.mobile)), MOBILE_STAGE_DEFAULTS);
    loadFabPos(migrateFabDefaults(data.fab));
    save();
  } catch {
    // ignore
  }
}

function applyBlob(target, blob, defaults) {
  if (!blob || typeof blob !== "object") return;
  const mobile = defaults === MOBILE_STAGE_DEFAULTS;
  for (const key of Object.keys(defaults)) {
    if (blob[key] == null) continue;
    target[key] = clampField(key, blob[key], mobile);
  }
}

function save() {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        desktop,
        mobile,
        fab: { desktop: fabPos.desktop, mobile: fabPos.mobile },
      }),
    );
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

function deckNudgeY(s = getTarget()) {
  const y = Number(s.deckY);
  if (Number.isFinite(y)) return y;
  return isMobile() ? 0 : DESKTOP_STAGE_DEFAULTS.deckY;
}

export function applyStageNudge({ notify = false } = {}) {
  const s = getTarget();
  const root = document.documentElement;
  const mobile = isMobile();
  const nudgeX = Number(s.deckX) || 0;
  const nudgeY = deckNudgeY(s);
  root.style.setProperty("--stage-lift", `${s.lift}px`);
  root.style.setProperty("--lockup-nudge-x", `${s.lockupX}px`);
  root.style.setProperty("--lockup-nudge-y", `${s.lockupY}px`);
  root.style.setProperty("--cluster-nudge-x", `${Number(s.clusterX) || 0}px`);
  root.style.setProperty("--cluster-nudge-y", `${Number(s.clusterY) || 0}px`);
  root.style.setProperty("--nav-nudge-x", `${s.navX}px`);
  root.style.setProperty("--nav-nudge-y", `${s.navY}px`);
  root.style.setProperty("--lang-nudge-x", `${s.langX}px`);
  root.style.setProperty("--lang-nudge-y", `${s.langY}px`);
  root.style.setProperty("--deck-nudge-x", `${nudgeX}px`);
  root.style.setProperty("--deck-nudge-y", `${nudgeY}px`);
  root.style.setProperty("--focus-nudge-x", `${s.focusX}px`);
  root.style.setProperty("--focus-nudge-y", `${s.focusY}px`);
  root.style.setProperty("--close-nudge-x", `${s.closeX}px`);
  root.style.setProperty("--close-nudge-y", `${s.closeY}px`);
  const deckEl = document.querySelector("[data-deck]");
  if (deckEl) {
    deckEl.style.left = `${nudgeX}px`;
    deckEl.style.top = mobile
      ? `calc(var(--frame-clip-top) + ${nudgeY}px)`
      : `calc(var(--frame-clip-top) - var(--stage-lift) + ${nudgeY}px)`;
  }
  if (notify) {
    document.dispatchEvent(new CustomEvent("kaik:stage-nudge"));
  }
}

function layoutJson() {
  const s = getTarget();
  const deck = { x: s.deckX, y: deckNudgeY(s) };

  const cluster = { linked: Boolean(s.clusterLinked) };
  if (cluster.linked) {
    cluster.x = s.clusterX;
    cluster.y = s.clusterY;
  }

  return {
    lift: s.lift,
    lockup: { x: s.lockupX, y: s.lockupY },
    nav: { x: s.navX, y: s.navY },
    lang: { x: s.langX, y: s.langY },
    deck,
    focus: { x: s.focusX, y: s.focusY },
    close: { x: s.closeX, y: s.closeY },
    cluster,
    cardSize: getCardSize(),
    focusScale: clampField("focusScale", s.focusScale),
    mobileLift: mobile.lift,
  };
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("clipboard unavailable"));
}

function copyViaTextarea(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function gearSvg() {
  return `
    <svg class="stage-settings__icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 7.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Zm7.1 3.15-.95-.16a6.1 6.1 0 0 0-.5-1.2l.55-.8a.7.7 0 0 0-.08-.88l-1.13-1.13a.7.7 0 0 0-.88-.08l-.8.55c-.38-.2-.78-.37-1.2-.5l-.16-.95A.7.7 0 0 0 11.2 5H8.8a.7.7 0 0 0-.69.55l-.16.95c-.42.13-.82.3-1.2.5l-.8-.55a.7.7 0 0 0-.88.08L3.94 7.66a.7.7 0 0 0-.08.88l.55.8c-.2.38-.37.78-.5 1.2l-.95.16A.7.7 0 0 0 2.4 11.2v2.4a.7.7 0 0 0 .56.69l.95.16c.13.42.3.82.5 1.2l-.55.8a.7.7 0 0 0 .08.88l1.13 1.13a.7.7 0 0 0 .88.08l.8-.55c.38.2.78.37 1.2.5l.16.95a.7.7 0 0 0 .69.55h2.4a.7.7 0 0 0 .69-.55l.16-.95c.42-.13.82-.3 1.2-.5l.8.55a.7.7 0 0 0 .88-.08l1.13-1.13a.7.7 0 0 0 .08-.88l-.55-.8c.2-.38.37-.78.5-1.2l.95-.16a.7.7 0 0 0 .56-.69v-2.4a.7.7 0 0 0-.56-.69Z"
      />
    </svg>
  `;
}

function wireFabDrag(fab, root, { onTap, onDragStart } = {}) {
  let drag = null;

  function clearDrag() {
    if (!drag) return;
    window.clearTimeout(drag.timer);
    fab.classList.remove("is-dragging", "is-drag-armed");
    fab.releasePointerCapture?.(drag.pointerId);
    drag = null;
  }

  function beginDrag(pointerId) {
    if (drag?.active) return;
    const rect = root.getBoundingClientRect();
    drag.active = true;
    drag.originLeft = rect.left;
    drag.originTop = rect.top;
    fab.classList.add("is-dragging");
    fab.classList.remove("is-drag-armed");
    window.clearTimeout(drag.timer);
    onDragStart?.();
    fab.setPointerCapture?.(pointerId);
  }

  fab.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearDrag();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      timer: window.setTimeout(() => beginDrag(event.pointerId), FAB_LONG_PRESS_MS),
    };
    fab.classList.add("is-drag-armed");
    fab.setPointerCapture?.(event.pointerId);
  });

  fab.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD) return;
      beginDrag(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
    const next = clampFabPos(drag.originLeft + dx, drag.originTop + dy, fab);
    root.classList.add("is-fab-custom");
    root.style.left = `${next.x}px`;
    root.style.top = `${next.y}px`;
    root.style.right = "auto";
  });

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDrag = drag.active;
    if (wasDrag) {
      event.preventDefault();
      event.stopPropagation();
      const rect = root.getBoundingClientRect();
      const next = clampFabPos(rect.left, rect.top, fab);
      setFabPos(next);
      applyFabPos(root, fab);
      save();
    } else {
      onTap?.();
    }
    clearDrag();
  }

  fab.addEventListener("pointerup", finishDrag);
  fab.addEventListener("pointercancel", (event) => {
    if (drag?.active && event.pointerId === drag.pointerId) {
      const rect = root.getBoundingClientRect();
      setFabPos(clampFabPos(rect.left, rect.top, fab));
      applyFabPos(root, fab);
      save();
    }
    clearDrag();
  });

  fab.addEventListener("lostpointercapture", () => {
    fab.classList.remove("is-dragging", "is-drag-armed");
  });

  fab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

export function initStageSettings() {
  document.querySelector("[data-stage-settings]")?.remove();
  loadSaved();
  applyStageNudge();

  const root = document.createElement("aside");
  root.className = "stage-settings";
  root.dataset.stageSettings = "";
  root.dataset.tweaks = "";
  root.innerHTML = `
    <button
      type="button"
      class="stage-settings__fab"
      data-stage-open
      aria-expanded="false"
      data-i18n-aria="stage.settings"
      aria-label="${t("stage.settings")}"
    >
      ${gearSvg()}
    </button>
    <div class="stage-settings__panel" data-stage-panel>
      <div class="stage-settings__bar">
        <h2 class="stage-settings__title" data-i18n="stage.title">${t("stage.title")}</h2>
        <div class="stage-settings__actions">
          <button type="button" class="stage-settings__copy" data-stage-copy data-i18n="stage.copyJson">
            ${t("stage.copyJson")}
          </button>
          <button type="button" class="stage-settings__reset" data-stage-reset data-i18n="stage.reset">
            ${t("stage.reset")}
          </button>
        </div>
      </div>
      <div class="stage-settings__pinned" data-stage-pinned></div>
      <div class="stage-settings__body" data-stage-body></div>
    </div>
  `;

  const fab = root.querySelector("[data-stage-open]");
  const panel = root.querySelector("[data-stage-panel]");
  const pinned = root.querySelector("[data-stage-pinned]");
  const body = root.querySelector("[data-stage-body]");
  const copyBtn = root.querySelector("[data-stage-copy]");
  let copiedTimer = 0;

  function pinnedGroups() {
    return isMobile() ? MOBILE_PINNED_GROUPS : DESKTOP_PINNED_GROUPS;
  }

  function clusterLinked() {
    return Boolean(desktop.clusterLinked);
  }

  function visibleGroups() {
    const mobileView = isMobile();
    const linked = !mobileView && clusterLinked();
    return GROUPS.filter((group) => {
      if (group.desktopOnly && mobileView) return false;
      if (group.mobileOnly && !mobileView) return false;
      if (mobileView && (group.titleKey === "stage.group.lockup" || group.titleKey === "stage.group.nav")) {
        return false;
      }
      if (linked && (group.titleKey === "stage.group.lockup" || group.titleKey === "stage.group.nav" || group.titleKey === "stage.group.lang")) {
        return false;
      }
      return true;
    });
  }

  function groupTitleKey(group) {
    return isMobile() && group.mobileTitleKey ? group.mobileTitleKey : group.titleKey;
  }

  function fieldLabelKey(field) {
    return isMobile() && field.mobileLabelKey ? field.mobileLabelKey : field.labelKey;
  }

  function renderGroup(group) {
    const titleKey = groupTitleKey(group);
    const section = document.createElement("section");
    section.className = "stage-settings__group";
    section.innerHTML = `<h3 class="stage-settings__group-title" data-i18n="${titleKey}">${t(titleKey)}</h3>`;
    const linked = clusterLinked();
    group.items.forEach((field) => {
      if (field.mobileOnly && !isMobile()) return;
      if (field.desktopOnly && isMobile()) return;
      if (field.linkedOnly && !linked) return;
      const value = readField(field.key);
      const labelKey = fieldLabelKey(field);
      const row = document.createElement("label");
      if (field.type === "toggle") {
        row.className = "stage-settings__switch";
        row.innerHTML = `
          <span class="stage-settings__label" data-i18n="${labelKey}">${t(labelKey)}</span>
          <input
            type="checkbox"
            data-nudge="${field.key}"
            ${value ? "checked" : ""}
          />
          <span class="stage-settings__switch-ui" aria-hidden="true"></span>
        `;
      } else {
        const bounds = fieldBounds(field);
        row.className = "stage-settings__row";
        row.innerHTML = `
          <span class="stage-settings__label" data-i18n="${labelKey}">${t(labelKey)}</span>
          <span class="stage-settings__value" data-value>${formatFieldValue(field.key, value)}</span>
          <input
            class="stage-settings__range"
            type="range"
            data-nudge="${field.key}"
            min="${bounds.min}"
            max="${bounds.max}"
            step="${bounds.step}"
            value="${value}"
          />
        `;
      }
      section.append(row);
    });
    return section;
  }

  function buildFields() {
    pinned.innerHTML = "";
    body.innerHTML = "";
    const pinFrag = document.createDocumentFragment();
    const bodyFrag = document.createDocumentFragment();
    const pinnedSet = pinnedGroups();
    visibleGroups().forEach((group) => {
      const section = renderGroup(group);
      if (pinnedSet.has(group.titleKey)) pinFrag.append(section);
      else bodyFrag.append(section);
    });
    pinned.append(pinFrag);
    body.append(bodyFrag);
    pinned.hidden = !pinned.childElementCount;
  }

  function setOpen(open) {
    root.classList.toggle("is-open", open);
    fab.setAttribute("aria-expanded", String(open));
    panel.inert = !open;
    if (open) {
      requestAnimationFrame(() => layoutPanel(root, fab, panel));
    } else {
      layoutPanel(root, fab, panel);
    }
  }

  function syncValues() {
    root.querySelectorAll("[data-nudge]").forEach((el) => {
      const key = el.dataset.nudge;
      if (!key || (!isTweakField(key) && !(key in getTarget()))) return;
      const value = readField(key);
      if (el.type === "checkbox") {
        el.checked = Boolean(value);
        return;
      }
      el.value = String(value);
      const valueEl = el.closest(".stage-settings__row")?.querySelector("[data-value]");
      if (valueEl) valueEl.textContent = formatFieldValue(key, value);
    });
  }

  function markCopied() {
    window.clearTimeout(copiedTimer);
    copyBtn.removeAttribute("data-i18n");
    copyBtn.textContent = t("stage.copied");
    copiedTimer = window.setTimeout(() => {
      copyBtn.setAttribute("data-i18n", "stage.copyJson");
      copyBtn.textContent = t("stage.copyJson");
    }, 1200);
  }

  async function copyLayout() {
    const text = JSON.stringify(layoutJson());
    try {
      await copyText(text);
      markCopied();
    } catch {
      if (copyViaTextarea(text)) markCopied();
    }
  }

  buildFields();
  document.body.append(root);
  setOpen(false);
  applyFabPos(root, fab);

  onFrameMetrics(() => {
    applyStageNudge();
    applyFabPos(root, fab);
    layoutPanel(root, fab, panel);
  });

  const stopDeck = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stopDeck);
  root.addEventListener("touchstart", stopDeck, { passive: true });
  root.addEventListener("wheel", stopDeck, { capture: true, passive: true });

  wireFabDrag(fab, root, {
    onTap: () => setOpen(!root.classList.contains("is-open")),
    onDragStart: () => setOpen(false),
  });

  root.querySelector("[data-stage-reset]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Object.assign(getTarget(), getDefaults());
    resetCardSize();
    clearFabPos();
    applyFabPos(root, fab);
    buildFields();
    applyStageNudge({ notify: true });
    save();
  });

  copyBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    copyLayout();
  });

  panel.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;
    const key = el.dataset.nudge;
    if (!key || (!isTweakField(key) && !(key in getTarget()))) return;
    const raw = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
    const next = writeField(key, raw);
    const valueEl = el.closest(".stage-settings__row")?.querySelector("[data-value]");
    if (valueEl) valueEl.textContent = formatFieldValue(key, next);
    if (key === "clusterLinked") buildFields();
    if (!isTweakField(key)) {
      applyStageNudge({ notify: true });
      save();
    }
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      if (!root.classList.contains("is-open")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    },
    true,
  );

  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    applyStageNudge({ notify: true });
    applyFabPos(root, fab);
    buildFields();
    layoutPanel(root, fab, panel);
  });
}
