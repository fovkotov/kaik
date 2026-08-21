/**
 * User-facing stage nudge panel: per-block X/Y on desktop, global lift everywhere.
 * Desktop chrome matches Figma 117:976; stage JSON stays
 * lift 64 / lockup X 2 / nav·lang Y 0 / stack Y 44 / focus Y 9 / scale 0.93.
 * Mobile keeps the 110 global lift.
 */

import { onFrameMetrics, safeStorage } from "./embed.js";
import { t } from "./scriptik.js";
import {
  CARD_SIZE,
  getCardSize,
  isMobile,
  MOBILE_MQ,
  resetCardSize,
  setCardSize,
} from "./tweaks.js";

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

const PINNED_GROUPS = new Set(["stage.group.all", "stage.group.cards"]);

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

function layoutJson() {
  const s = getTarget();
  return {
    lift: s.lift,
    lockup: { x: s.lockupX, y: s.lockupY },
    nav: { x: s.navX, y: s.navY },
    lang: { x: s.langX, y: s.langY },
    deck: { x: s.deckX, y: s.deckY },
    focus: { x: s.focusX, y: s.focusY },
    close: { x: s.closeX, y: s.closeY },
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

export function initStageSettings() {
  loadSaved();
  applyStageNudge();
  onFrameMetrics(() => applyStageNudge());

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

  function visibleGroups() {
    const mobileView = isMobile();
    return GROUPS.filter((group) => !group.desktopOnly || !mobileView);
  }

  function renderGroup(group) {
    const section = document.createElement("section");
    section.className = "stage-settings__group";
    section.innerHTML = `<h3 class="stage-settings__group-title" data-i18n="${group.titleKey}">${t(group.titleKey)}</h3>`;
    group.items.forEach((field) => {
      const value = readField(field.key);
      const row = document.createElement("label");
      row.className = "stage-settings__row";
      row.innerHTML = `
          <span class="stage-settings__label" data-i18n="${field.labelKey}">${t(field.labelKey)}</span>
          <span class="stage-settings__value" data-value>${formatFieldValue(field.key, value)}</span>
          <input
            class="stage-settings__range"
            type="range"
            data-nudge="${field.key}"
            min="${field.min}"
            max="${field.max}"
            step="${field.step}"
            value="${value}"
          />
        `;
      section.append(row);
    });
    return section;
  }

  function buildFields() {
    pinned.innerHTML = "";
    body.innerHTML = "";
    const pinFrag = document.createDocumentFragment();
    const bodyFrag = document.createDocumentFragment();
    visibleGroups().forEach((group) => {
      const section = renderGroup(group);
      if (PINNED_GROUPS.has(group.titleKey)) pinFrag.append(section);
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
  }

  function syncValues() {
    root.querySelectorAll("[data-nudge]").forEach((el) => {
      const key = el.dataset.nudge;
      if (!key || (!isTweakField(key) && !(key in getTarget()))) return;
      const value = readField(key);
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

  const stopDeck = (event) => event.stopPropagation();
  root.addEventListener("pointerdown", stopDeck);
  root.addEventListener("touchstart", stopDeck, { passive: true });
  root.addEventListener("wheel", stopDeck, { capture: true, passive: true });

  fab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(!root.classList.contains("is-open"));
  });

  root.querySelector("[data-stage-reset]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Object.assign(getTarget(), getDefaults());
    if (!isMobile()) resetCardSize();
    syncValues();
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
    const next = writeField(key, el.value);
    const valueEl = el.closest(".stage-settings__row")?.querySelector("[data-value]");
    if (valueEl) valueEl.textContent = formatFieldValue(key, next);
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
    buildFields();
  });
}
