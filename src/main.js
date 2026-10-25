import "./work-nav-arrow.css";
import { getScrollRoot, getViewportSize, initEmbed, isFocusFrozen, onFrameMetrics, safeStorage } from "./embed.js";
import { initFormatVideo } from "./format-video.js";
import { initPreviewMedia } from "./preview-media.js";
import { initTickClicks } from "./tick-clicks.js";
import { initSoundSettings } from "./sound-settings.js";
import { initStageSettings } from "./stage-settings.js";
import { initAuthorLightbox, isAuthorLightboxOpen } from "./author-lightbox.js";
import { closeDeckStageViewers } from "./deck-stage-viewer.js";
import { playFlySound } from "./lib/sound-catalog.js";
import { initImgSliders } from "./img-slider.js";
import { initProgramStrips } from "./program-strip.js";
import { initProjectViewer } from "./project-viewer.js";
import { initProgramModal } from "./program-modal.js";
import { initStudentProgress } from "./student-progress.js";
import { initDropcaps } from "./letters/dropcap.js";
import { initWorksFeed } from "./works-feed.js";
import { applyTranslations, getLocale } from "./scriptik.js";
import {
  canPlayCardIntro,
  canPlayTextIntro,
  cancelIntroAnimations,
  createDeckIntro,
  createDeckOutro,
  markIntroDone,
  markIntroReady,
  playTextIntro,
  stageDeckStagger,
  syncDeckIntroSounds,
} from "./intro.js";
import { initTextAppear } from "./text-appear.js";
import {
  MOBILE_MQ,
  applyDeckParams,
  easeByName,
  getParams,
  initTweaks,
  inDeckFlow,
  isMobile,
  normalizeViewMode,
  setDeckStageCardScale,
} from "./tweaks.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
/**
 * Lettering-page wheel glide (`new Lenis({ smoothWheel: true })`).
 * Default lerp is 0.1; line mode uses 100/6. `lenisDamp` is Lenis `damp`.
 */
const LENIS_WHEEL_LERP = 0.1;
const LENIS_LINE_HEIGHT = 100 / 6;

function lenisWheelPx(delta, deltaMode, pageSize) {
  if (!delta) return 0;
  if (deltaMode === 1) return delta * LENIS_LINE_HEIGHT;
  if (deltaMode === 2) return delta * (pageSize || 0);
  return delta;
}

function lenisDamp(from, to, dtSeconds) {
  return lerp(from, to, 1 - Math.exp(-LENIS_WHEEL_LERP * 60 * dtSeconds));
}
/** Mobile stack only: keep the green program card nearly flat (not cardRotate × −6.52°). */
const PROGRAM_MOBILE_ROTATE = -1;

function initLocale() {
  applyTranslations(getLocale());
}

function cardSpeed(index, count, params) {
  if (count <= 1) return 1;
  const t = index / (count - 1);
  const curve = 1 + params.speedStep * 6;
  return lerp(1, params.speedMin, t ** (1 / curve));
}

function maxProgress(count, params) {
  if (isMobile()) return Math.max(0, count - 1);
  return Math.max(1, count * params.scrollPerCard);
}

/** Flight 0–1 for card `index` at global progress `p` — same math as render(). */
function cardFlightT(index, count, params, p) {
  const speed = cardSpeed(index, count, params);
  const lead = Math.pow(
    speed / Math.max(params.speedMin, 0.05),
    clamp(params.progressGain * 0.45, 0.2, 2),
  );
  const raw = clamp(1 - (1 - clamp(p, 0, 1)) ** lead, 0, 1);
  return easeByName(params.ease, raw);
}

/**
 * Invert cardFlightT so this card is the current stack card (just starting to
 * fly). `index * scrollPerCard` is the wrong mapping: the lead curve spends
 * early cards in the first ~2% of the track, so that product shows the last cards.
 */
const REVEAL_FLIGHT = 0.22;

function scrollYForCard(index, count, params) {
  const total = maxProgress(count, params);
  const targetT = REVEAL_FLIGHT;
  if (index <= 0) return 0;
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 28; n++) {
    const mid = (lo + hi) / 2;
    if (cardFlightT(index, count, params, mid) < targetT) lo = mid;
    else hi = mid;
  }
  return clamp(hi * total, 0, total);
}

/**
 * Distance from the focus card: 0 = at center, + = waiting above, − = leaving.
 */
function mobileStackSlot(index, focus, span = 1) {
  return index - focus / Math.max(0.25, span);
}

/** Slot span over which a fly-exit card leaves the iframe at flySpeed = 1. Smaller = quicker. */
const FLY_EXIT_SPAN = 0.24;

function flyExitSpanOf(params = getParams()) {
  const speed = Number(params.flySpeed);
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return FLY_EXIT_SPAN / clamp(s, 0.25, 4);
}

/** Cubic Bézier 1D: (1−t)³p0 + 3(1−t)²t p1 + 3(1−t)t² p2 + t³ p3 */
function cubicBezier1d(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return uu * u * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + tt * t * p3;
}

function flyPeakScale(params = getParams()) {
  const rawPeak = Number(params.flyScale);
  return clamp(Number.isFinite(rawPeak) ? rawPeak : 1.28, 1, 1.8);
}

/**
 * Px a centered card must travel left so its scaled box is fully past the iframe.
 * Base D already clears the screen at `flyScale` (visual width = cardW * scale).
 * `flyExitX` lengthens that arc; it cannot shorten it below fully-off
 * (0.9 still exits — the whole card, then cull).
 */
function flyLeaveDist(vw, cardW, params = getParams()) {
  const visualW = cardW * flyPeakScale(params);
  const leftOffset = Math.max(0, (vw - cardW) / 2);
  const fullyOff = visualW + leftOffset + 16;
  const xMul = Number(params.flyExitX);
  const mul = Number.isFinite(xMul) ? clamp(xMul, 0.4, 2.5) : 1;
  return Math.max(fullyOff, fullyOff * mul);
}

/** True once translateX has carried the scaled right edge past the iframe left. */
function flyCardClearedIframe(tossX, vw, cardW, scale) {
  const visualW = cardW * Math.max(1, scale);
  const leftOffset = Math.max(0, (vw - cardW) / 2);
  return Math.abs(tossX) >= visualW + leftOffset + 8;
}

/**
 * Coupled fly-left pose for linear t ∈ [0, 1].
 * One cubic — toward-camera scale and left travel share t (not scale, then x).
 * P1 already has −X so it peels left while growing; P2→P3 are mostly −X.
 * Y is a shallow dip, not a rainbow.
 * Scale is monotonic: grow toward camera, then hold (never shrink on the left turn).
 */
function flyExitPose(t, exitDist, params = getParams()) {
  const peak = flyPeakScale(params);
  const peakY = Number.isFinite(Number(params.flyArcY)) ? Number(params.flyArcY) : 28;
  const p1Scale = 1 + (peak - 1) * (0.26 / 0.28);
  const rawScale = cubicBezier1d(t, 1, p1Scale, peak, peak);
  return {
    x: cubicBezier1d(t, 0, -0.26 * exitDist, -0.68 * exitDist, -exitDist),
    y: cubicBezier1d(t, 0, 0.5 * peakY, peakY, (8 / 28) * peakY),
    scale: clamp(Math.max(1, rawScale), 1, peak),
  };
}

/** Same key the experiment-2 G panel writes. Default 1 is the unscaled stage drag. */
const DECK_STAGE_DRAG_SPEED_KEY = "kaik:experiment-2:drag-speed";

function clampDeckStageDragScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(0.25, Math.round(n * 100) / 100));
}

function readDeckStageDragScale() {
  try {
    const raw = safeStorage().getItem(DECK_STAGE_DRAG_SPEED_KEY);
    if (raw == null || raw === "") return 1;
    return clampDeckStageDragScale(JSON.parse(raw));
  } catch {
    return 1;
  }
}

/**
 * Desktop stage inside the hero iframe stays parked until the parent posts
 * `kaik:deck-stage-intro`. A hidden preload must not play the fly-in (or its
 * sounds) before the deck is shown; the click replays it.
 */
function deckStageWide() {
  if (!document.documentElement.classList.contains("deck-stage")) return false;
  return (document.documentElement.clientWidth || window.innerWidth || 0) >= 901;
}

function deckStageFrameHost() {
  if (window.parent === window) return null;
  try {
    const frame = window.frameElement;
    if (!frame) return null;
    return frame.closest("[data-hero-deck], [data-deck-stage]") || frame;
  } catch {
    return null;
  }
}

function deckStageIntroHeld() {
  if (!document.documentElement.classList.contains("deck-stage")) return false;
  if (window.parent === window) return false;
  try {
    const frame = window.frameElement;
    if (!frame) return false;
    if (frame.closest("[hidden]")) return true;
    const host = frame.closest("[data-hero-deck]");
    const parentBody = frame.ownerDocument?.body;
    return Boolean(host && parentBody && !parentBody.classList.contains("is-hero-deck"));
  } catch {
    return false;
  }
}

/**
 * The hero preload iframe is `display:block` (so it boots at desktop width)
 * and only `visibility:hidden`. That does not set `document.hidden`, so a
 * pointer, hover, or intro wake keeps `requestAnimationFrame` running under
 * the lettering. True when this deck must not paint.
 */
function deckStageConcealed() {
  const host = deckStageFrameHost();
  if (!host) return false;
  if (host.closest("[hidden]")) return true;
  try {
    const style = host.ownerDocument.defaultView.getComputedStyle(host);
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function deckIntroOptions(count) {
  const stage = document.documentElement.classList.contains("deck-stage");
  const mobile = deckStageWide() ? false : isMobile();
  /* Stage pile uses the desktop deal: back of the stack first, from the right. */
  const stageMobile = stage && mobile;
  return {
    frontFirst: mobile && !stageMobile,
    ...(stage ? { stagger: stageDeckStagger(count) } : {}),
  };
}

/**
 * Desktop: scroll-driven stack (right → left) + cursor parallax / hover lift.
 * Mobile: physical deck — rear cards smaller and slightly higher, grow to the front.
 */
function initDeck() {
  const cards = [...document.querySelectorAll("[data-card]")];
  const track = document.querySelector(".scroll-track");
  const deck = document.querySelector("[data-deck]");
  const root = getScrollRoot();
  if (!cards.length || !track || !root || !deck) return null;

  const state = cards.map((card, index) => ({
    el: card,
    index,
    baseRotate: Number(card.dataset.baseRotate || 0),
    baseX: Number(card.dataset.baseX || 0),
    baseY: Number(card.dataset.baseY || 0),
    tip: Number(card.dataset.tip || 12),
    baseZ: Number.parseInt(getComputedStyle(card).zIndex, 10) || cards.length - index,
    /** Eased 0–1 hover lift; frozen (not reset) while the card is fly/rest-locked. */
    hover: 0,
    hoverTarget: 0,
    inert: false,
  }));

  /** Desktop cursor parallax: pointer normalised to −1..1, eased per frame. */
  const pointer = { x: 0, y: 0 };
  const pointerSmooth = { x: 0, y: 0 };
  /** Below this the eased values snap to target so the loop can stop. */
  const EASE_EPS = 0.002;
  let hoveredIndex = -1;
  let raf = 0;
  let cardBoxH = 0;
  let cardBoxW = 0;
  let flyLockedFlag = false;
  /** First-load card deal; assigned after listeners, sampled every frame while armed. */
  let deckIntro = null;
  let deckOutro = null;
  /** @type {null | { id: number, startX: number, startScroll: number, lastX: number, lastT: number, vel: number, moved: boolean }} */
  let desktopDrag = null;
  /** Leftover px/frame after a desktop flick; decays like mobile inertia. */
  let desktopCoast = 0;
  /** Deck-stage horizontal wheel target. Glides with the lettering-page Lenis lerp. */
  let deckWheelTarget = null;
  let deckWheelAt = 0;
  /**
   * Desktop stage only. Deck-local px added to every card so the leftmost one
   * clears the iframe. Frozen once the user drags or wheels, so the glide can
   * still carry the left card off-screen toward the right of the fan.
   */
  let stageInsetX = 0;
  let stageInsetFrozen = false;
  let stageUserMoved = false;
  const STAGE_EDGE = 16;
  /**
   * Desktop deck-stage pointer drag, as a multiple of the stage base (/12).
   * 1 matches that base. The G panel on experiment-2 posts updates on top.
   */
  let deckStageDragScale = document.documentElement.classList.contains("deck-stage")
    ? readDeckStageDragScale()
    : 1;

  /** Virtual progress used on mobile instead of page scroll (card units: 0 = first on top) */
  let dragProgress = 0;
  /** Last emitted card-unit progress; `null` until the first drag or render sample. */
  let lastDeckProgress = null;
  /** Desktop: last time scrollTop moved, so inertia/wheel bursts stay `active`. */
  let lastDesktopDeltaAt = 0;
  /** Leftover velocity after a flick (card units per frame); decays with friction. */
  let dragInertia = 0;
  /** @type {null | { from: number, to: number, t0: number, dur: number, onDone?: (() => void) | null }} */
  let snapAnim = null;
  /** @type {null | { id: number, startX: number, startY: number, startProgress: number, lastY: number, lastT: number, vel: number, moved: boolean }} */
  let drag = null;
  /**
   * Stage pile order on a phone. Index 0 is the top card. Element refs, not
   * DOM order — program-modal keeps cards by element, so this must not reorder nodes.
   * @type {HTMLElement[]}
   */
  let pileOrder = state.filter((item) => inDeckFlow(item.el)).map((item) => item.el);
  /** @type {null | { id: number, el: HTMLElement, startX: number, startY: number, x: number, y: number, vx: number, vy: number, lastX: number, lastY: number, lastT: number, moved: boolean, axis: "x" | "y" | null, scrolled: boolean }} */
  let pileDrag = null;
  /** Vertical drag on empty pile space. Scrolls the parent page instead of a card. */
  let pagePan = null;
  /** @type {null | { mode: "back" | "off", el: HTMLElement, x: number, y: number, vx?: number, vy?: number, dirX?: number, dirY?: number, speed?: number, startDist?: number }} */
  let pileAnim = null;
  /**
   * Buried cards after a fly-off. Eased home on its own so they stay in the
   * pile. Live drags and spring-backs trail the top card directly instead.
   * @type {null | { x: number, y: number, tilt: number, depth: Map<HTMLElement, number> }}
   */
  let pileTug = null;
  const RUBBER = 0.28;
  /** Max reverse overscroll (progress units) after damp — maps to ~6px / 0.985. */
  const REVERSE_RUBBER_MAX = 0.06;
  const REVERSE_RUBBER_PX = 6;
  const REVERSE_RUBBER_SCALE = 0.985;
  const INERTIA_MIN = 0.00035;
  /** Per-frame exponential decay (~60fps); iOS-like coast after a flick. */
  const INERTIA_FRICTION = 0.92;
  /** Scroll/parallax freeze while the program card is in-deck focused */
  let freezeY = null;
  /*
   * Sibling fan while a card is focused is owned by program-modal.js
   * (one-shot --fly-* pins, FLY_MS). The deck loop never moves a card that
   * carries data-fly-lock / is-program-open / is-fly-pinned / data-rest-lock.
   */
  const FOCUS_SEL = "[data-card]";
  flyLockedFlag = Boolean(document.querySelector("[data-fly-lock]"));
  const lockup = document.querySelector("[data-lockup]");
  if (lockup) {
    lockup.style.transform = "";
    lockup.style.visibility = "";
  }

  const programLocked = () => flyLockedFlag;
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const focusOpen = () => deck.hasAttribute("data-program-open");

  /** Desktop drops the landing loop twin so it is not a stack/fly slot. */
  function liveItems() {
    return isMobile() ? state : state.filter((item) => inDeckFlow(item.el));
  }

  function liveCount() {
    return liveItems().length;
  }

  function syncDeckCount() {
    document.documentElement.style.setProperty("--card-count", String(liveCount()));
  }

  function parkLoopTwin() {
    const mobile = isMobile();
    state.forEach((item) => {
      if (!item.el.hasAttribute("data-deck-loop")) return;
      item.el.toggleAttribute("hidden", !mobile);
      item.el.classList.toggle("is-stack-inert", !mobile);
      if (mobile) {
        item.el.style.pointerEvents = "";
        item.el.style.opacity = "";
        return;
      }
      item.el.style.opacity = "0";
      item.el.style.pointerEvents = "none";
      item.el.style.zIndex = "";
      item.el.style.transform = "";
    });
  }

  syncDeckCount();
  parkLoopTwin();

  function refreshCardBox() {
    cardBoxH = state[0]?.el.offsetHeight || 400;
    cardBoxW = state[0]?.el.offsetWidth || 320;
  }

  refreshCardBox();

  let deckConcealed = deckStageConcealed();

  function scheduleRender() {
    if (raf) return;
    if (document.visibilityState === "hidden" || deckConcealed) return;
    raf = requestAnimationFrame(render);
  }

  function needsDeckFrame(mobile) {
    if (isFocusFrozen()) return false;
    if (deckIntro || deckOutro) return true;
    if (desktopDrag || Math.abs(desktopCoast) > 0.35 || deckWheelTarget != null) return true;
    if (pileDrag || pileAnim || pileTug) return true;
    if (drag || snapAnim) return true;
    if (Math.abs(dragInertia) > INERTIA_MIN) return true;
    if (mobile) return false;
    /* Open card freezes pointer/hover — do not keep compositing the stack. */
    if (programLocked() || focusOpen()) return false;
    /* Eased values snap to target in render(), so `!==` means still converging. */
    if (pointerSmooth.x !== pointer.x || pointerSmooth.y !== pointer.y) return true;
    for (const item of state) {
      if (item.hover !== item.hoverTarget) return true;
    }
    if (lastDesktopDeltaAt > 0 && performance.now() - lastDesktopDeltaAt < 90) return true;
    return false;
  }

  function eventFrom(target, selector) {
    const el = target instanceof Element ? target : target?.parentElement;
    return el?.closest?.(selector) || null;
  }

  function poseNow() {
    return isMobile() ? dragProgress : root.scrollTop || 0;
  }

  function afterPoseFrame(done) {
    requestAnimationFrame(() => requestAnimationFrame(done));
  }

  function focusSpanOf(params = getParams()) {
    const n = Number(params.focusSpan);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** Stage deck on a phone: a centered pile. Drag the top card to the back. */
  function stagePile() {
    return document.documentElement.classList.contains("deck-stage") && isMobile();
  }

  /** Finger-up on the phone pile scrolls experiment-2. The parent ignores this while the deck is closed. */
  function postStagePageScroll(deltaY, smooth = false) {
    if (!deltaY || !window.parent || window.parent === window) return;
    window.parent.postMessage(
      { type: "kaik:deck-stage-page-wheel", deltaY, smooth: smooth === true },
      "*",
    );
  }

  /** Horizontal trackpad / wheel on the stage deck. Same target+damp as Lenis. */
  function queueDeckWheel(delta) {
    if (!delta || desktopDrag) return;
    stageUserMoved = true;
    stageInsetFrozen = true;
    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
    const base = deckWheelTarget ?? root.scrollTop ?? 0;
    deckWheelTarget = clamp(base + delta, 0, maxTop);
    desktopCoast = 0;
    if (!deckWheelAt) deckWheelAt = performance.now();
    scheduleRender();
  }

  function clearDeckWheel() {
    deckWheelTarget = null;
    deckWheelAt = 0;
  }

  function swallowNextClick(el) {
    if (!(el instanceof Element)) return;
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    el.addEventListener("click", stop, { capture: true, once: true });
  }

  function deckMax() {
    return Math.max(0, liveCount() - 1) * focusSpanOf();
  }

  /** Fully gone cards (opacity 0) pass hits through; any still-visible card stays tappable. */
  function setStackHit(el, { mobile, inert }) {
    el.classList.toggle("is-stack-inert", Boolean(mobile && inert));
    if (!mobile) {
      el.style.pointerEvents = "";
      return;
    }
    el.style.pointerEvents = inert ? "none" : "";
  }

  function cardUnitPx(params) {
    const h = cardBoxH || state[0]?.el.offsetHeight || 400;
    // 1.36 = 2.04 / 1.5 — same swipe advances another 1.5× farther.
    // Floor 0.05 (was 0.3) so the speed slider works below 0.3.
    const sens = Number(params.dragSensitivity);
    return (h * 1.36) / Math.max(0.05, Number.isFinite(sens) ? sens : 1);
  }

  /**
   * Mobile progress delta from a vertical pointer move.
   * Native “scroll down” (finger moves up, dy < 0) advances the deck so the
   * next card comes forward from the upper/rear stack. Wheel uses +deltaY
   * separately — same “scroll down”, opposite pointer sign.
   */
  function mobilePointerDelta(dy, unit) {
    return -dy / unit;
  }

  function applyRubber(raw) {
    const max = deckMax();
    if (raw < 0) {
      // Micro first-card rubber: sqrt damp, hard cap. Forward scroll unchanged.
      return -Math.min(REVERSE_RUBBER_MAX, Math.sqrt(-raw) * 0.2);
    }
    if (raw > max) return max + (raw - max) * RUBBER;
    return raw;
  }

  function cancelSnap() {
    snapAnim = null;
  }

  function animateProgress(to, onDone) {
    const target = clamp(to, 0, deckMax());
    const from = dragProgress;
    const done = typeof onDone === "function" ? onDone : null;
    dragInertia = 0;
    cancelSnap();
    if (reduceMotion() || Math.abs(from - target) < 0.002) {
      dragProgress = target;
      scheduleRender();
      if (done) afterPoseFrame(done);
      return;
    }
    const dist = Math.abs(target - from);
    snapAnim = {
      from,
      to: target,
      t0: performance.now(),
      dur: clamp(300 + dist * 260, 300, 920),
      onDone: done,
    };
    scheduleRender();
  }

  function cancelDeckDrag() {
    if (!drag) return;
    deck.classList.remove("is-dragging");
    drag = null;
  }

  /** Snapshot click-time pose; pin it every frame so card scroll cannot fly the stack. */
  function holdFlyLock() {
    if (!programLocked()) {
      if (freezeY != null) {
        if (isMobile()) dragProgress = freezeY;
        else root.scrollTop = freezeY;
      }
      freezeY = null;
      root.classList.remove("is-fly-locked");
      return;
    }
    if (freezeY == null) freezeY = poseNow();
    cancelDeckDrag();
    cancelSnap();
    dragInertia = 0;
    if (isMobile()) dragProgress = freezeY;
    else if (root.scrollTop !== freezeY) root.scrollTop = freezeY;
    root.classList.add("is-fly-locked");
  }

  // —— Desktop: hover lift + cursor parallax ——
  /** Cards owned by program-modal (focus flight, fan, landing) never take hover. */
  function hoverLiftBlocked(el) {
    return (
      el.hasAttribute("data-fly-lock") ||
      el.hasAttribute("data-rest-lock") ||
      el.classList.contains("is-program-open") ||
      el.classList.contains("is-fly-pinned")
    );
  }

  function pointerStillOn(el, event) {
    if (el.contains(event.relatedTarget)) return true;
    if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return false;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    return Boolean(hit && el.contains(hit));
  }

  /** Eased lerp that lands exactly on the target so needsDeckFrame can go quiet. */
  function easeTo(current, target, amount) {
    const next = lerp(current, target, amount);
    return Math.abs(next - target) < EASE_EPS ? target : next;
  }

  state.forEach((item) => {
    item.el.addEventListener("pointerenter", (event) => {
      if (isMobile()) return;
      if (!inDeckFlow(item.el)) return;
      if (programLocked() || focusOpen() || hoverLiftBlocked(item.el)) return;
      if (event.buttons) return;
      hoveredIndex = item.index;
      item.el.classList.add("is-hovered");
      scheduleRender();
    });

    item.el.addEventListener("pointerleave", (event) => {
      if (hoverLiftBlocked(item.el)) return;
      // Click/select often fires leave while the cursor is still on the card.
      if (event.buttons || pointerStillOn(item.el, event)) return;
      if (hoveredIndex === item.index) hoveredIndex = -1;
      item.el.classList.remove("is-hovered");
      scheduleRender();
    });
  });

  window.addEventListener(
    "pointermove",
    (event) => {
      if (isMobile() || programLocked() || focusOpen() || isFocusFrozen()) return;
      const { width, height } = getViewportSize();
      if (!width || !height) return;
      const x = clamp((event.clientX / width) * 2 - 1, -1, 1);
      const y = clamp((event.clientY / height) * 2 - 1, -1, 1);
      /* Trackpad / iframe jitter must not keep every card on a rAF diet. */
      if (Math.abs(x - pointer.x) < 0.008 && Math.abs(y - pointer.y) < 0.008) return;
      pointer.x = x;
      pointer.y = y;
      scheduleRender();
    },
    { passive: true },
  );

  // —— Mobile: free vertical drag + inertia (no snap) ——
  // `a:not(.link-card)`: the letterfolio face is a full-card link that must still swipe.
  const DRAG_IGNORE =
    "a:not(.link-card), button:not([data-author-work]), [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings], [data-sound-settings], [data-fly-close], [data-article-close], [data-lockup] .dropcap, [data-work-ig], .work-card__who, [data-work-student-prev], [data-work-student-next], [data-img-slider], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next], [data-program-strip], [data-program-strip-prev], [data-program-strip-next], [data-author-lightbox], [data-preview-media]";

  function desktopDragRatio() {
    const params = getParams();
    const total = maxProgress(liveCount(), params);
    const travel = Math.max((getViewportSize().width || 1) * (params.travelMult || 1.1), 1);
    const stage = document.documentElement.classList.contains("deck-stage");
    const ratio = (total / travel) / (stage ? 12 : 6);
    if (!stage) return ratio;
    return ratio * deckStageDragScale;
  }

  const PILE_TAP_PX = 6;
  const PILE_FLICK = 0.55;
  /** Card directly under the top trails this fraction of the drag, then a cap. */
  const PILE_FOLLOW_GAIN = 0.68;
  const PILE_FOLLOW_CAP = 44;
  /** Each card deeper trails this fraction of the card above it. */
  const PILE_FOLLOW_FALLOFF = 0.45;
  /** Share of the top card's drag tilt. Same falloff by depth. */
  const PILE_FOLLOW_TILT = 0.6;

  function pileScreenScale() {
    const s = Number(getParams().deckScale);
    return Number.isFinite(s) && s > 0.01 ? s : 1;
  }

  function ensurePileOrder() {
    const live = liveItems().map((item) => item.el);
    const liveSet = new Set(live);
    pileOrder = pileOrder.filter((el) => liveSet.has(el));
    for (const el of live) {
      if (!pileOrder.includes(el)) pileOrder.push(el);
    }
  }

  /** Slight offset and rotation so the cards under the top one show a colored edge. */
  function pileOffset(depth) {
    const d = Math.max(0, depth);
    if (d < 0.001) return { x: 0, y: 0, r: 0 };
    const sample = (n) => {
      if (n <= 0) return { x: 0, y: 0, r: 0 };
      const ang = n * 2.399963229728653;
      const mag = Math.min(22, 12 + n * 2.2);
      return {
        x: Math.cos(ang) * mag,
        y: Math.sin(ang) * mag * 0.66,
        r: Math.sin(ang * 1.17) * Math.min(8, 3.6 + n * 0.45),
      };
    };
    const lo = Math.floor(d);
    const t = d - lo;
    const a = sample(lo);
    const b = sample(lo + 1);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      r: a.r + (b.r - a.r) * t,
    };
  }

  function pileRestY(vh) {
    const cardH = cardBoxH || state[0]?.el.offsetHeight || 0;
    if (!(vh > 0) || !(cardH > 0)) return 0;
    return (vh - cardH) / 2 - (deck.getBoundingClientRect().top || 0);
  }

  /**
   * Depth in the resting pile. While the top card is dragged or flying off,
   * the card under it is already depth 0. A spring-back eases the others home.
   * Once the flung card is off-screen it is already last in `pileOrder`, so
   * the new top stays put while that card travels into the back slot.
   */
  function pileDepth(el) {
    const idx = pileOrder.indexOf(el);
    if (idx < 0) return 0;
    const lifted = pileDrag?.el || (pileAnim?.mode === "off" ? pileAnim.el : null);
    if (lifted) {
      if (el === lifted) return 0;
      return Math.max(0, idx - 1);
    }
    if (pileAnim?.mode === "back" && idx > 0) {
      const start = Math.max(1, pileAnim.startDist || 1);
      const settle = 1 - clamp(Math.hypot(pileAnim.x, pileAnim.y) / start, 0, 1);
      return idx - 1 + settle;
    }
    return idx;
  }

  function pileSendToBack(el) {
    const idx = pileOrder.indexOf(el);
    if (idx < 0) return;
    pileOrder.splice(idx, 1);
    pileOrder.push(el);
  }

  function pileDragTilt(x) {
    return clamp(x / 22, -12, 12);
  }

  /** Gesture buried cards trail. Fly-off uses the snapshot in `pileTug`. */
  function pileTugSource() {
    if (programLocked() || focusOpen() || isFocusFrozen()) {
      pileTug = null;
      return null;
    }
    if (pileDrag?.moved) {
      return { x: pileDrag.x, y: pileDrag.y, tilt: pileDragTilt(pileDrag.x), live: true };
    }
    if (pileAnim?.mode === "back") {
      return { x: pileAnim.x, y: pileAnim.y, tilt: pileDragTilt(pileAnim.x), live: true };
    }
    return pileTug;
  }

  function rememberPileTug(x, y) {
    const depth = new Map();
    pileOrder.forEach((el, idx) => {
      if (idx > 0) depth.set(el, idx);
    });
    pileTug = { x, y, tilt: pileDragTilt(x), depth };
  }

  function stepPileTug() {
    if (!pileTug || pileDrag?.moved || pileAnim?.mode === "back") return;
    const k = 0.18;
    pileTug.x += -pileTug.x * k;
    pileTug.y += -pileTug.y * k;
    pileTug.tilt += -pileTug.tilt * k;
    if (Math.hypot(pileTug.x, pileTug.y) < 0.4 && Math.abs(pileTug.tilt) < 0.08) pileTug = null;
  }

  /**
   * Rest-pose offset for a buried card. Depth 1 is the card under the top.
   * Deeper cards move less, and never as far or as tilted as the top card.
   */
  function pileFollow(el) {
    const src = pileTugSource();
    if (!src) return { x: 0, y: 0, r: 0 };
    const depth = src.live ? pileOrder.indexOf(el) : src.depth.get(el) || 0;
    if (depth < 1) return { x: 0, y: 0, r: 0 };
    const falloff = PILE_FOLLOW_FALLOFF ** (depth - 1);
    let x = src.x * PILE_FOLLOW_GAIN * falloff;
    let y = src.y * PILE_FOLLOW_GAIN * falloff;
    const cap = PILE_FOLLOW_CAP * falloff;
    const mag = Math.hypot(x, y);
    if (mag > cap && mag > 0) {
      const s = cap / mag;
      x *= s;
      y *= s;
    }
    return { x, y, r: src.tilt * PILE_FOLLOW_TILT * falloff };
  }

  /** True when the flung card's box has cleared the frame, including flick tilt. */
  function pileCardOffscreen(x, y) {
    const { width: vw, height: vh } = getViewportSize();
    if (!(vw > 0) || !(vh > 0)) return false;
    const scale = pileScreenScale();
    const cardW = (cardBoxW || 280) * scale;
    const cardH = (cardBoxH || 400) * scale;
    const left = (vw - cardW) / 2 + x * scale;
    const top = (vh - cardH) / 2 + y * scale;
    const pad = 28 + Math.abs(pileDragTilt(x)) * 0.01 * Math.max(cardW, cardH);
    return left + cardW < -pad || left > vw + pad || top + cardH < -pad || top > vh + pad;
  }

  /**
   * How far below the pile the return lane sits, in deck px.
   * 0 when the card is already leaving through the bottom.
   */
  function pileUnderArc(fromY) {
    const { height: vh } = getViewportSize();
    const scale = pileScreenScale();
    const cardH = (cardBoxH || 400) * scale;
    const below = (vh - cardH) / 2;
    const room = (below - 12) / scale - fromY;
    if (!(room > 12)) return 0;
    return Math.min(room, 150);
  }

  /**
   * Card has left the frame. Order already has it at the back, so the new top
   * does not move. The same card then comes back from the side it left, low
   * enough to read as sliding under the pile, and eases into the deepest slot.
   */
  function beginPileArrive() {
    const el = pileAnim.el;
    const fromX = pileAnim.x;
    const fromY = pileAnim.y;
    const fromTilt = pileDragTilt(fromX);
    const offscreen = pileCardOffscreen(fromX, fromY);
    pileSendToBack(el);
    const dest = pileOffset(Math.max(0, pileOrder.length - 1));
    const relX = fromX - dest.x;
    const relY = fromY - dest.y;
    const arc = offscreen ? pileUnderArc(relY) : 0;
    const laneY = relY + arc;
    const dist = Math.hypot(relX, laneY);
    pileAnim = {
      mode: "arrive",
      el,
      x: relX,
      y: laneY,
      tilt: fromTilt,
      fromX: relX,
      fromY: laneY,
      fromTilt,
      destR: dest.r,
      t0: performance.now(),
      dur: clamp(420 + dist * 0.28, 460, 680),
    };
  }

  function stepPileArrive() {
    const anim = pileAnim;
    const t = clamp((performance.now() - anim.t0) / anim.dur, 0, 1);
    const u = 1 - (1 - t) ** 3;
    anim.x = anim.fromX * (1 - u);
    anim.y = anim.fromY * (1 - u);
    anim.tilt = anim.fromTilt + (anim.destR - anim.fromTilt) * u;
    if (t >= 1) pileAnim = null;
  }

  function stepPileAnim() {
    if (!pileAnim) return;
    if (pileAnim.mode === "back") {
      const k = 0.28;
      const damp = 0.72;
      pileAnim.vx = ((pileAnim.vx || 0) - pileAnim.x * k) * damp;
      pileAnim.vy = ((pileAnim.vy || 0) - pileAnim.y * k) * damp;
      pileAnim.x += pileAnim.vx;
      pileAnim.y += pileAnim.vy;
      if (Math.hypot(pileAnim.x, pileAnim.y) < 0.5 && Math.hypot(pileAnim.vx, pileAnim.vy) < 0.5) {
        pileAnim = null;
      }
      return;
    }
    if (pileAnim.mode === "arrive") {
      stepPileArrive();
      return;
    }
    pileAnim.speed = Math.min((pileAnim.speed || 22) * 1.06, 84);
    pileAnim.x += (pileAnim.dirX || 0) * pileAnim.speed;
    pileAnim.y += (pileAnim.dirY || 0) * pileAnim.speed;
    const { width: vw, height: vh } = getViewportSize();
    const exit =
      Math.hypot(vw || 1, vh || 1) * 0.55 +
      Math.hypot(cardBoxW || 280, cardBoxH || 400) * 0.55;
    if (pileCardOffscreen(pileAnim.x, pileAnim.y) || Math.hypot(pileAnim.x, pileAnim.y) >= exit) {
      beginPileArrive();
    }
  }

  function pilePointerTarget(event) {
    const node = event.target instanceof Element ? event.target : event.target?.parentElement;
    return node instanceof Element ? node : null;
  }

  function onPilePointerDown(event) {
    if (event.button && event.button !== 0) return;
    if (deckIntro || deckOutro || pileAnim) return;
    if (programLocked() || focusOpen() || isFocusFrozen() || isAuthorLightboxOpen()) return;
    ensurePileOrder();
    const top = pileOrder[0];
    const node = pilePointerTarget(event);
    if (!top || !node || !top.contains(node)) return;
    if (node.closest(DRAG_IGNORE)) return;
    pileDrag = {
      id: event.pointerId,
      el: top,
      startX: event.clientX,
      startY: event.clientY,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: false,
      axis: null,
      scrolled: false,
    };
  }

  function onPilePointerMove(event) {
    if (!pileDrag || event.pointerId !== pileDrag.id) return;
    if (programLocked() || focusOpen() || isFocusFrozen()) {
      pileDrag = null;
      pileTug = null;
      deck.classList.remove("is-dragging");
      scheduleRender();
      return;
    }
    const sdx = event.clientX - pileDrag.startX;
    const sdy = event.clientY - pileDrag.startY;
    if (!pileDrag.axis) {
      if (Math.hypot(sdx, sdy) <= PILE_TAP_PX) return;
      /* A vertical finger scrolls the page. The lettering strip stays put.
         A sideways drag still tugs the pile and can send the top card back. */
      pileDrag.axis = Math.abs(sdy) > Math.abs(sdx) ? "y" : "x";
    }
    if (pileDrag.axis === "y") {
      const delta = pileDrag.lastY - event.clientY;
      pileDrag.lastX = event.clientX;
      pileDrag.lastY = event.clientY;
      pileDrag.lastT = performance.now();
      if (!pileDrag.scrolled) {
        pileDrag.scrolled = true;
        swallowNextClick(pileDrag.el);
      }
      if (event.cancelable) event.preventDefault();
      postStagePageScroll(delta);
      return;
    }
    if (!pileDrag.moved && Math.hypot(sdx, sdy) <= PILE_TAP_PX) return;
    if (!pileDrag.moved) {
      pileDrag.moved = true;
      deck.classList.add("is-dragging");
      try {
        pileDrag.el.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
    const scale = pileScreenScale();
    pileDrag.x = sdx / scale;
    pileDrag.y = sdy / scale;
    const now = performance.now();
    const dt = Math.max(1, now - pileDrag.lastT);
    pileDrag.vx = (event.clientX - pileDrag.lastX) / dt / scale;
    pileDrag.vy = (event.clientY - pileDrag.lastY) / dt / scale;
    pileDrag.lastX = event.clientX;
    pileDrag.lastY = event.clientY;
    pileDrag.lastT = now;
    event.preventDefault();
    scheduleRender();
  }

  function endPileDrag() {
    const current = pileDrag;
    pileDrag = null;
    deck.classList.remove("is-dragging");
    if (!current?.moved) {
      scheduleRender();
      return;
    }
    const dist = Math.hypot(current.x, current.y);
    const stale = performance.now() - current.lastT > 48;
    const speed = stale ? 0 : Math.hypot(current.vx, current.vy);
    const far = dist > Math.min(128, Math.max(78, (cardBoxW || 280) * 0.36));
    const flick = speed > PILE_FLICK;
    if ((far || flick) && dist > PILE_TAP_PX) {
      if (reduceMotion()) {
        pileTug = null;
        pileSendToBack(current.el);
        scheduleRender();
        return;
      }
      const useVel = flick && speed > 0.05;
      const dirX = useVel ? current.vx / speed : current.x / dist;
      const dirY = useVel ? current.vy / speed : current.y / dist;
      rememberPileTug(current.x, current.y);
      pileAnim = {
        mode: "off",
        el: current.el,
        x: current.x,
        y: current.y,
        dirX,
        dirY,
        speed: Math.max(22, speed * 16),
      };
    } else if (!reduceMotion()) {
      pileTug = null;
      pileAnim = {
        mode: "back",
        el: current.el,
        x: current.x,
        y: current.y,
        vx: stale ? 0 : current.vx * 16,
        vy: stale ? 0 : current.vy * 16,
        startDist: Math.max(dist, 1),
      };
    } else {
      pileTug = null;
    }
    scheduleRender();
  }

  function beginPagePan(event) {
    if (event.button && event.button !== 0) return;
    if (programLocked() || focusOpen() || isFocusFrozen() || isAuthorLightboxOpen()) return;
    pagePan = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastY: event.clientY,
      axis: null,
    };
  }

  function onPagePanMove(event) {
    if (!pagePan || event.pointerId !== pagePan.id) return;
    if (programLocked() || focusOpen() || isFocusFrozen()) {
      pagePan = null;
      return;
    }
    if (!pagePan.axis) {
      const dx = event.clientX - pagePan.x;
      const dy = event.clientY - pagePan.y;
      if (Math.hypot(dx, dy) <= PILE_TAP_PX) return;
      pagePan.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
    }
    if (pagePan.axis !== "y") return;
    const delta = pagePan.lastY - event.clientY;
    pagePan.lastY = event.clientY;
    if (event.cancelable) event.preventDefault();
    postStagePageScroll(delta);
  }

  function endPagePan(event) {
    if (!pagePan || (event && event.pointerId !== pagePan.id)) return;
    const scrolled = pagePan.axis === "y";
    pagePan = null;
    if (scrolled && event?.target instanceof Element) swallowNextClick(event.target);
  }

  function onDeckPointerDown(event) {
    if (stagePile()) {
      onPilePointerDown(event);
      if (!pileDrag) beginPagePan(event);
      return;
    }
    if (document.documentElement.classList.contains("deck-stage") && !isMobile()) {
      if (event.button && event.button !== 0) return;
      if (programLocked() || isAuthorLightboxOpen()) return;
      if (event.target.closest?.(DRAG_IGNORE)) return;
      clearDeckWheel();
      desktopCoast = 0;
      desktopDrag = {
        id: event.pointerId,
        startX: event.clientX,
        startScroll: root.scrollTop || 0,
        lastX: event.clientX,
        lastT: performance.now(),
        vel: 0,
        moved: false,
      };
      return;
    }
    if (!isMobile()) return;
    if (programLocked() || isAuthorLightboxOpen()) return;
    if (event.target.closest?.(DRAG_IGNORE)) return;

    cancelSnap();
    dragInertia = 0;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startProgress: dragProgress,
      lastY: event.clientY,
      lastT: performance.now(),
      vel: 0,
      moved: false,
    };
    deck.classList.add("is-dragging");
    scheduleRender();
    // Touch pointers are implicitly captured by their target; re-capturing on the
    // deck would retarget the follow-up `click` away from the link card's <a>.
    if (event.target.closest?.("[data-link-card]")) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function onDeckPointerMove(event) {
    if (pileDrag && event.pointerId === pileDrag.id) {
      onPilePointerMove(event);
      return;
    }
    if (stagePile()) {
      onPagePanMove(event);
      return;
    }
    if (desktopDrag && event.pointerId === desktopDrag.id) {
      if (programLocked()) {
        desktopDrag = null;
        deck.classList.remove("is-dragging");
        return;
      }
      const dx = event.clientX - desktopDrag.startX;
      if (!desktopDrag.moved && Math.abs(dx) <= 6) return;
      if (!desktopDrag.moved) {
        desktopDrag.moved = true;
        stageUserMoved = true;
        stageInsetFrozen = true;
        deck.classList.add("is-dragging");
      }
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
      root.scrollTop = clamp(desktopDrag.startScroll - dx * desktopDragRatio(), 0, maxTop);
      const now = performance.now();
      const dt = Math.max(1, now - desktopDrag.lastT);
      desktopDrag.vel = (desktopDrag.lastX - event.clientX) / dt;
      desktopDrag.lastX = event.clientX;
      desktopDrag.lastT = now;
      event.preventDefault();
      scheduleRender();
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    if (programLocked()) {
      cancelDeckDrag();
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      drag.moved = true;
    }

    const params = getParams();
    const unit = cardUnitPx(params);
    // Finger up (dy < 0) = native scroll-down: next card comes from the top.
    dragProgress = applyRubber(drag.startProgress + mobilePointerDelta(dy, unit));

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    const vy = (event.clientY - drag.lastY) / dt;
    drag.vel = mobilePointerDelta(vy, unit);
    drag.lastY = event.clientY;
    drag.lastT = now;

    event.preventDefault();
    scheduleRender();
  }

  function endDrag(event) {
    if (pileDrag && (!event || event.pointerId === pileDrag.id)) {
      endPileDrag();
      return;
    }
    if (pagePan && (!event || event.pointerId === pagePan.id)) {
      endPagePan(event);
      return;
    }
    if (stagePile()) return;
    if (desktopDrag && (!event || event.pointerId === desktopDrag.id)) {
      const { moved, vel, lastT } = desktopDrag;
      desktopDrag = null;
      deck.classList.remove("is-dragging");
      const stale = performance.now() - lastT > 48;
      desktopCoast = moved && !stale ? vel * 16 * desktopDragRatio() : 0;
      scheduleRender();
      return;
    }
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { moved, vel, lastT } = drag;
    deck.classList.remove("is-dragging");
    drag = null;
    const max = deckMax();
    if (dragProgress < 0 || dragProgress > max) {
      dragInertia = 0;
      animateProgress(clamp(dragProgress, 0, max));
      return;
    }
    const stale = performance.now() - lastT > 48;
    dragInertia = moved && !stale ? vel * 16 : 0;
    scheduleRender();
  }

  [deck, root].forEach((el) => {
    el.addEventListener("pointerdown", onDeckPointerDown);
    el.addEventListener("pointermove", onDeckPointerMove, { passive: false });
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  });

  document.addEventListener("kaik:cancel-deck-drag", () => {
    pagePan = null;
    if (pileDrag) {
      const id = pileDrag.id;
      pileDrag = null;
      pileTug = null;
      deck.classList.remove("is-dragging");
      try {
        if (pileOrder[0]?.hasPointerCapture?.(id)) pileOrder[0].releasePointerCapture(id);
      } catch {
        // ignore
      }
    }
    if (!drag) return;
    const id = drag.id;
    dragProgress = drag.startProgress;
    cancelDeckDrag();
    for (const el of [deck, root]) {
      try {
        if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
      } catch {
        // ignore
      }
    }
  });

  // Kill page scroll on mobile — cards move only via drag
  const seenWheel = new WeakSet();
  const onDeckWheel = (event) => {
    if (seenWheel.has(event)) return;
    seenWheel.add(event);
    // Desktop hero iframe: an open card or lightbox scrolls only itself.
    // Wheel on the rest of the iframe moves the parent page, not the deck.
    if (
      document.documentElement.classList.contains("deck-stage") &&
      !isMobile() &&
      (programLocked() || isAuthorLightboxOpen()) &&
      !eventFrom(
        event.target,
        ".is-program-open, [data-author-lightbox], [data-project-viewer-root]",
      )
    ) {
      event.preventDefault();
      if (programLocked()) holdFlyLock();
      const pxX = lenisWheelPx(event.deltaX, event.deltaMode, window.innerWidth);
      const pxY = lenisWheelPx(event.deltaY, event.deltaMode, window.innerHeight);
      const horizontal = event.shiftKey || Math.abs(pxX) > Math.abs(pxY);
      if (!horizontal) postStagePageScroll(pxY, true);
      return;
    }
    if (isAuthorLightboxOpen()) {
      event.preventDefault();
      return;
    }
    if (eventFrom(event.target, ".is-program-open")) return;
    if (eventFrom(event.target, "[data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings], [data-sound-settings], .landing-card__enroll, .landing-card__nav a, .landing-card__nav button")) return;
    if (programLocked()) {
      event.preventDefault();
      holdFlyLock();
      return;
    }
    if (isMobile()) {
      event.preventDefault();
      /* Phone stage pile: vertical wheel scrolls the parent page.
         `/` still advances the flying stack. */
      if (stagePile()) {
        if (focusOpen() || isFocusFrozen() || isAuthorLightboxOpen()) return;
        postStagePageScroll(lenisWheelPx(event.deltaY, event.deltaMode, window.innerHeight), true);
        return;
      }
      if (drag) return;
      cancelSnap();
      const unit = cardUnitPx(getParams());
      const px = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (!px) return;
      // Wheel down (deltaY > 0) is native scroll-down — same advance as finger-up.
      const delta = px / unit;
      const raw = dragProgress + delta;
      dragProgress = applyRubber(raw);
      dragInertia = 0;
      scheduleRender();
      return;
    }
    if (document.documentElement.classList.contains("deck-stage")) {
      event.preventDefault();
      const pxX = lenisWheelPx(event.deltaX, event.deltaMode, window.innerWidth);
      const pxY = lenisWheelPx(event.deltaY, event.deltaMode, window.innerHeight);
      const horizontal = event.shiftKey || Math.abs(pxX) > Math.abs(pxY);
      if (horizontal) {
        queueDeckWheel(pxX || pxY);
        return;
      }
      postStagePageScroll(pxY, true);
      return;
    }
    event.preventDefault();
    root.scrollTop += event.deltaY;
    scheduleRender();
  };
  window.addEventListener("wheel", onDeckWheel, { passive: false });
  root.addEventListener("wheel", onDeckWheel, { passive: false, capture: true });

  root.addEventListener("scroll", () => {
    if (isMobile()) {
      if (root.scrollTop !== 0) root.scrollTop = 0;
      return;
    }
    if (freezeY == null) return;
    if (root.scrollTop !== freezeY) root.scrollTop = freezeY;
  });

  new MutationObserver(() => {
    // The open card leaves .deck for the focus layer, so the lock attr is
    // not always a deck descendant.
    flyLockedFlag = Boolean(document.querySelector("[data-fly-lock]"));
    holdFlyLock();
    scheduleRender();
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    // data-program-open lives on the deck: closing must wake the loop
    // or siblings stay fanned until fly-lock drops (~full FLY_MS late).
    attributeFilter: ["data-fly-lock", "data-program-open"],
  });

  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    applyDeckParams();
    syncDeckCount();
    parkLoopTwin();
    root.scrollTop = 0;
    if (isMobile()) {
      cancelDeckDrag();
      cancelSnap();
      dragInertia = 0;
      dragProgress = 0;
    }
    pileDrag = null;
    pileAnim = null;
    pileTug = null;
    clearDeckWheel();
    desktopCoast = 0;
    deck.classList.remove("is-dragging");
    ensurePileOrder();
    lastDeckProgress = null;
    lastDesktopDeltaAt = 0;
    refreshCardBox();
    scheduleRender();
  });

  if (isMobile()) root.scrollTop = 0;

  const holdStageIntro = deckStageIntroHeld();
  deckIntro =
    canPlayCardIntro() && !holdStageIntro
      ? createDeckIntro(liveCount(), deckIntroOptions(liveCount()))
      : null;
  if (!deckIntro && !holdStageIntro) {
    markIntroReady();
    if (canPlayTextIntro()) playTextIntro();
    else markIntroDone();
  }

  /** After the desktop stage settles, nudge the fan right until the left card clears. */
  function fitStageInset(scale, mobile) {
    if (stageInsetFrozen || stageUserMoved || desktopDrag || deckIntro || deckOutro) return;
    if (mobile || !document.documentElement.classList.contains("deck-stage")) return;
    const cards = [...deck.querySelectorAll(".card")].filter(
      (el) => inDeckFlow(el) && el.parentElement === deck,
    );
    if (!cards.length) return;
    let minLeft = Infinity;
    for (const card of cards) {
      const left = card.getBoundingClientRect().left;
      if (left < minLeft) minLeft = left;
    }
    const title = deck.querySelector(".author-card__title");
    if (title) minLeft = Math.min(minLeft, title.getBoundingClientRect().left);
    if (!Number.isFinite(minLeft)) return;
    const deficit = STAGE_EDGE - minLeft;
    if (deficit > 0.5) {
      stageInsetX += deficit / Math.max(Number(scale) || 1, 0.01);
      scheduleRender();
      return;
    }
    stageInsetFrozen = true;
  }

  function render() {
    raf = 0;
    if (document.visibilityState === "hidden" || deckConcealed) return;
    if (isFocusFrozen()) {
      pileTug = null;
      clearDeckWheel();
      if (deckIntro) {
        deckIntro = null;
        cancelIntroAnimations();
      }
      holdFlyLock();
      return;
    }
    const params = getParams();
    const mobile = isMobile();
    // Hidden stage preload: leave the stylesheet park (100vw / -100vh).
    // An inline rest pose would show the stack the moment the iframe is revealed.
    if (
      document.documentElement.classList.contains("deck-stage") &&
      !deckIntro &&
      !deckOutro &&
      !document.documentElement.classList.contains("intro-ready")
    ) {
      return;
    }
    const items = liveItems();
    const count = items.length;
    const { width: vw, height: vh } = getViewportSize();
    const totalScroll = maxProgress(count, params);
    const fan = mobile ? params.fanScale ?? 0.3 : 1;
    const travel = mobile ? 0 : vw * params.travelMult;

    const locked = programLocked();
    if (!locked && mobile && !drag) {
      if (snapAnim) {
        const u = clamp((performance.now() - snapAnim.t0) / snapAnim.dur, 0, 1);
        dragProgress = lerp(snapAnim.from, snapAnim.to, u);
        if (u >= 1) {
          const done = snapAnim.onDone;
          dragProgress = snapAnim.to;
          snapAnim = null;
          if (done) afterPoseFrame(done);
        }
      } else {
        const max = deckMax();
        if (dragProgress < 0 || dragProgress > max) {
          dragInertia = 0;
          animateProgress(dragProgress < 0 ? 0 : max);
        } else if (Math.abs(dragInertia) > INERTIA_MIN) {
          dragProgress += dragInertia;
          dragInertia *= INERTIA_FRICTION;
          if (dragProgress <= 0) {
            dragProgress = 0;
            dragInertia = 0;
          } else if (dragProgress >= max) {
            dragProgress = max;
            dragInertia = 0;
          }
        } else {
          dragInertia = 0;
        }
      }
    }

    holdFlyLock();
    if (!mobile && document.documentElement.classList.contains("deck-stage") && !desktopDrag) {
      if (deckWheelTarget != null && freezeY == null && !locked && !focusOpen()) {
        const wheelNow = performance.now();
        const dt = deckWheelAt ? (wheelNow - deckWheelAt) / 1000 : 0;
        deckWheelAt = wheelNow;
        if (dt > 0) {
          const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
          deckWheelTarget = clamp(deckWheelTarget, 0, maxTop);
          let value = lenisDamp(root.scrollTop || 0, deckWheelTarget, dt);
          if (Math.round(value) === Math.round(deckWheelTarget)) {
            value = deckWheelTarget;
            clearDeckWheel();
          }
          if (root.scrollTop !== value) root.scrollTop = value;
        }
      } else if (deckWheelTarget != null) {
        clearDeckWheel();
      } else if (Math.abs(desktopCoast) > 0.35) {
        const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
        const next = clamp((root.scrollTop || 0) + desktopCoast, 0, maxTop);
        if (root.scrollTop !== next) root.scrollTop = next;
        desktopCoast *= INERTIA_FRICTION;
        if (Math.abs(desktopCoast) < 0.35 || next <= 0 || next >= maxTop) desktopCoast = 0;
      }
    }
    const y = freezeY != null ? freezeY : mobile ? dragProgress : root.scrollTop || 0;
    const span = focusSpanOf(params);
    const cardProgress = mobile
      ? y / Math.max(0.25, span)
      : y / Math.max(1, params.scrollPerCard);
    const prevProgress = lastDeckProgress;
    lastDeckProgress = cardProgress;
    const deckDelta = prevProgress == null ? 0 : cardProgress - prevProgress;
    const yPx = mobile ? y * cardUnitPx(params) : y;
    const now = performance.now();
    if (!mobile && Math.abs(deckDelta) > 1e-6) lastDesktopDeltaAt = now;
    const deckActive =
      Boolean(drag) ||
      Boolean(snapAnim) ||
      Math.abs(dragInertia) > INERTIA_MIN ||
      (!mobile && lastDesktopDeltaAt > 0 && now - lastDesktopDeltaAt < 80);
    if (prevProgress != null && (deckActive || Math.abs(deckDelta) > 1e-6)) {
      document.dispatchEvent(
        new CustomEvent("kaik:deck-progress", {
          detail: {
            progress: cardProgress,
            delta: deckDelta,
            yPx,
            active: deckActive,
            mobile,
          },
        }),
      );
    }
    const originY = 0;
    const p = clamp(totalScroll ? y / totalScroll : 0, 0, 1);
    const focusing = focusOpen();

    // Pointer target stops updating once locked (pointermove guard), and the
    // eased value holds too, so a card handed back from program-modal lands
    // on exactly the snapshot pose it left with, then eases to the live cursor.
    if (!locked && !mobile) {
      pointerSmooth.x = easeTo(pointerSmooth.x, pointer.x, params.pointerLerp);
      pointerSmooth.y = easeTo(pointerSmooth.y, pointer.y, params.pointerLerp);
    }

    let pileY = 0;
    if (mobile && stagePile()) {
      ensurePileOrder();
      if (!locked) stepPileAnim();
      if (!locked && !focusOpen()) stepPileTug();
      else pileTug = null;
      pileY = pileRestY(vh);
    } else if (pileTug) {
      pileTug = null;
    }

    /* Phone stage exit only (≤760). The flight is one viewport wide and the
       rotated pile still leaves a tip on the right. 32px more, and only on
       the way out — progress 0 stays on the open pile. Desktop keeps `vw`. */
    const outroDistance =
      mobile && stagePile() && window.matchMedia("(max-width: 760px)").matches ? vw + 32 : vw;

    items.forEach((item, i) => {
      const t = mobile ? 0 : cardFlightT(i, count, params, p);
      const slot = mobileStackSlot(i, mobile ? Math.max(0, y) : y, focusSpanOf(params));

      if (item.el.hasAttribute("data-rest-lock")) {
        // Landed home by program-modal (exact snapshot pose). Hold it while
        // another card is still focused/closing; hand back to the loop on the
        // first free frame — same y, so the pose below equals the snapshot.
        if (focusing) {
          if (hoveredIndex === i) hoveredIndex = -1;
          item.hoverTarget = item.hover;
          if (mobile) {
            item.el.style.zIndex = String(count - i);
            item.el.style.opacity = "1";
          }
          setStackHit(item.el, { mobile, inert: false });
          return;
        }
        item.el.removeAttribute("data-rest-lock");
      }

      const flyLocked =
        item.el.hasAttribute("data-fly-lock") ||
        item.el.classList.contains("is-program-open") ||
        item.el.classList.contains("is-fly-pinned");
      if (flyLocked) {
        // Focus already zeroed hover and the cursor. Keep them there so the
        // close handoff matches the un-hovered stack pose.
        if (hoveredIndex === i) hoveredIndex = -1;
        item.hoverTarget = item.hover;
        if (mobile) {
          item.el.style.zIndex = stagePile() ? "80" : String(count - i);
          item.el.style.opacity = "1";
        }
        setStackHit(item.el, { mobile, inert: false });
        return;
      }

      if (mobile && stagePile()) {
        const active = pileDrag?.el || pileAnim?.el || null;
        const depth = pileDepth(item.el);
        const peek = pileOffset(depth);
        const extraX = active === item.el ? pileDrag?.x ?? pileAnim?.x ?? 0 : 0;
        const extraY = active === item.el ? pileDrag?.y ?? pileAnim?.y ?? 0 : 0;
        const arriving = pileAnim?.mode === "arrive" && active === item.el;
        const tilt = active === item.el ? (arriving ? pileAnim.tilt || 0 : pileDragTilt(extraX)) : 0;
        const follow = active === item.el ? { x: 0, y: 0, r: 0 } : pileFollow(item.el);
        const pileIndex = Math.max(0, pileOrder.indexOf(item.el));
        const introShift = deckIntro ? deckIntro.shift(i, now, vw) : 0;
        const outroShift = deckOutro ? deckOutro.shift(pileIndex, now, outroDistance) : 0;
        const x = peek.x + extraX + follow.x + introShift + outroShift;
        const yPos = pileY + peek.y + extraY + follow.y;
        const rot = (arriving ? 0 : peek.r) + tilt + follow.r;
        const pose = `translate3d(${x}px, ${yPos}px, 0) rotateZ(${rot}deg) rotateY(0deg) rotateX(0deg) scale(1)`;
        if (item.el.style.transform !== pose) item.el.style.transform = pose;
        if (item.el.style.opacity !== "1") item.el.style.opacity = "1";
        const lifted =
          pileDrag?.moved || pileAnim?.mode === "off" ? pileDrag?.el || pileAnim?.el : null;
        const clickable = lifted ? pileOrder[1] || pileOrder[0] : pileOrder[0];
        const inert = item.el !== clickable;
        if (item.inert !== inert) {
          item.inert = inert;
          setStackHit(item.el, { mobile: true, inert });
        }
        const z = String(
          active === item.el && !arriving ? count + 5 : count - Math.min(count, Math.round(depth)),
        );
        if (item.el.style.zIndex !== z) item.el.style.zIndex = z;
        return;
      }

      item.hoverTarget = !mobile && !locked && hoveredIndex === i ? 1 : 0;
      item.hover = mobile
        ? item.hoverTarget
        : easeTo(item.hover, item.hoverTarget, params.hoverLerp);

      // Cursor offset is zeroed when focus freezes, so this stays 0 until thaw.
      const depth = Math.pow(params.cursorFalloff, i);
      const pointerAmt = mobile ? 0 : depth;
      const parallaxX = pointerSmooth.x * params.parallaxX * pointerAmt;
      const parallaxY = pointerSmooth.y * params.parallaxY * pointerAmt;
      const cursorRotY = pointerSmooth.x * params.cursorTiltY * pointerAmt;
      const cursorRotX = -pointerSmooth.y * params.cursorTiltX * pointerAmt;
      const cursorRotZ = pointerSmooth.x * params.cursorTiltZ * pointerAmt * 0.65;

      const baseX = item.baseX * fan;
      const baseY = mobile ? 0 : item.baseY * fan;

      const cardH = cardBoxH || vh * 0.55;
      const flyExit =
        mobile && normalizeViewMode(params.viewMode) === "fly" && !reduceMotion();
      let tossX = mobile ? 0 : params.travelDir * t * travel;
      let tossY;
      let stackScale = 1;
      if (mobile) {
        const lift = Number.isFinite(Number(params.stackLift)) ? Number(params.stackLift) : 3;
        const rear = clamp(Number(params.rearScale) || 0.55, 0.2, 1);
        const curve = Math.max(0.2, Number(params.scaleProgress) || 1);
        if (slot >= 0) {
          const depthT = clamp(slot, 0, 5) / 5;
          stackScale = lerp(1, rear, depthT ** curve);
          const scaleComp = (cardH * (1 - stackScale)) / 2;
          tossY = -slot * lift - scaleComp;
        } else if (flyExit) {
          const exitT = clamp(-slot / flyExitSpanOf(params), 0, 1);
          const cardW = cardBoxW || 320;
          const dist = flyLeaveDist(vw, cardW, params);
          const arc = flyExitPose(exitT, dist, params);
          tossX = arc.x;
          tossY = arc.y;
          stackScale = arc.scale;
        } else {
          const pass = clamp(-slot, 0, 1);
          stackScale = 1;
          tossY = pass * 16;
        }
        if (y < 0) {
          const rubberT = clamp(-y / REVERSE_RUBBER_MAX, 0, 1);
          stackScale *= lerp(1, REVERSE_RUBBER_SCALE, rubberT);
          tossY += -REVERSE_RUBBER_PX * rubberT;
        }
      } else {
        tossY = t * (i % 2 === 0 ? -params.driftY : params.driftY);
      }
      const scrollX = baseX + tossX;
      const scrollY = baseY - originY + tossY;
      const stackOpacity = (() => {
        if (!mobile || focusing) return 1;
        if (slot >= 0) return 1;
        if (flyExit) {
          const cardW = cardBoxW || 320;
          return flyCardClearedIframe(tossX, vw, cardW, stackScale) ? 0 : 1;
        }
        return clamp(1 + slot * 1.25, 0, 1);
      })();

      // Square cards (old works board, letterfolio link card) share the works shift
      // so the wider face stays balanced against the right-pinned A4 stack.
      const worksCard =
        item.el.hasAttribute("data-works-card") || item.el.hasAttribute("data-link-card");
      const worksX = worksCard ? Number(params.worksShiftX) || 0 : 0;
      const worksY = worksCard ? Number(params.worksShiftY) || 0 : 0;
      const worksR = worksCard ? Number(params.worksRotate) || 0 : 0;
      const programCard = item.el.hasAttribute("data-program-card");

      const introX = deckIntro && !flyLocked && !mobile ? deckIntro.shift(i, now, vw) : 0;
      const outroX = deckOutro && !flyLocked && !mobile ? deckOutro.shift(i, now, vw) : 0;
      const introY = deckIntro && !flyLocked && mobile ? deckIntro.shift(i, now, -vh) : 0;
      const stageDesktop =
        !mobile && document.documentElement.classList.contains("deck-stage");
      const fanX = stageDesktop
        ? stageFanLocal(i, count, vw, Number(params.deckScale) || 1)
        : 0;
      let flightX = tossX;
      if (stageDesktop && i === count - 1) {
        const settled = stageLastFlightX(
          item.el,
          deck,
          vw,
          Number(params.deckScale) || 1,
          p,
          baseX + fanX + worksX,
          count,
          params,
        );
        if (settled != null) flightX = settled;
      }
      const x =
        baseX + flightX + parallaxX + worksX + introX + fanX + outroX + (stageDesktop ? stageInsetX : 0);
      const yPos = scrollY + parallaxY - item.hover * params.hoverLift + worksY + introY;

      const twist = mobile
        ? Number.isFinite(Number(params.cardRotate))
          ? Number(params.cardRotate)
          : 1
        : 1;
      const rotateZ =
        (mobile && programCard ? PROGRAM_MOBILE_ROTATE : item.baseRotate * twist) +
        t * item.tip * params.tipScale +
        cursorRotZ +
        worksR;
      const rotateY =
        t * (params.rotateYBase + i * params.rotateYStep) * (i % 2 === 0 ? 1 : -1) + cursorRotY;
      const rotateX =
        t * params.rotateXAmt * (i % 2 === 0 ? -1 : 1) + cursorRotX;

      const pose = `translate3d(${x}px, ${yPos}px, 0) rotateZ(${rotateZ}deg) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${stackScale})`;
      if (item.el.style.transform !== pose) item.el.style.transform = pose;
      const nextOpacity = mobile ? String(stackOpacity) : "";
      if (item.el.style.opacity !== nextOpacity) item.el.style.opacity = nextOpacity;
      // Peeking rear cards and still-visible leaving cards stay hittable.
      // Only a fully gone card (opacity 0) is inert, so the tap hits the
      // topmost painted card under the finger instead of falling through.
      const inert = mobile && stackOpacity < 0.02;
      if (item.inert !== inert) {
        item.inert = inert;
        setStackHit(item.el, { mobile, inert });
      }
      if (mobile) {
        // Current/earlier cards stay in front while they fade, next sits underneath.
        const z = String(count - i);
        if (item.el.style.zIndex !== z) item.el.style.zIndex = z;
      } else if (!item.el.matches(FOCUS_SEL)) {
        const z = String(item.baseZ);
        if (item.el.style.zIndex !== z) item.el.style.zIndex = z;
      } else if (item.el.style.zIndex) {
        item.el.style.zIndex = "";
      }
    });

    if (deckIntro && !deckIntro.armed) {
      deckIntro.arm(now);
      markIntroReady();
    }
    if (deckIntro && !mobile && !deckStageIntroHeld()) syncDeckIntroSounds(deckIntro, count, now);
    if (deckIntro?.done(now)) {
      deckIntro = null;
      if (canPlayTextIntro()) playTextIntro();
      else markIntroDone();
    }
    if (deckOutro && !deckOutro.armed) deckOutro.arm(now);
    if (deckOutro?.done(now)) {
      deckOutro = null;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "kaik:deck-stage-outro-done" }, "*");
      }
    }

    if (document.visibilityState === "hidden") return;
    fitStageInset(params.deckScale, mobile);
    if (needsDeckFrame(mobile)) scheduleRender();
  }

  onFrameMetrics(() => {
    if (isFocusFrozen()) return;
    if (!stageUserMoved) stageInsetFrozen = false;
    refreshCardBox();
    scheduleRender();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleRender();
  });
  document.addEventListener("kaik:focus-thawed", () => {
    refreshCardBox();
    scheduleRender();
  });
  // Snapshot reads the live pose first. This runs from lockCard, after that
  // snapshot, so the open flight can still start on the hovered pixels.
  document.addEventListener("kaik:focus-frozen", () => {
    hoveredIndex = -1;
    pointer.x = 0;
    pointer.y = 0;
    pointerSmooth.x = 0;
    pointerSmooth.y = 0;
    state.forEach((item) => {
      item.hover = 0;
      item.hoverTarget = 0;
      item.el.classList.remove("is-hovered");
    });
  });
  document.addEventListener("kaik:focus-home", (event) => {
    const detail = event.detail;
    if (!detail) return;
    const params = getParams();
    const mobile = isMobile();
    const byEl = new Map();
    liveItems().forEach((item, i) => {
      const tf = item.el.style.transform || "";
      const tr = tf.match(
        /translate3d\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px/i,
      );
      if (!tr) return;
      const ang = (name) => {
        const m = tf.match(
          new RegExp(`${name}\\(\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)deg`, "i"),
        );
        return m ? Number.parseFloat(m[1]) : 0;
      };
      const scaleM = tf.match(/scale\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*\)/i);
      const scale = scaleM ? scaleM[1] : "1";
      const pointerAmt = mobile ? 0 : Math.pow(params.cursorFalloff, i);
      const parallaxX = pointerSmooth.x * params.parallaxX * pointerAmt;
      const parallaxY = pointerSmooth.y * params.parallaxY * pointerAmt;
      const cursorRotY = pointerSmooth.x * params.cursorTiltY * pointerAmt;
      const cursorRotX = -pointerSmooth.y * params.cursorTiltX * pointerAmt;
      const cursorRotZ = pointerSmooth.x * params.cursorTiltZ * pointerAmt * 0.65;
      const x = Number.parseFloat(tr[1]) - parallaxX;
      const y = Number.parseFloat(tr[2]) - parallaxY + item.hover * params.hoverLift;
      const rotateZ = ang("rotateZ") - cursorRotZ;
      const rotateY = ang("rotateY") - cursorRotY;
      const rotateX = ang("rotateX") - cursorRotX;
      byEl.set(
        item.el,
        {
          transform: `translate3d(${x}px, ${y}px, 0) rotateZ(${rotateZ}deg) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${scale})`,
        },
      );
    });
    detail.byEl = byEl;
  });
  const revealHost = deckStageFrameHost();
  if (revealHost) {
    const wakeDeck = () => {
      const next = deckStageConcealed();
      if (next && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const was = deckConcealed;
      deckConcealed = next;
      if (was && !next) scheduleRender();
    };
    const parentDoc = revealHost.ownerDocument;
    if (parentDoc.body) {
      new MutationObserver(wakeDeck).observe(parentDoc.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    new MutationObserver(wakeDeck).observe(revealHost, {
      attributes: true,
      attributeFilter: ["hidden", "class", "style"],
    });
  }
  scheduleRender();

  function programCardIndex() {
    return state.findIndex((item) => item.el.hasAttribute("data-program-card"));
  }

  function worksCardIndex() {
    return state.findIndex((item) => item.el.hasAttribute("data-works-card"));
  }

  function revealIndex(index, onReady) {
    const done = typeof onReady === "function" ? onReady : () => {};
    if (index < 0) {
      done();
      return;
    }

    const params = getParams();
    const target = (() => {
      if (isMobile()) return clamp(index * focusSpanOf(params), 0, deckMax());
      const y = scrollYForCard(index, liveCount(), params);
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
      return clamp(y, 0, maxTop || maxProgress(liveCount(), params));
    })();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (isMobile()) {
      cancelDeckDrag();
      if (reduced || Math.abs(dragProgress - target) < 0.002) {
        cancelSnap();
        dragProgress = target;
        scheduleRender();
        afterPoseFrame(done);
        return;
      }
      animateProgress(target, done);
      return;
    }

    const current = root.scrollTop || 0;
    if (reduced || Math.abs(current - target) < 4) {
      root.scrollTop = target;
      afterPoseFrame(done);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      root.removeEventListener("scrollend", finish);
      window.clearTimeout(fallback);
      if (Math.abs((root.scrollTop || 0) - target) > 8) root.scrollTop = target;
      afterPoseFrame(done);
    };
    const fallback = window.setTimeout(finish, 1400);
    root.addEventListener("scrollend", finish, { once: true });
    root.scrollTo({ top: target, behavior: "smooth" });
  }

  /**
   * Seek so `[data-program-card]` is the current stack card
   * (invert render() flight, not last `data-focus-card` / track end), then run onReady.
   */
  function revealProgram(onReady) {
    revealIndex(programCardIndex(), onReady);
  }

  /**
   * Seek so `[data-works-card]` (grey student works, not olive progress)
   * is the current stack card, then run onReady.
   */
  function revealWorks(onReady) {
    revealIndex(worksCardIndex(), onReady);
  }

  if (document.documentElement.classList.contains("deck-stage")) {
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      const type = event.data?.type;
      if (type === "kaik:deck-stage-intro") {
        deckOutro = null;
        pileDrag = null;
        pileAnim = null;
        pileTug = null;
        clearDeckWheel();
        desktopCoast = 0;
        desktopDrag = null;
        deck.classList.remove("is-dragging");
        stageInsetX = 0;
        stageInsetFrozen = false;
        stageUserMoved = false;
        root.scrollTop = 0;
        pileOrder = liveItems().map((item) => item.el);
        document.documentElement.classList.remove("intro-ready", "intro-text", "intro-done");
        document.querySelectorAll(".deck .card").forEach((card) => {
          card.style.transform = "";
        });
        const arm = (tries = 0) => {
          if (reduceMotion()) {
            markIntroReady();
            markIntroDone();
            scheduleRender();
            return;
          }
          // A just-shown desktop frame can still report the mobile query.
          // After a few frames a real phone is still narrow and plays the pile intro.
          if (!deckStageWide() && tries < 8) {
            requestAnimationFrame(() => arm(tries + 1));
            return;
          }
          deckIntro = createDeckIntro(liveCount(), deckIntroOptions(liveCount()));
          if (deckStageWide()) primeDeckStageScroll();
          scheduleRender();
        };
        arm();
        return;
      }
      if (type === "kaik:deck-stage-drag-speed") {
        deckStageDragScale = clampDeckStageDragScale(event.data?.scale);
        return;
      }
      if (type === "kaik:deck-stage-card-scale") {
        setDeckStageCardScale(event.data?.scale);
        refreshCardBox();
        if (!stageUserMoved) stageInsetFrozen = false;
        scheduleRender();
        return;
      }
      if (type !== "kaik:deck-stage-outro") return;
      document.dispatchEvent(new CustomEvent("kaik:deck-stage-dismiss-focus"));
      closeDeckStageViewers();
      deckIntro = null;
      pileDrag = null;
      pileAnim = null;
      pileTug = null;
      clearDeckWheel();
      desktopCoast = 0;
      desktopDrag = null;
      deck.classList.remove("is-dragging");
      if (!reduceMotion()) {
        deckOutro = createDeckOutro(liveCount());
        if (!isMobile()) playFlySound();
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "kaik:deck-stage-outro-done" }, "*");
      }
      scheduleRender();
    });
  }

  return { revealProgram, revealWorks, revealIndex };
}

const PROGRAM_NAV = "[data-program-nav], [data-i18n='nav.program']";
const WORK_NAV = "[data-work-nav], [data-i18n='nav.work']";

/** Same fly-open as tapping the card — no hash/deck seek first. */
function bindNavOpen(selector, programApi, isCurrent, open) {
  if (!programApi) return;
  document.querySelectorAll(selector).forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isCurrent()) return;
      open();
    });
  });
}

function bindProgramNav(programApi) {
  bindNavOpen(
    PROGRAM_NAV,
    programApi,
    () => programApi.isProgramFocused?.(),
    () => programApi.open(),
  );
}

function bindWorkNav(programApi) {
  // No works board in the deck (letterfolio link card took its slot): the nav
  // link keeps its own href/target and navigates instead of focusing a card.
  if (!document.querySelector("[data-works-card]")) return;
  bindNavOpen(
    WORK_NAV,
    programApi,
    () => programApi.isWorksFocused?.(),
    () => programApi.openWorks(),
  );
}

if (document.documentElement.classList.contains("deck-stage")) {
  document
    .querySelectorAll("[data-landing-card], [data-link-card], [data-deck-loop]")
    .forEach((el) => el.remove());
}

/**
 * Desktop stage rest fan, in deck-local px (the deck is scaled).
 * Scroll cannot make this shape: the lead curve throws card 0 off the left
 * before the cards behind it move. Card 0 stays on the left shift; each card
 * behind steps right so the pile overlaps across the frame. `/` never calls this.
 */
function stageFanLocal(index, count, vw, scale) {
  if (index <= 0 || count <= 1) return 0;
  const s = Math.max(scale || 1, 0.01);
  // History card's visual right at scroll 0 on a 1135px frame, then the extra
  // left shift as the frame grows (right pin += 20% of width, times deck scale).
  const lastRight = 651 - (vw - 1135) * 0.2 * s;
  const span = Math.max(0, vw - 28 - lastRight);
  const visualStep = clamp(span / (count - 1), 28, 170);
  return (index * visualStep) / s;
}

/** Share of the frame kept clear past the history card's right edge.
 *  The rest mark is the pink block on the inner right: about a fifth of the
 *  frame, not a sliver against the window. */
const STAGE_LAST_INSET = 0.19;
/** Layout target sits a little further in than the painted edge. The history
 *  card's rest rotate grows the axis-aligned box past the unrotated right. */
const STAGE_LAST_ROTATE_PAD = 16;

/**
 * Local toss for the last in-flow desktop stage card.
 * The opening fan is p = 0 (toss 0). The card then rides the penultimate
 * card's lead curve, so it is parked once that card has landed, and the
 * leftover track does not keep dragging it. At full progress the right edge
 * sits `STAGE_LAST_INSET` of the frame inside the viewport.
 * `/` and mobile never call this.
 */
function stageLastFlightX(card, deckEl, vw, scale, p, parkedX, count, params) {
  const s = Math.max(scale || 1, 0.01);
  const layoutRight = card.offsetLeft + card.offsetWidth;
  if (!(layoutRight > 0) || !(vw > 0)) return null;
  const deckLeft = deckEl.getBoundingClientRect().left;
  const margin = vw * STAGE_LAST_INSET + STAGE_LAST_ROTATE_PAD;
  const settleX = (vw - margin - deckLeft) / s - layoutRight;
  const flightEnd = settleX - parkedX;
  if (!(flightEnd < 0)) return 0;
  return stageLastFlightU(count, params, p) * flightEnd;
}

/** 0 at the opening fan, 1 once the card before the last has finished flying. */
function stageLastFlightU(count, params, p) {
  const prev = Math.max(0, (count || 1) - 2);
  return clamp(cardFlightT(prev, Math.max(count || 1, 2), params, p), 0, 1);
}

/**
 * Desktop stage opens a step into the flight, not at scroll 0.
 * Card 0 moves left until it sits on the left half; the cards behind barely
 * move yet, so the author and program stay overlapped and the tail still
 * hangs off the right. Mobile peel is untouched.
 */
function primeDeckStageScroll() {
  if (!document.documentElement.classList.contains("deck-stage") || isMobile()) return;
  const root = getScrollRoot();
  const front = document.querySelector("[data-deck] [data-card]");
  if (!root || !front) return;
  const params = getParams();
  const count = [...document.querySelectorAll("[data-card]")].filter((el) => inDeckFlow(el)).length;
  if (count < 2) return;
  const scale = Math.max(Number(params.deckScale) || 1, 0.01);
  const targetLeft = 40;
  const baseX = Number(front.dataset.baseX) || 0;
  // Before the first frame, CSS parks every card at translateX(100vw).
  // Undo that, then add the deck's own baseX, to read the scroll-0 edge.
  const parked = !document.documentElement.classList.contains("intro-ready");
  const park = parked ? window.innerWidth * scale : 0;
  const currentLeft = front.getBoundingClientRect().left - park + baseX * scale;
  const need = currentLeft - targetLeft;
  if (need < 12) return;
  const { width: vw } = getViewportSize();
  const travel = Math.max((vw || window.innerWidth) * (Number(params.travelMult) || 1.1), 1);
  const targetT = clamp(need / scale / travel, 0, 0.24);
  const total = maxProgress(count, params);
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 24; n += 1) {
    const mid = (lo + hi) / 2;
    if (cardFlightT(0, count, params, mid) < targetT) lo = mid;
    else hi = mid;
  }
  root.scrollTop = hi * total;
}

function bindDeckStageEscape() {
  if (!document.documentElement.classList.contains("deck-stage")) return;
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      const deck = document.querySelector("[data-deck]");
      const busy =
        isAuthorLightboxOpen() ||
        Boolean(deck?.hasAttribute("data-program-open")) ||
        Boolean(deck?.querySelector("[data-fly-lock], .is-program-open, .is-fly-pinned"));
      if (busy || !window.parent || window.parent === window) return;
      event.preventDefault();
      window.parent.postMessage({ type: "kaik:deck-stage-close" }, "*");
    },
    true,
  );
}

initEmbed();
initLocale();
initTweaks();
initStageSettings();
initTickClicks();
initSoundSettings();
// The progress sheets must exist before the deck and program modal query them.
initStudentProgress();
initDeck();
primeDeckStageScroll();
initTextAppear();
const programApi = initProgramModal();
bindProgramNav(programApi);
bindWorkNav(programApi);
initAuthorLightbox();
initImgSliders();
initProgramStrips();
initProjectViewer();
initFormatVideo();
initPreviewMedia();
initDropcaps();
initWorksFeed();
bindDeckStageEscape();
