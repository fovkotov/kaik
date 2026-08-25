/**
 * Deck params + live tweak panel.
 * Defaults to the mobile preset so flight can be tuned on a phone.
 */

import { getViewportSize, onFrameMetrics, safeStorage } from "./embed.js";

const storage = safeStorage();

export const DESKTOP = {
  scrollPerCard: 3250,
  travelMult: 1.1,
  progressGain: 3.65,
  speedStep: 0.125,
  speedMin: 0.06,
  ease: "inOutCubic",

  driftY: 29,
  tipScale: 0,
  rotateYBase: 0,
  rotateYStep: 0,
  rotateXAmt: 2.5,

  deckLeftPct: 58,
  deckRightPx: 304,
  deckScale: 1.15,
  /** 1 = max height that still fits the iframe; >1 grows past that fit. */
  cardSize: 1.4,
  travelDir: -1,

  parallaxX: 27,
  parallaxY: 28,
  cursorFalloff: 0.52,
  pointerLerp: 0.08,
  cursorTiltY: 5,
  cursorTiltX: 4,
  cursorTiltZ: 2,

  hoverLift: 22,
  hoverLerp: 0.18,

  worksShiftX: 110,
  worksShiftY: 0,
  worksRotate: 0,
};

export const MOBILE = {
  scrollPerCard: 1,
  travelMult: 5.2,
  progressGain: 2.7,
  speedStep: 0.08,
  speedMin: 0.07,
  ease: "linear",

  driftY: 18,
  tipScale: 2.55,
  rotateYBase: 0,
  rotateYStep: 0,
  rotateXAmt: 3,
  fanScale: 0.05,
  /** Multiplier on each card's data-base-rotate. 0 = straight, 1 = authored, >1 = more twist. */
  cardRotate: 1.7,
  /** Y lift per waiting slot (px). 0 = flat pile, higher = rear cards sit up. */
  stackLift: 3,
  /** Scale of the furthest waiting card (slot ≥ 5). Front is always 1. */
  rearScale: 0.41,
  /** Size curve back → front. 1 = linear; >1 front stays large longer. */
  scaleProgress: 0.5,

  deckLeftPct: 50,
  deckScale: 1,
  /** 1 = max height that still fits the iframe; 0.5–1.5 scales the whole stack. */
  cardSize: 1.07,
  travelDir: 0,

  parallaxX: 14,
  parallaxY: 10,
  cursorFalloff: 0.64,
  pointerLerp: 0.1,
  cursorTiltY: 5,
  cursorTiltX: 4,
  cursorTiltZ: 2,
  gyroRange: 28,

  hoverLift: 30,
  hoverLerp: 0.2,
  /** Higher = less finger travel per card (faster stack). */
  dragSensitivity: 3.35,
  /** Progress units the current card stays in focus (1 = one unit per card). */
  focusSpan: 1.25,
  /** Mobile stack exit: fade the leaving card, or fly it off to the left. */
  viewMode: "fly",
  /** Fly-left exit speed. 1 = current span; higher = leaves in less scroll. */
  flySpeed: 0.25,
  /** Peak toward-camera scale on fly-left (hold at end; never shrinks). */
  flyScale: 1.1,
  /** Fly-left arc peak Y in px (shallow dip). */
  flyArcY: 8,
  /** Fly-left distance as a multiple of the natural leave (viewport + card). */
  flyExitX: 0.9,

  /** Centered near-full-width card: a desktop X nudge would overflow the iframe. */
  worksShiftX: 0,
  worksShiftY: 0,
  worksRotate: 0,
};

const DESKTOP_DEFAULTS = { ...DESKTOP };
const MOBILE_DEFAULTS = { ...MOBILE };

export const MOBILE_MQ = "(max-width: 900px)";
const STORAGE_KEY = "kaik-deck-tweaks-v14";
const LEGACY_STORAGE_KEYS = [
  "kaik-deck-tweaks-v13",
  "kaik-deck-tweaks-v12",
  "kaik-deck-tweaks-v11",
  "kaik-deck-tweaks-v10",
  "kaik-deck-tweaks-v9",
  "kaik-deck-tweaks-v8",
  "kaik-deck-tweaks-v7",
  "kaik-deck-tweaks-v6",
  "kaik-deck-tweaks-v5",
  "kaik-deck-tweaks-v4",
  "kaik-deck-tweaks-v3",
];
const UI_STORAGE_KEY = "kaik-deck-tweaks-ui-v3";
/** Bump to force-write DESKTOP over a stale desktop blob. */
const DESKTOP_REV = 7;
const PREV_DESKTOP_REV = 6;

/** @type {"auto" | "desktop" | "mobile"} */
let editMode = "mobile";

export function isMobile() {
  return window.matchMedia(MOBILE_MQ).matches;
}

/** Loop twin of the landing card — mobile stack only; not a desktop slot. */
export function inDeckFlow(el) {
  return Boolean(el) && (isMobile() || !el.hasAttribute?.("data-deck-loop"));
}

export function normalizeViewMode(value) {
  return value === "fly" ? "fly" : "fade";
}

export function getParams() {
  return isMobile() ? MOBILE : DESKTOP;
}

function getEditTarget() {
  if (editMode === "desktop") return DESKTOP;
  if (editMode === "mobile") return MOBILE;
  return getParams();
}

function getEditDefaults() {
  if (editMode === "desktop") return DESKTOP_DEFAULTS;
  if (editMode === "mobile") return MOBILE_DEFAULTS;
  return isMobile() ? MOBILE_DEFAULTS : DESKTOP_DEFAULTS;
}

function getEditLabel() {
  if (editMode === "desktop") return "десктоп";
  if (editMode === "mobile") return "телефон";
  return isMobile() ? "телефон (авто)" : "десктоп (авто)";
}

const A4_ASPECT = 297 / 210;
const CARD_GUTTER = 12;
const A4_MAX_W = 490;

function readCardPoseExtents() {
  let maxRotate = 0;
  let maxBaseY = 0;
  let maxTip = 0;
  document.querySelectorAll("[data-card]").forEach((el) => {
    if (!inDeckFlow(el)) return;
    maxRotate = Math.max(maxRotate, Math.abs(Number(el.dataset.baseRotate) || 0));
    maxBaseY = Math.max(maxBaseY, Math.abs(Number(el.dataset.baseY) || 0));
    maxTip = Math.max(maxTip, Math.abs(Number(el.dataset.tip) || 0));
  });
  return { maxRotate, maxBaseY, maxTip };
}

function cardStageCenterY(frameH) {
  const sample = document.querySelector("[data-card]");
  if (!sample) return frameH / 2;
  const top = Number.parseFloat(getComputedStyle(sample).top);
  return Number.isFinite(top) ? top : frameH / 2;
}

/** Measure live footer height so card centering fits short Cargo iframes. */
export function syncPanelFooterHeight() {
  if (!isMobile()) return;
  const panel = document.querySelector("[data-panel]");
  if (!panel) return;
  const h = panel.getBoundingClientRect().height;
  if (h > 0) {
    document.documentElement.style.setProperty("--panel-footer-h", `${Math.ceil(h)}px`);
  }
}

let panelFooterObserver = null;

function observePanelFooter() {
  if (!isMobile() || panelFooterObserver) return;
  const panel = document.querySelector("[data-panel]");
  if (!panel) return;
  panelFooterObserver = new ResizeObserver(() => {
    syncPanelFooterHeight();
    syncCardMetrics();
  });
  panelFooterObserver.observe(panel);
}

function mobileFooterReserve(frameH) {
  const root = document.documentElement;
  const hostBar = Number.parseFloat(getComputedStyle(root).getPropertyValue("--host-bar")) || 0;
  /* Mobile footer panel is hidden — landing card carries nav; use nearly full frame. */
  return Math.max(48, frameH - hostBar - 16);
}

/**
 * Size A4 `--card-h` from the iframe so the visual box after deck scale,
 * max rotate, hover lift, and vertical toss stays inside `--frame-h`.
 * Square works-card uses the same `--card-h` (wider than A4 siblings).
 * Raising `deckScale` shrinks the card instead of overflowing.
 * `cardSize` then scales that max-fit height; 1 = current viewport fit.
 */
export function syncCardMetrics() {
  const p = getParams();
  const mobile = isMobile();
  const { width: frameW, height: frameH } = getViewportSize();
  if (frameW <= 0 || frameH <= 0) return;

  if (mobile) {
    const aspect = 450 / 320;
    const availH = mobileFooterReserve(frameH);
    let h = Math.min(320 * aspect, availH);
    let w = h / aspect;
    if (w > frameW) {
      w = Math.min(320, frameW);
      h = w * aspect;
      if (h > availH) {
        h = availH;
        w = h / aspect;
      }
    }
    const rawSize = Number(p.cardSize);
    const cardSize = Number.isFinite(rawSize)
      ? Math.min(MOBILE_CARD_SIZE.max, Math.max(MOBILE_CARD_SIZE.min, rawSize))
      : MOBILE_DEFAULTS.cardSize;
    w = Math.max(1, Math.round(w * cardSize * 100) / 100);
    h = Math.max(1, Math.round(h * cardSize * 100) / 100);
    const root = document.documentElement;
    root.style.setProperty("--card-h", `${h}px`);
    root.style.setProperty("--card-w", `${w}px`);
    root.style.setProperty("--stack-card-h", `${h}px`);
    root.style.setProperty("--stack-card-w", `${w}px`);
    return;
  }

  const scale = Math.max(0.5, Number(p.deckScale) || 1);
  const rawSize = Number(p.cardSize);
  const cardSize = Number.isFinite(rawSize) ? Math.min(3, Math.max(1, rawSize)) : 1;
  const { maxRotate, maxBaseY, maxTip } = readCardPoseExtents();
  const fan = mobile ? Number(p.fanScale) || 0.42 : 1;
  const rotZ =
    maxRotate * fan +
    maxTip * (Number(p.tipScale) || 0) +
    Math.abs(Number(p.cursorTiltZ) || 0) * 0.65 +
    Math.abs(Number(p.worksRotate) || 0);
  const theta = (Math.max(rotZ, 6) * Math.PI) / 180;
  const rotFactor = Math.abs(Math.sin(theta)) + Math.abs(Math.cos(theta));

  const hover = mobile ? 0 : Math.abs(Number(p.hoverLift) || 0);
  const parallax = Math.abs(Number(p.parallaxY) || 0);
  const drift = mobile
    ? 0
    : Math.abs(Number(p.driftY) || 0) * Math.max(1, Number(p.travelMult) || 1);
  const baseY = mobile ? 0 : maxBaseY * fan;
  const maxUp = hover + parallax + drift + baseY;
  const maxDown = parallax + drift + baseY;

  const centerY = cardStageCenterY(frameH);
  const halfFromUp = (centerY - CARD_GUTTER) / scale - maxUp;
  const halfFromDown = (frameH - centerY - CARD_GUTTER) / scale - maxDown;
  const half = Math.max(0, Math.min(halfFromUp, halfFromDown));
  let h = (2 * half) / rotFactor;

  const widthFrac = mobile ? 0.78 : 0.34;
  const widthGutter = mobile ? 32 : 48;
  const a4MaxH = Math.min(A4_MAX_W, frameW * widthFrac) * A4_ASPECT;
  const worksMaxH = Math.max(0, frameW / scale - widthGutter);
  h = Math.min(h, a4MaxH, worksMaxH) * cardSize;
  h = Math.max(1, Math.round(h * 100) / 100);

  const w = h / A4_ASPECT;
  const root = document.documentElement;
  root.style.setProperty("--card-h", `${h}px`);
  root.style.setProperty("--card-w", `${w}px`);
  root.style.setProperty("--stack-card-h", `${h}px`);
  root.style.setProperty("--stack-card-w", `${w}px`);
}

export function applyDeckParams() {
  const p = getParams();
  const mobile = isMobile();
  const scale = Number(p.deckScale);
  document.documentElement.classList.toggle("is-mobile", mobile);
  document.documentElement.dataset.viewMode = mobile ? normalizeViewMode(p.viewMode) : "fade";
  document.documentElement.style.setProperty(
    "--deck-scale",
    String(Number.isFinite(scale) ? scale : 1),
  );
  if (mobile) syncPanelFooterHeight();
  syncCardMetrics();
  if (mobile) {
    syncPanelFooterHeight();
    observePanelFooter();
  }
  document.querySelectorAll("[data-card]").forEach((card) => {
    if (!inDeckFlow(card)) return;
    if (card.hasAttribute("data-fly-lock") || card.classList.contains("is-fly-pinned")) return;
    // Desktop is right-pinned. Mobile stays centered at deckLeftPct 50
    // (left % + margin-left: -card-w/2); only a mobile slider moves it.
    if (mobile) {
      card.style.left = `${p.deckLeftPct ?? 50}%`;
      card.style.right = "";
    } else {
      card.style.left = "auto";
      card.style.right = `${p.deckRightPx ?? 304}px`;
    }
  });
  document.documentElement.style.setProperty("--scroll-per-card", String(p.scrollPerCard));

  const shiftX = Number(p.worksShiftX);
  const shiftY = Number(p.worksShiftY);
  const rotate = Number(p.worksRotate);
  const works = document.querySelector("[data-works-card]");
  if (works) {
    works.style.setProperty("--works-shift-x", `${Number.isFinite(shiftX) ? shiftX : 0}px`);
    works.style.setProperty("--works-shift-y", `${Number.isFinite(shiftY) ? shiftY : 0}px`);
    works.style.setProperty("--works-rotate", `${Number.isFinite(rotate) ? rotate : 0}deg`);
  }
}

export function easeByName(name, t) {
  switch (name) {
    case "linear":
      return t;
    case "inCubic":
      return t * t * t;
    case "outCubic":
      return 1 - (1 - t) ** 3;
    case "inOutQuad":
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case "inOutCubic":
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }
}

const STRIP_FIELDS = [
  { key: "cardRotate", label: "поворот карточек", min: 0, max: 3, step: 0.05 },
  { key: "fanScale", label: "веер", min: 0, max: 2, step: 0.05 },
  { key: "stackLift", label: "разложенность вверх", min: 0, max: 48, step: 1 },
  { key: "rearScale", label: "размер задней", min: 0.25, max: 1, step: 0.01 },
  { key: "scaleProgress", label: "прогрессия размера", min: 0.2, max: 3, step: 0.05 },
  { key: "dragSensitivity", label: "скорость скролла", min: 0.15, max: 4, step: 0.05 },
  { key: "focusSpan", label: "фокус карточки", min: 0.25, max: 4, step: 0.05 },
  { key: "flySpeed", label: "скорость улёта", min: 0.25, max: 4, step: 0.05 },
  { key: "flyScale", label: "масштаб налёта", min: 1, max: 1.8, step: 0.01 },
  { key: "flyArcY", label: "дуга Y", min: 0, max: 80, step: 1 },
  { key: "flyExitX", label: "вылет X", min: 0.4, max: 2.5, step: 0.05 },
];

const FIELDS = [
  {
    group: "Полёт",
    items: [
      {
        key: "dragSensitivity",
        label: "скорость скролла",
        min: 0.15,
        max: 4,
        step: 0.05,
        mobileOnly: true,
      },
      {
        key: "focusSpan",
        label: "фокус карточки",
        min: 0.25,
        max: 4,
        step: 0.05,
        mobileOnly: true,
      },
      {
        key: "scrollPerCard",
        label: "скролл на карточку (десктоп, px)",
        min: 50,
        max: 10000,
        step: 10,
        desktopOnly: true,
      },
      { key: "travelMult", label: "дальность полёта", min: 0.1, max: 20, step: 0.05 },
      { key: "progressGain", label: "лид (какая карточка в центре)", min: 0.1, max: 10, step: 0.05 },
      { key: "speedStep", label: "кривая замедления", min: 0, max: 1, step: 0.005 },
      { key: "speedMin", label: "скорость самой медленной", min: 0.01, max: 1, step: 0.01 },
      {
        key: "ease",
        label: "плавность",
        type: "select",
        options: [
          { value: "linear", label: "линейная" },
          { value: "inOutCubic", label: "кубическая туда-обратно" },
          { value: "outCubic", label: "кубическая на выход" },
          { value: "inCubic", label: "кубическая на вход" },
          { value: "inOutQuad", label: "квадратичная туда-обратно" },
        ],
      },
    ],
  },
  {
    group: "Стопка / наклон",
    items: [
      { key: "cardRotate", label: "поворот карточек", min: 0, max: 3, step: 0.05, mobileOnly: true },
      { key: "fanScale", label: "веер", min: 0, max: 2, step: 0.05, mobileOnly: true },
      { key: "stackLift", label: "разложенность вверх", min: 0, max: 48, step: 1, mobileOnly: true },
      { key: "rearScale", label: "размер задней", min: 0.25, max: 1, step: 0.01, mobileOnly: true },
      { key: "scaleProgress", label: "прогрессия размера", min: 0.2, max: 3, step: 0.05, mobileOnly: true },
      {
        key: "viewMode",
        label: "уход карточки",
        type: "select",
        mobileOnly: true,
        options: [
          { value: "fade", label: "затухание" },
          { value: "fly", label: "улет влево" },
        ],
      },
      {
        key: "flySpeed",
        label: "скорость улёта",
        min: 0.25,
        max: 4,
        step: 0.05,
        mobileOnly: true,
      },
      {
        key: "flyScale",
        label: "масштаб налёта",
        min: 1,
        max: 1.8,
        step: 0.01,
        mobileOnly: true,
      },
      {
        key: "flyArcY",
        label: "дуга Y",
        min: 0,
        max: 80,
        step: 1,
        mobileOnly: true,
      },
      {
        key: "flyExitX",
        label: "вылет X",
        min: 0.4,
        max: 2.5,
        step: 0.05,
        mobileOnly: true,
      },
      { key: "tipScale", label: "поворот кончика", min: 0, max: 12, step: 0.05 },
      { key: "rotateXAmt", label: "наклон rotateX (°)", min: 0, max: 120, step: 0.5 },
      { key: "deckLeftPct", label: "стопка слева %", min: 0, max: 100, step: 0.5, mobileOnly: true },
      { key: "deckRightPx", label: "стопка справа (px)", min: 0, max: 1200, step: 1, desktopOnly: true },
      { key: "deckScale", label: "масштаб стопки", min: 0.5, max: 2.8, step: 0.01 },
      { key: "cardSize", label: "размер карточек", min: 1, max: 3, step: 0.01 },
    ],
  },
];

function applyDesktopSaved(desktop) {
  if (!desktop) return;
  Object.assign(DESKTOP, desktop);
  if (desktop.travelMult == null || desktop.travelMult === 0.95) {
    DESKTOP.travelMult = DESKTOP_DEFAULTS.travelMult;
  }
  if (desktop.deckRightPx == null || desktop.deckRightPx === 56 || desktop.deckRightPx === 140) {
    DESKTOP.deckRightPx = DESKTOP_DEFAULTS.deckRightPx;
  }
  if (desktop.deckScale == null || desktop.deckScale === 1 || desktop.deckScale === 1.21) {
    DESKTOP.deckScale = DESKTOP_DEFAULTS.deckScale;
  }
  if (
    desktop.worksShiftX == null ||
    desktop.worksShiftX === 0 ||
    desktop.worksShiftX === 103 ||
    desktop.worksShiftX === 130 ||
    desktop.worksShiftX === 116
  ) {
    DESKTOP.worksShiftX = DESKTOP_DEFAULTS.worksShiftX;
  }
  if (desktop.cardSize == null || desktop.cardSize === 1.32 || desktop.cardSize === 1.29) {
    DESKTOP.cardSize = DESKTOP_DEFAULTS.cardSize;
  }
}

function desktopRevOk(rev) {
  return rev === DESKTOP_REV || rev === PREV_DESKTOP_REV;
}

function desktopNeedsPersist(data) {
  if (!data?.desktop) return false;
  if (data.desktopRev !== DESKTOP_REV) return true;
  return (
    data.desktop.cardSize == null ||
    data.desktop.cardSize === 1.32 ||
    data.desktop.cardSize === 1.29
  );
}

function isStaleMobileSnapshot(mobile) {
  if (!mobile) return false;
  return (
    mobile.scrollPerCard === 1100 ||
    mobile.fanScale === 0.7 ||
    mobile.fanScale === 0.28 ||
    mobile.fanScale === 0.12 ||
    mobile.ease === "outCubic" ||
    mobile.dragSensitivity === 0.1 ||
    (mobile.travelMult === 1 && mobile.dragSensitivity === 1.2 && mobile.peekPx === 16) ||
    (mobile.travelMult === 5 &&
      mobile.progressGain === 3.2 &&
      mobile.speedStep === 0.28 &&
      mobile.dragSensitivity === 0.35) ||
    (mobile.tipScale === 0.12 && mobile.fanScale === 0.42 && mobile.peekPx === 6) ||
    (mobile.speedMin === 0.28 && mobile.speedStep === 0.075) ||
    (mobile.flyScale === 1.28 && mobile.flyArcY === 28 && mobile.dragSensitivity === 2.85)
  );
}

function applyMobileSaved(mobile) {
  if (!mobile) return false;
  if (isStaleMobileSnapshot(mobile)) {
    Object.assign(MOBILE, MOBILE_DEFAULTS);
    return true;
  }
  Object.assign(MOBILE, mobile);
  for (const key of [
    "stackLift",
    "rearScale",
    "scaleProgress",
    "fanScale",
    "cardRotate",
    "dragSensitivity",
    "focusSpan",
    "flySpeed",
    "flyScale",
    "flyArcY",
    "flyExitX",
  ]) {
    if (!Number.isFinite(Number(MOBILE[key]))) MOBILE[key] = MOBILE_DEFAULTS[key];
  }
  MOBILE.viewMode = normalizeViewMode(MOBILE.viewMode);
  if (MOBILE.cardSize == null || MOBILE.cardSize === 1) {
    MOBILE.cardSize = MOBILE_DEFAULTS.cardSize;
    return true;
  }
  return false;
}

function applyEditMode(data) {
  if (data?.editMode === "auto" || data?.editMode === "desktop" || data?.editMode === "mobile") {
    editMode = data.editMode;
  }
}

function loadSaved() {
  let overwriteDesktop = true;
  let persist = false;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (applyMobileSaved(data.mobile)) persist = true;
      if (desktopRevOk(data.desktopRev) && data.desktop) {
        applyDesktopSaved(data.desktop);
        overwriteDesktop = false;
        if (desktopNeedsPersist(data)) persist = true;
      }
      applyEditMode(data);
    } else {
      // v14: new mobile fly defaults. Do not carry v13 mobile; desktop migrates as usual.
      persist = true;
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacyRaw = storage.getItem(key);
        if (!legacyRaw) continue;
        const legacy = JSON.parse(legacyRaw);
        if (desktopRevOk(legacy.desktopRev) && legacy.desktop) {
          applyDesktopSaved(legacy.desktop);
          overwriteDesktop = false;
        }
        applyEditMode(legacy);
        break;
      }
    }
  } catch {
    // ignore
  }

  if (overwriteDesktop) {
    Object.assign(DESKTOP, DESKTOP_DEFAULTS);
    persist = true;
  }
  if (persist) save();
}

function save() {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ desktop: DESKTOP, mobile: MOBILE, editMode, desktopRev: DESKTOP_REV }),
    );
  } catch {
    // ignore
  }
}

export const CARD_SIZE = { min: 1, max: 3, step: 0.01 };
/** Mobile stack scale: 1 = max-fit in iframe; lower shrinks the whole deck. */
export const MOBILE_CARD_SIZE = { min: 0.5, max: 1.5, step: 0.01 };

function cardSizeBounds() {
  return isMobile() ? MOBILE_CARD_SIZE : CARD_SIZE;
}

function clampCardSize(value) {
  const bounds = cardSizeBounds();
  const fallback = isMobile() ? MOBILE_DEFAULTS.cardSize : DESKTOP_DEFAULTS.cardSize;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(bounds.max, Math.max(bounds.min, n));
  return Number((Math.round(clamped / bounds.step) * bounds.step).toFixed(2));
}

export function getCardSize() {
  return clampCardSize(getParams().cardSize);
}

export function setCardSize(value) {
  const next = clampCardSize(value);
  getParams().cardSize = next;
  applyDeckParams();
  save();
  document.querySelectorAll('[data-param="cardSize"]').forEach((el) => {
    if (!(el instanceof HTMLInputElement)) return;
    el.value = String(next);
    const valueEl = el.closest(".tweaks__row")?.querySelector("[data-value]");
    if (valueEl) valueEl.textContent = formatValue("cardSize", next);
  });
  return next;
}

export function resetCardSize() {
  return setCardSize(isMobile() ? MOBILE_DEFAULTS.cardSize : DESKTOP_DEFAULTS.cardSize);
}

function formatValue(key, value) {
  if (typeof value === "string") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) || Math.abs(n) >= 10 ? String(Math.round(n * 100) / 100) : n.toFixed(2);
}

/** Dev board / gear: only with ?tweaks on the page URL. */
export function devTweaksEnabled() {
  try {
    return new URLSearchParams(window.location.search).has("tweaks");
  } catch {
    return false;
  }
}

/**
 * Load saved params, apply them, and mount the live panel.
 * @param {(params: typeof DESKTOP) => void} [onChange]
 */
export function initTweaks(onChange) {
  loadSaved();
  applyDeckParams();
  onFrameMetrics(() => applyDeckParams());

  if (!devTweaksEnabled()) return getParams();

  const root = document.createElement("aside");
  root.className = "tweaks";
  root.dataset.tweaks = "";
  root.innerHTML = `
    <div class="tweaks__bar">
      <button type="button" class="tweaks__toggle" data-tweaks-toggle aria-expanded="true">
        настройки полёта
      </button>
      <button type="button" class="tweaks__action" data-tweaks-reset>сброс</button>
      <button type="button" class="tweaks__action" data-tweaks-copy>копировать JSON</button>
      <button type="button" class="tweaks__action" data-tweaks-hide>скрыть</button>
    </div>
    <div class="tweaks__mode">
      <span class="tweaks__mode-label">править</span>
      <button type="button" class="tweaks__mode-btn" data-mode="auto">авто</button>
      <button type="button" class="tweaks__mode-btn" data-mode="desktop">десктоп</button>
      <button type="button" class="tweaks__mode-btn" data-mode="mobile">телефон</button>
      <span class="tweaks__mode-current" data-mode-current></span>
    </div>
    <div class="tweaks__body" data-tweaks-body></div>
  `;

  const reopen = document.createElement("button");
  reopen.type = "button";
  reopen.className = "tweaks-reopen is-hidden";
  reopen.dataset.tweaksReopen = "";
  reopen.hidden = true;
  reopen.textContent = "настройки";
  reopen.setAttribute("aria-hidden", "true");

  const strip = document.createElement("aside");
  strip.className = "deck-tune is-collapsed";
  strip.dataset.deckTune = "";
  strip.innerHTML = `
    <div class="deck-tune__bar">
      <div class="deck-tune__views" role="tablist" aria-label="Режим стопки">
        <button type="button" class="deck-tune__view" data-view-mode="fade" role="tab">затухание</button>
        <button type="button" class="deck-tune__view" data-view-mode="fly" role="tab">улет влево</button>
      </div>
      <button type="button" class="deck-tune__reset" data-deck-tune-copy>JSON</button>
      <button type="button" class="deck-tune__reset" data-deck-tune-reset>сброс</button>
      <button type="button" class="deck-tune__hide" data-deck-tune-hide aria-expanded="true">
        скрыть
      </button>
    </div>
    <div class="deck-tune__body" data-deck-tune-body></div>
  `;
  const stripBody = strip.querySelector("[data-deck-tune-body]");

  const body = root.querySelector("[data-tweaks-body]");

  function buildFields() {
    body.innerHTML = "";
    const target = getEditTarget();
    const frag = document.createDocumentFragment();
    const editingMobile = editMode === "mobile" || (editMode === "auto" && isMobile());

    FIELDS.forEach((group) => {
      const section = document.createElement("section");
      section.className = "tweaks__group";
      section.innerHTML = `<h3 class="tweaks__group-title">${group.group}</h3>`;
      const grid = document.createElement("div");
      grid.className = "tweaks__grid";

      group.items.forEach((field) => {
        if (field.mobileOnly && !editingMobile) return;
        if (field.desktopOnly && editingMobile) return;
        if (!(field.key in target)) return;

        const row = document.createElement("label");
        row.className = "tweaks__row";
        row.dataset.key = field.key;

        if (field.type === "select") {
          row.innerHTML = `
            <span class="tweaks__label">${field.label}</span>
            <select class="tweaks__select" data-param="${field.key}">
              ${field.options
                .map(
                  (opt) =>
                    `<option value="${opt.value}"${target[field.key] === opt.value ? " selected" : ""}>${opt.label}</option>`,
                )
                .join("")}
            </select>
          `;
        } else {
          row.innerHTML = `
            <span class="tweaks__label">${field.label}</span>
            <span class="tweaks__value" data-value>${formatValue(field.key, target[field.key])}</span>
            <input
              class="tweaks__range"
              type="range"
              data-param="${field.key}"
              min="${field.min}"
              max="${field.max}"
              step="${field.step}"
              value="${target[field.key]}"
            />
          `;
        }
        grid.append(row);
      });

      if (!grid.children.length) return;
      section.append(grid);
      frag.append(section);
    });

    body.append(frag);
  }

  function buildStrip() {
    stripBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    STRIP_FIELDS.forEach((field) => {
      const row = document.createElement("label");
      row.className = "tweaks__row";
      row.dataset.key = field.key;
      row.innerHTML = `
        <span class="tweaks__label">${field.label}</span>
        <span class="tweaks__value" data-value>${formatValue(field.key, MOBILE[field.key])}</span>
        <input
          class="tweaks__range"
          type="range"
          data-param="${field.key}"
          min="${field.min}"
          max="${field.max}"
          step="${field.step}"
          value="${MOBILE[field.key]}"
        />
      `;
      frag.append(row);
    });
    stripBody.append(frag);
  }

  function syncModeButtons() {
    root.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-mode") === editMode);
    });
    const current = root.querySelector("[data-mode-current]");
    if (current) current.textContent = getEditLabel();
  }

  function syncViewButtons() {
    const mode = normalizeViewMode(MOBILE.viewMode);
    strip.querySelectorAll("[data-view-mode]").forEach((btn) => {
      const on = btn.getAttribute("data-view-mode") === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  function readUiState() {
    try {
      return JSON.parse(storage.getItem(UI_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeUiState(patch) {
    try {
      storage.setItem(UI_STORAGE_KEY, JSON.stringify({ ...readUiState(), ...patch }));
    } catch {
      // ignore
    }
  }

  function setHidden(hidden) {
    root.classList.toggle("is-hidden", hidden);
    root.setAttribute("aria-hidden", String(hidden));
    reopen.classList.add("is-hidden");
    reopen.setAttribute("aria-hidden", "true");
    writeUiState({ hidden });
  }

  function setCollapsed(collapsed) {
    root.classList.toggle("is-collapsed", collapsed);
    root.querySelector("[data-tweaks-toggle]").setAttribute("aria-expanded", String(!collapsed));
    writeUiState({ collapsed });
  }

  function setStripCollapsed(collapsed) {
    strip.classList.toggle("is-collapsed", collapsed);
    const hideBtn = strip.querySelector("[data-deck-tune-hide]");
    if (hideBtn) hideBtn.setAttribute("aria-expanded", String(!collapsed));
    writeUiState({ stripCollapsed: collapsed });
  }

  function notify() {
    applyDeckParams();
    save();
    onChange?.(getParams());
  }

  buildFields();
  buildStrip();
  syncModeButtons();
  syncViewButtons();
  document.body.append(root);
  document.body.append(reopen);
  document.body.append(strip);

  const ui = readUiState();
  if (ui.collapsed === true || (ui.collapsed == null && isMobile())) setCollapsed(true);
  setStripCollapsed(true);
  setHidden(false);

  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  reopen.addEventListener("pointerdown", (event) => event.stopPropagation());
  strip.addEventListener("pointerdown", (event) => event.stopPropagation());

  function applyParamInput(el, target) {
    const key = el.dataset.param;
    if (!key || !(key in target)) return false;
    if (el instanceof HTMLSelectElement) {
      target[key] = el.value;
    } else {
      target[key] = Number(el.value);
      const valueEl = el.closest(".tweaks__row")?.querySelector("[data-value]");
      if (valueEl) valueEl.textContent = formatValue(key, target[key]);
    }
    return true;
  }

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    if (!applyParamInput(el, getEditTarget())) return;
    if (getEditTarget() === MOBILE) {
      if (el.dataset.param === "viewMode") MOBILE.viewMode = normalizeViewMode(el.value);
      buildStrip();
      syncViewButtons();
    }
    notify();
  });

  strip.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!applyParamInput(el, MOBILE)) return;
    notify();
  });

  root.querySelector("[data-tweaks-toggle]").addEventListener("click", (event) => {
    event.stopPropagation();
    setCollapsed(!root.classList.contains("is-collapsed"));
  });

  root.querySelector("[data-tweaks-hide]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHidden(true);
  });

  reopen.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHidden(false);
  });

  root.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      editMode = btn.getAttribute("data-mode") || "mobile";
      syncModeButtons();
      buildFields();
      save();
      notify();
    });
  });

  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    if (editMode === "auto") {
      syncModeButtons();
      buildFields();
    }
    applyDeckParams();
    onChange?.(getParams());
  });

  root.querySelector("[data-tweaks-reset]").addEventListener("click", () => {
    Object.assign(getEditTarget(), getEditDefaults());
    buildFields();
    buildStrip();
    syncViewButtons();
    notify();
  });

  strip.querySelectorAll("[data-view-mode]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      MOBILE.viewMode = normalizeViewMode(btn.getAttribute("data-view-mode"));
      syncViewButtons();
      buildFields();
      notify();
    });
  });

  strip.querySelector("[data-deck-tune-reset]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Object.assign(MOBILE, MOBILE_DEFAULTS);
    buildFields();
    buildStrip();
    syncViewButtons();
    notify();
  });

  strip.querySelector("[data-deck-tune-hide]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setStripCollapsed(true);
  });

  function showJsonFallback(text) {
    let box = strip.querySelector("[data-deck-tune-json]");
    if (!box) {
      box = document.createElement("div");
      box.className = "deck-tune__json";
      box.dataset.deckTuneJson = "";
      box.innerHTML = `
        <textarea class="deck-tune__json-text" readonly rows="8"></textarea>
        <button type="button" class="deck-tune__reset" data-deck-tune-json-close>закрыть</button>
      `;
      stripBody.prepend(box);
      box.querySelector("[data-deck-tune-json-close]").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        box.hidden = true;
      });
    }
    const ta = box.querySelector("textarea");
    ta.value = text;
    box.hidden = false;
    ta.focus();
    ta.select();
  }

  strip.querySelector("[data-deck-tune-copy]").addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget;
    const text = JSON.stringify(MOBILE, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = "скопировано";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    } catch {
      showJsonFallback(text);
    }
  });

  root.querySelector("[data-tweaks-copy]").addEventListener("click", async () => {
    const text = JSON.stringify(getEditTarget(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      const btn = root.querySelector("[data-tweaks-copy]");
      const prev = btn.textContent;
      btn.textContent = "скопировано";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    } catch {
      window.prompt("Copy tweaks JSON:", text);
    }
  });

  return getParams();
}
