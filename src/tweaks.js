/**
 * Deck params. Desktop and mobile presets stay separate;
 * the live editor UI is not mounted.
 */

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
};

export const MOBILE = {
  scrollPerCard: 1,
  travelMult: 1.12,
  progressGain: 2.5,
  speedStep: 0.2,
  speedMin: 0.05,
  ease: "outCubic",

  driftY: 18,
  tipScale: 0.35,
  rotateYBase: 0.4,
  rotateYStep: 0.2,
  rotateXAmt: 8,
  fanScale: 0.28,

  deckLeftPct: 50,
  deckScale: 1,
  travelDir: -1,

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
  /** How strongly a vertical swipe advances the stack (higher = less travel per card) */
  dragSensitivity: 1.2,
};

const DESKTOP_DEFAULTS = { ...DESKTOP };
const MOBILE_DEFAULTS = { ...MOBILE };

export const MOBILE_MQ = "(max-width: 900px)";
const STORAGE_KEY = "kaik-deck-tweaks-v3";

export function isMobile() {
  return window.matchMedia(MOBILE_MQ).matches;
}

export function getParams() {
  return isMobile() ? MOBILE : DESKTOP;
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

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.desktop) {
      Object.assign(DESKTOP, data.desktop);
      // Old saves snapshot the previous default (0.95). Keep a custom
      // travelMult; otherwise pick up the new flight distance.
      if (data.desktop.travelMult == null || data.desktop.travelMult === 0.95) {
        DESKTOP.travelMult = DESKTOP_DEFAULTS.travelMult;
      }
      // Old saves snapshot previous defaults (56, then 140). Keep a custom
      // deckRightPx; otherwise pick up the new desktop inset.
      if (
        data.desktop.deckRightPx == null ||
        data.desktop.deckRightPx === 56 ||
        data.desktop.deckRightPx === 140
      ) {
        DESKTOP.deckRightPx = DESKTOP_DEFAULTS.deckRightPx;
      }
      // Old saves snapshot previous defaults (1, then 1.21). Keep a custom
      // deckScale; otherwise pick up the new desktop scale.
      if (
        data.desktop.deckScale == null ||
        data.desktop.deckScale === 1 ||
        data.desktop.deckScale === 1.21
      ) {
        DESKTOP.deckScale = DESKTOP_DEFAULTS.deckScale;
      }
    }
    if (data.mobile) {
      Object.assign(MOBILE, data.mobile);
      // Pre-stack mobile used pixel scroll + a wide fan. Sequential toss
      // needs the new defaults unless the user actually retuned them.
      if (data.mobile.scrollPerCard === 1100 || data.mobile.fanScale === 0.7) {
        MOBILE.scrollPerCard = MOBILE_DEFAULTS.scrollPerCard;
        MOBILE.fanScale = MOBILE_DEFAULTS.fanScale;
        MOBILE.travelMult = MOBILE_DEFAULTS.travelMult;
        MOBILE.rotateXAmt = MOBILE_DEFAULTS.rotateXAmt;
        MOBILE.dragSensitivity = MOBILE_DEFAULTS.dragSensitivity;
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Load saved params and apply them. Does not mount a visible panel.
 * @param {(params: typeof DESKTOP) => void} [onChange]
 */
export function initTweaks(onChange) {
  loadSaved();
  applyDeckParams();
  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    applyDeckParams();
    onChange?.(getParams());
  });
  return getParams();
}
