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
  deckRightPx: 209,
  deckScale: 1.15,
  /** 1 = max height that still fits the iframe; <1 shrinks, never overflows. */
  cardSize: 1,
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
  travelMult: 5,
  progressGain: 3.2,
  speedStep: 0.28,
  speedMin: 0.06,
  ease: "inOutCubic",

  driftY: 18,
  tipScale: 0.12,
  rotateYBase: 0,
  rotateYStep: 0,
  rotateXAmt: 3,
  fanScale: 0.42,
  /** Visible top-edge sliver at rest (px of `--frame-h`). */
  peekPx: 6,

  deckLeftPct: 50,
  deckScale: 1,
  /** 1 = max height that still fits the iframe; <1 shrinks, never overflows. */
  cardSize: 1,
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
  /** Lower = more finger/wheel travel per card (slower stack). */
  dragSensitivity: 0.35,

  /** Centered near-full-width card: a desktop X nudge would overflow the iframe. */
  worksShiftX: 0,
  worksShiftY: 0,
  worksRotate: 0,
};

const DESKTOP_DEFAULTS = { ...DESKTOP };
const MOBILE_DEFAULTS = { ...MOBILE };

export const MOBILE_MQ = "(max-width: 900px)";
const STORAGE_KEY = "kaik-deck-tweaks-v4";
const LEGACY_STORAGE_KEY = "kaik-deck-tweaks-v3";
const UI_STORAGE_KEY = "kaik-deck-tweaks-ui-v3";

/** @type {"auto" | "desktop" | "mobile"} */
let editMode = "mobile";

export function isMobile() {
  return window.matchMedia(MOBILE_MQ).matches;
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
  if (editMode === "desktop") return "desktop";
  if (editMode === "mobile") return "mobile";
  return isMobile() ? "mobile (auto)" : "desktop (auto)";
}

const A4_ASPECT = 297 / 210;
const CARD_GUTTER = 12;
const A4_MAX_W = 490;

function readCardPoseExtents() {
  let maxRotate = 0;
  let maxBaseY = 0;
  let maxTip = 0;
  document.querySelectorAll("[data-card]").forEach((el) => {
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

/**
 * Size A4 `--card-h` from the iframe so the visual box after deck scale,
 * max rotate, hover lift, and vertical toss stays inside `--frame-h`.
 * Square works-card uses the same `--card-h` (wider than A4 siblings).
 * Raising `deckScale` shrinks the card instead of overflowing.
 * `cardSize` (0.5–1) then scales that max-fit height; 1 = current viewport fit.
 */
export function syncCardMetrics() {
  const p = getParams();
  const mobile = isMobile();
  const { width: frameW, height: frameH } = getViewportSize();
  if (frameW <= 0 || frameH <= 0) return;

  const scale = Math.max(0.5, Number(p.deckScale) || 1);
  const rawSize = Number(p.cardSize);
  const cardSize = Number.isFinite(rawSize) ? Math.min(1, Math.max(0.5, rawSize)) : 1;
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
  document.documentElement.style.setProperty(
    "--deck-scale",
    String(Number.isFinite(scale) ? scale : 1),
  );
  syncCardMetrics();
  document.querySelectorAll("[data-card]").forEach((card) => {
    if (card.hasAttribute("data-fly-lock")) return;
    // Desktop is right-pinned. Mobile stays centered at deckLeftPct 50
    // (left % + margin-left: -card-w/2); only a mobile slider moves it.
    if (mobile) {
      card.style.left = `${p.deckLeftPct ?? 50}%`;
      card.style.right = "";
    } else {
      card.style.left = "auto";
      card.style.right = `${p.deckRightPx ?? 209}px`;
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

const FIELDS = [
  {
    group: "Flight",
    items: [
      {
        key: "dragSensitivity",
        label: "swipe speed (higher = faster)",
        min: 0.05,
        max: 5,
        step: 0.05,
        mobileOnly: true,
      },
      {
        key: "scrollPerCard",
        label: "scroll / card (desktop px)",
        min: 50,
        max: 10000,
        step: 10,
        desktopOnly: true,
      },
      { key: "travelMult", label: "fly distance", min: 0.1, max: 20, step: 0.05 },
      { key: "peekPx", label: "rest peek (px)", min: 0, max: 120, step: 1, mobileOnly: true },
      { key: "progressGain", label: "lead (which card holds center)", min: 0.1, max: 10, step: 0.05 },
      { key: "speedStep", label: "speed falloff curve", min: 0, max: 1, step: 0.005 },
      { key: "speedMin", label: "slowest card speed", min: 0.01, max: 1, step: 0.01 },
      {
        key: "ease",
        label: "easing",
        type: "select",
        options: [
          { value: "linear", label: "linear" },
          { value: "inOutCubic", label: "inOut cubic" },
          { value: "outCubic", label: "out cubic" },
          { value: "inCubic", label: "in cubic" },
          { value: "inOutQuad", label: "inOut quad" },
        ],
      },
    ],
  },
  {
    group: "Stack / tilt",
    items: [
      { key: "fanScale", label: "fan scale", min: 0, max: 4, step: 0.05, mobileOnly: true },
      { key: "tipScale", label: "tip rotate", min: 0, max: 12, step: 0.05 },
      { key: "rotateXAmt", label: "rotateX (°)", min: 0, max: 120, step: 0.5 },
      { key: "deckLeftPct", label: "stack left %", min: 0, max: 100, step: 0.5, mobileOnly: true },
      { key: "deckRightPx", label: "stack right (px)", min: 0, max: 1200, step: 1, desktopOnly: true },
      { key: "deckScale", label: "stack scale", min: 0.5, max: 2.8, step: 0.01 },
      { key: "cardSize", label: "размер карточек", min: 0.5, max: 1, step: 0.01 },
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
}

function isStaleMobileSnapshot(mobile) {
  if (!mobile) return false;
  return (
    mobile.scrollPerCard === 1100 ||
    mobile.fanScale === 0.7 ||
    mobile.fanScale === 0.28 ||
    mobile.fanScale === 0.12 ||
    mobile.ease === "outCubic" ||
    (mobile.travelMult === 1 && mobile.dragSensitivity === 1.2 && mobile.peekPx === 16)
  );
}

function applyMobileSaved(mobile) {
  if (!mobile) return;
  if (isStaleMobileSnapshot(mobile)) {
    Object.assign(MOBILE, MOBILE_DEFAULTS);
    return;
  }
  Object.assign(MOBILE, mobile);
}

function loadSaved() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      applyDesktopSaved(data.desktop);
      applyMobileSaved(data.mobile);
      if (data.editMode === "auto" || data.editMode === "desktop" || data.editMode === "mobile") {
        editMode = data.editMode;
      }
      return;
    }

    const legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return;
    const legacy = JSON.parse(legacyRaw);
    applyDesktopSaved(legacy.desktop);
    if (legacy.editMode === "auto" || legacy.editMode === "desktop" || legacy.editMode === "mobile") {
      editMode = legacy.editMode;
    }
  } catch {
    // ignore
  }
}

function save() {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ desktop: DESKTOP, mobile: MOBILE, editMode }));
  } catch {
    // ignore
  }
}

function formatValue(key, value) {
  if (typeof value === "string") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) || Math.abs(n) >= 10 ? String(Math.round(n * 100) / 100) : n.toFixed(2);
}

/**
 * Load saved params, apply them, and mount the live panel.
 * @param {(params: typeof DESKTOP) => void} [onChange]
 */
export function initTweaks(onChange) {
  loadSaved();
  applyDeckParams();
  onFrameMetrics(() => applyDeckParams());

  const root = document.createElement("aside");
  root.className = "tweaks";
  root.dataset.tweaks = "";
  root.innerHTML = `
    <div class="tweaks__bar">
      <button type="button" class="tweaks__toggle" data-tweaks-toggle aria-expanded="true">
        flight tweaks
      </button>
      <button type="button" class="tweaks__action" data-tweaks-reset>reset</button>
      <button type="button" class="tweaks__action" data-tweaks-copy>copy JSON</button>
      <button type="button" class="tweaks__action" data-tweaks-hide title="Hide panel (T)">hide</button>
    </div>
    <div class="tweaks__mode">
      <span class="tweaks__mode-label">edit</span>
      <button type="button" class="tweaks__mode-btn" data-mode="auto">auto</button>
      <button type="button" class="tweaks__mode-btn" data-mode="desktop">desktop</button>
      <button type="button" class="tweaks__mode-btn" data-mode="mobile">mobile</button>
      <span class="tweaks__mode-current" data-mode-current></span>
    </div>
    <div class="tweaks__body" data-tweaks-body></div>
  `;

  const reopen = document.createElement("button");
  reopen.type = "button";
  reopen.className = "tweaks-reopen is-hidden";
  reopen.dataset.tweaksReopen = "";
  reopen.title = "Show flight tweaks (T)";
  reopen.textContent = "tweaks";
  reopen.setAttribute("aria-hidden", "true");

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

  function syncModeButtons() {
    root.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-mode") === editMode);
    });
    const current = root.querySelector("[data-mode-current]");
    if (current) current.textContent = getEditLabel();
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
    reopen.classList.toggle("is-hidden", !hidden);
    reopen.setAttribute("aria-hidden", String(!hidden));
    writeUiState({ hidden });
  }

  function setCollapsed(collapsed) {
    root.classList.toggle("is-collapsed", collapsed);
    root.querySelector("[data-tweaks-toggle]").setAttribute("aria-expanded", String(!collapsed));
    writeUiState({ collapsed });
  }

  function notify() {
    applyDeckParams();
    save();
    onChange?.(getParams());
  }

  buildFields();
  syncModeButtons();
  document.body.append(root);
  document.body.append(reopen);

  const ui = readUiState();
  if (ui.collapsed === true || (ui.collapsed == null && isMobile())) setCollapsed(true);
  if (ui.hidden) setHidden(true);
  else setHidden(false);

  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  reopen.addEventListener("pointerdown", (event) => event.stopPropagation());

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    const key = el.dataset.param;
    if (!key) return;
    const target = getEditTarget();
    if (!(key in target)) return;

    if (el instanceof HTMLSelectElement) {
      target[key] = el.value;
    } else {
      target[key] = Number(el.value);
      const valueEl = el.closest(".tweaks__row")?.querySelector("[data-value]");
      if (valueEl) valueEl.textContent = formatValue(key, target[key]);
    }
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

  window.addEventListener("keydown", (event) => {
    if (event.key !== "t" && event.key !== "T") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) {
      return;
    }
    setHidden(!root.classList.contains("is-hidden"));
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
    notify();
  });

  root.querySelector("[data-tweaks-copy]").addEventListener("click", async () => {
    const text = JSON.stringify(getEditTarget(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      const btn = root.querySelector("[data-tweaks-copy]");
      const prev = btn.textContent;
      btn.textContent = "copied";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    } catch {
      window.prompt("Copy tweaks JSON:", text);
    }
  });

  return getParams();
}
