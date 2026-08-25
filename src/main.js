import { getScrollRoot, getViewportSize, initEmbed, onFrameMetrics } from "./embed.js";
import { initFormatVideo } from "./format-video.js";
import { initTickClicks } from "./tick-clicks.js";
import { initSoundSettings } from "./sound-settings.js";
import { initStageSettings } from "./stage-settings.js";
import { playFirstScrollFromGesture } from "./lib/sound-catalog.js";
import { initImgSliders } from "./img-slider.js";
import { desktopFocusDestVisual, initProgramModal } from "./program-modal.js";
import { initDropcaps } from "./letters/dropcap.js";
import { applyTranslations, getLocale, setLocale } from "./scriptik.js";
import {
  canPlayCardIntro,
  canPlayTextIntro,
  createDeckIntro,
  markIntroDone,
  markIntroReady,
  playTextIntro,
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
} from "./tweaks.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
/** Mobile stack only: keep the green program card nearly flat (not cardRotate × −6.52°). */
const PROGRAM_MOBILE_ROTATE = -1;

function initLocale() {
  applyTranslations(getLocale());

  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLocale(btn.getAttribute("data-lang"));
    });
  });
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

/**
 * Desktop: scroll-driven stack + cursor parallax (right → left).
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
    hover: 0,
    inert: false,
    /** Un-spread visual box; never a live dest/fly rect. */
    home: null,
  }));

  const pointer = { x: 0, y: 0 };
  const gyro = { x: 0, y: 0 };
  const pointerSmooth = { x: 0, y: 0 };
  let hoveredIndex = -1;
  let raf = 0;
  let motionEnabled = false;
  let cardBoxH = 0;
  let cardBoxW = 0;
  let deckScaleCached = 1;
  let flyLockedFlag = false;
  /** First-load card deal; assigned after listeners, sampled every frame while armed. */
  let deckIntro = null;

  /** Virtual progress used on mobile instead of page scroll (card units: 0 = first on top) */
  let dragProgress = 0;
  /** Last emitted card-unit progress; `null` until the first render sample. */
  let lastDeckProgress = null;
  /** Desktop: last time scrollTop moved, so inertia/wheel bursts stay `active`. */
  let lastDesktopDeltaAt = 0;
  /** Leftover velocity after a flick (card units per frame); decays with friction. */
  let dragInertia = 0;
  /** @type {null | { from: number, to: number, t0: number, dur: number, onDone?: (() => void) | null }} */
  let snapAnim = null;
  /** @type {null | { id: number, startX: number, startY: number, startProgress: number, lastY: number, lastT: number, vel: number, moved: boolean }} */
  let drag = null;
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
  let spread = 0;
  let spreadFrom = 0;
  let spreadTarget = 0;
  let spreadT0 = 0;
  /** @type {null | { x: number, y: number, r: number }[]} */
  let spreadPlan = null;
  let spreadPlanFrom = null;
  let spreadPlanFor = -2;
  let spreadMix = 1;
  let spreadMixT0 = 0;
  const SPREAD_MS = 920;
  const SPREAD_OUT_MS = 1100;
  const FOCUS_SEL = "[data-card]";
  const programIndex = state.findIndex((item) => item.el.hasAttribute("data-program-card"));
  flyLockedFlag = Boolean(deck.querySelector("[data-fly-lock]"));
  const lockup = document.querySelector("[data-lockup]");
  if (lockup) {
    lockup.style.transform = "";
    lockup.style.visibility = "";
  }

  const programLocked = () => flyLockedFlag;
  const reduceMotionSpread = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  function refreshDeckScale() {
    deckScaleCached =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--deck-scale"),
      ) || 1;
  }

  refreshCardBox();
  refreshDeckScale();

  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(render);
  }

  function needsDeckFrame(mobile) {
    if (deckIntro) return true;
    if (spread !== spreadTarget || spreadMix < 1) return true;
    if (drag || snapAnim) return true;
    if (Math.abs(dragInertia) > INERTIA_MIN) return true;
    if (mobile) return false;
    if (hoveredIndex >= 0) return true;
    for (const item of state) {
      if (item.hover > 0.002) return true;
    }
    if (Math.abs(pointerSmooth.x - pointer.x) > 0.002) return true;
    if (Math.abs(pointerSmooth.y - pointer.y) > 0.002) return true;
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
    if (reduceMotionSpread() || Math.abs(from - target) < 0.002) {
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

  function spreadEase(t) {
    const x = clamp(t, 0, 1);
    return 1 - (1 - x) ** 4;
  }

  /** Match `--fly-ease`: cubic-bezier(0.22, 1, 0.32, 1). */
  const flyEase = (() => {
    const cx = 3 * 0.22;
    const bx = 3 * (0.32 - 0.22) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * 1;
    const by = 3 * (1 - 1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleDx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    return (t) => {
      const time = clamp(t, 0, 1);
      let x = time;
      for (let i = 0; i < 6; i += 1) {
        const z = sampleX(x) - time;
        const d = sampleDx(x);
        if (Math.abs(z) < 1e-5 || Math.abs(d) < 1e-6) break;
        x -= z / d;
      }
      return sampleY(x);
    };
  })();

  function spreadAt(plan, i) {
    return plan?.[i] ?? { x: 0, y: 0, r: 0 };
  }

  function mixedSpread(i) {
    const to = spreadAt(spreadPlan, i);
    if (!spreadPlanFrom || spreadMix >= 1) return to;
    const from = spreadAt(spreadPlanFrom, i);
    return {
      x: lerp(from.x, to.x, spreadMix),
      y: lerp(from.y, to.y, spreadMix),
      r: lerp(from.r, to.r, spreadMix),
    };
  }

  /**
   * Sibling spread from stable deck index, not live screen X.
   * Desktop: j < i → left; j > i → right; Y = 0.
   * Mobile: X = 0; j < i → up; j > i → down; off-screen.
   * Landing is dest edge + gap (and width on the left), in deck-local space,
   * then clamped so a peek stays inside the iframe — no post-tween remasure.
   */
  function measureSpread(focusEl, focusIndex) {
    const mobile = isMobile();
    const { width: vw, height: vh } = getViewportSize();
    const works = Boolean(focusEl?.hasAttribute("data-works-card"));
    const deckScale =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--deck-scale"),
      ) || 1;
    const scale = Math.max(0.35, deckScale);
    const toLocal = (px) => px / scale;

    const homeBox = (item, i) => {
      const flying =
        item.el.hasAttribute("data-fly-lock") ||
        item.el.classList.contains("is-program-open") ||
        item.el.classList.contains("is-fly-pinned");
      if (flying && item.home) return { ...item.home };
      const rect = item.el.getBoundingClientRect();
      const kick = mixedSpread(i);
      const dx = kick.x * spread * scale;
      const dy = kick.y * spread * scale;
      const box = {
        left: rect.left - dx,
        right: rect.right - dx,
        top: rect.top - dy,
        bottom: rect.bottom - dy,
        width: rect.width,
        height: rect.height,
      };
      if (!flying) item.home = box;
      return box;
    };

    const stackDir = (i) => (focusIndex >= 0 && i < focusIndex ? -1 : 1);

    if (mobile) {
      const destT = 0;
      const destB = vh;
      const gap = 28;
      return liveItems().map((item, i) => {
        if (focusIndex >= 0 && i === focusIndex) return { x: 0, y: 0, r: 0 };
        const box = homeBox(item, i);
        const dist = focusIndex >= 0 ? Math.max(1, Math.abs(i - focusIndex)) : 1;
        const dirY = stackDir(i);
        const clearY =
          dirY < 0 ? Math.max(0, box.bottom + gap - destT) : Math.max(0, destB + gap - box.top);
        const kickY = Math.max(vh * 1.05, box.height + 240) + (dist - 1) * 80;
        return {
          x: 0,
          y: dirY * toLocal(clearY + kickY),
          r: dirY * (6 + (dist - 1) * 2),
        };
      });
    }

    const root = getComputedStyle(document.documentElement);
    const stackW = Number.parseFloat(root.getPropertyValue("--stack-card-w")) || 0;
    const stackH = Number.parseFloat(root.getPropertyValue("--stack-card-h")) || 0;
    const dest = desktopFocusDestVisual({
      frameW: vw,
      frameH: vh,
      cardW: works ? stackH : stackW,
      cardH: stackH,
      works,
    });
    const destL = dest.left;
    const destR = dest.left + dest.width;
    const gap = works ? 64 : 40;
    const stepX = works ? 62 : 44;
    const baseR = 2.8;
    const stepR = 0.55;
    const peek = 64;

    return liveItems().map((item, i) => {
      if (focusIndex >= 0 && i === focusIndex) return { x: 0, y: 0, r: 0 };
      const box = homeBox(item, i);
      const dist = focusIndex >= 0 ? Math.max(1, Math.abs(i - focusIndex)) : 1;
      const dirX = stackDir(i);
      const extra = (dist - 1) * stepX;
      const rotPad = Math.abs(Math.sin((item.baseRotate * Math.PI) / 180)) * box.height * 0.35;
      let targetLeft =
        dirX < 0 ? destL - gap - rotPad - extra - box.width : destR + gap + rotPad + extra;
      const peekStack = Math.min(Math.max(24, box.width - 12), peek + (dist - 1) * 14);
      targetLeft = Math.max(peekStack - box.width, Math.min(vw - peekStack, targetLeft));
      return {
        x: toLocal(targetLeft - box.left),
        y: 0,
        r: dirX * (baseR + (dist - 1) * stepR) * (works ? 1.2 : 1),
      };
    });
  }

  function hoverLiftBlocked(el) {
    return (
      el.hasAttribute("data-fly-lock") ||
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

  state.forEach((item) => {
    item.el.addEventListener("pointerenter", (event) => {
      if (isMobile()) return;
      if (!inDeckFlow(item.el)) return;
      if (programLocked() || hoverLiftBlocked(item.el)) return;
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
      if (isMobile()) return;
      const { width, height } = getViewportSize();
      if (!width || !height) return;
      pointer.x = clamp((event.clientX / width) * 2 - 1, -1, 1);
      pointer.y = clamp((event.clientY / height) * 2 - 1, -1, 1);
      scheduleRender();
    },
    { passive: true },
  );

  function onOrientation(event) {
    const params = getParams();
    const range = params.gyroRange || 28;
    gyro.x = clamp((event.gamma || 0) / range, -1, 1);
    gyro.y = clamp(((event.beta || 45) - 45) / range, -1, 1);
  }

  async function enableMotion() {
    if (motionEnabled || !isMobile()) return;
    try {
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") return;
      }
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
      motionEnabled = true;
    } catch {
      // Permission denied or unsupported
    }
  }

  // —— Mobile: free vertical drag + inertia (no snap) ——
  const DRAG_IGNORE =
    "a, button, [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings], [data-sound-settings], [data-fly-close], [data-article-close], [data-lockup] .dropcap, [data-work-ig], [data-work-student-prev], [data-work-student-next], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next]";

  function onDeckPointerDown(event) {
    if (!isMobile()) return;
    if (programLocked()) return;
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
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function onDeckPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (programLocked()) {
      cancelDeckDrag();
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      drag.moved = true;
      playFirstScrollFromGesture(event);
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
    if (eventFrom(event.target, ".is-program-open")) return;
    if (eventFrom(event.target, "[data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings], [data-sound-settings], .landing-card__enroll, .landing-card__nav a, .landing-card__nav button")) return;
    if (programLocked()) {
      event.preventDefault();
      holdFlyLock();
      return;
    }
    if (isMobile()) {
      event.preventDefault();
      if (drag) return;
      cancelSnap();
      const unit = cardUnitPx(getParams());
      const px = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (!px) return;
      playFirstScrollFromGesture(event);
      // Wheel down (deltaY > 0) is native scroll-down — same advance as finger-up.
      const delta = px / unit;
      const raw = dragProgress + delta;
      dragProgress = applyRubber(raw);
      dragInertia = 0;
      scheduleRender();
      return;
    }
    playFirstScrollFromGesture(event);
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
    flyLockedFlag = Boolean(deck.querySelector("[data-fly-lock]"));
    holdFlyLock();
    scheduleRender();
  }).observe(deck, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-fly-lock"],
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
    lastDeckProgress = null;
    lastDesktopDeltaAt = 0;
    refreshCardBox();
    refreshDeckScale();
    scheduleRender();
  });

  if (isMobile()) root.scrollTop = 0;

  deckIntro = canPlayCardIntro()
    ? createDeckIntro(liveCount(), { frontFirst: isMobile() })
    : null;
  if (!deckIntro) {
    markIntroReady();
    if (canPlayTextIntro()) playTextIntro();
    else markIntroDone();
  }

  function render() {
    raf = 0;
    const params = getParams();
    const mobile = isMobile();
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
    const spreadScale = Math.max(0.35, deckScaleCached);
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

    const wantSpread = deck.hasAttribute("data-program-open") ? 1 : 0;
    const focusOpenIndex = items.findIndex((entry) => entry.el.hasAttribute("data-focus-open"));
    const lockedIndex = items.findIndex((entry) => entry.el.hasAttribute("data-fly-lock"));
    const openingIndex = items.findIndex(
      (entry) =>
        entry.el.classList.contains("is-program-open") &&
        !entry.el.classList.contains("is-fly-pinned"),
    );
    const programLive = items.findIndex((entry) => entry.el.hasAttribute("data-program-card"));
    const spreadAround =
      focusOpenIndex >= 0
        ? focusOpenIndex
        : openingIndex >= 0
          ? openingIndex
          : lockedIndex >= 0
            ? lockedIndex
            : programLive >= 0
              ? programLive
              : programIndex;
    if (wantSpread && spreadPlanFor !== spreadAround) {
      const next = measureSpread(spreadAround >= 0 ? items[spreadAround].el : null, spreadAround);
      if (spreadPlan && spreadPlanFor >= 0 && spreadAround >= 0 && spreadPlanFor !== spreadAround) {
        spreadPlanFrom = items.map((_, i) => mixedSpread(i));
        spreadMix = 0;
        spreadMixT0 = performance.now();
      } else {
        spreadPlanFrom = null;
        spreadMix = 1;
      }
      spreadPlan = next;
      spreadPlanFor = spreadAround;
    }
    if (spreadMix < 1) {
      const u = reduceMotionSpread() ? 1 : clamp((performance.now() - spreadMixT0) / SPREAD_MS, 0, 1);
      spreadMix = flyEase(u);
      if (u >= 1) {
        spreadMix = 1;
        spreadPlanFrom = null;
      }
    }
    if (wantSpread !== spreadTarget) {
      spreadTarget = wantSpread;
      spreadFrom = spread;
      spreadT0 = performance.now();
    }
    if (spread !== spreadTarget) {
      const dur = spreadTarget > 0 ? SPREAD_MS : SPREAD_OUT_MS;
      const u = reduceMotionSpread() ? 1 : clamp((performance.now() - spreadT0) / dur, 0, 1);
      spread = lerp(spreadFrom, spreadTarget, spreadEase(u));
      if (u >= 1) spread = spreadTarget;
    }
    if (!wantSpread && spread === 0) {
      spreadPlan = null;
      spreadPlanFrom = null;
      spreadPlanFor = -2;
      spreadMix = 1;
    }

    const inputX = mobile ? 0 : pointer.x;
    const inputY = mobile ? 0 : pointer.y;
    if (!locked) {
      pointerSmooth.x = lerp(pointerSmooth.x, inputX, params.pointerLerp);
      pointerSmooth.y = lerp(pointerSmooth.y, inputY, params.pointerLerp);
    }

    items.forEach((item, i) => {
      const t = mobile ? 0 : cardFlightT(i, count, params, p);
      const slot = mobileStackSlot(i, mobile ? Math.max(0, y) : y, focusSpanOf(params));

      if (item.el.hasAttribute("data-rest-lock")) {
        if (spread > 0.001) {
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
        if (hoveredIndex === i) hoveredIndex = -1;
        item.hover = 0;
        if (mobile) {
          item.el.style.zIndex = String(count - i);
          item.el.style.opacity = "1";
        }
        setStackHit(item.el, { mobile, inert: false });
        return;
      }

      if (spread > 0.001) {
        const homeRect = item.el.getBoundingClientRect();
        const homeKick = mixedSpread(i);
        item.home = {
          left: homeRect.left - homeKick.x * spread * spreadScale,
          right: homeRect.right - homeKick.x * spread * spreadScale,
          top: homeRect.top - homeKick.y * spread * spreadScale,
          bottom: homeRect.bottom - homeKick.y * spread * spreadScale,
          width: homeRect.width,
          height: homeRect.height,
        };
      }

      const hoverTarget = !mobile && !locked && hoveredIndex === i ? 1 : 0;
      item.hover = lerp(item.hover, hoverTarget, params.hoverLerp);

      const depth = Math.pow(params.cursorFalloff, i);
      const pointerAmt = locked ? 0 : depth;
      const parallaxX = mobile ? 0 : pointerSmooth.x * params.parallaxX * pointerAmt;
      const parallaxY = mobile ? 0 : pointerSmooth.y * params.parallaxY * pointerAmt;
      const cursorRotY = mobile ? 0 : pointerSmooth.x * params.cursorTiltY * pointerAmt;
      const cursorRotX = mobile ? 0 : -pointerSmooth.y * params.cursorTiltX * pointerAmt;
      const cursorRotZ = mobile ? 0 : pointerSmooth.x * params.cursorTiltZ * pointerAmt * 0.65;

      const baseX = item.baseX * fan;
      const baseY = mobile ? 0 : item.baseY * fan;

      const cardH = cardBoxH || vh * 0.55;
      const flyExit =
        mobile && normalizeViewMode(params.viewMode) === "fly" && !reduceMotionSpread();
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
        if (!mobile || wantSpread) return 1;
        if (slot >= 0) return 1;
        if (flyExit) {
          const cardW = cardBoxW || 320;
          return flyCardClearedIframe(tossX, vw, cardW, stackScale) ? 0 : 1;
        }
        return clamp(1 + slot * 1.25, 0, 1);
      })();

      const planned = mixedSpread(i);
      const spreadX = planned.x * spread;
      const spreadY = planned.y * spread;
      const spreadR = planned.r * spread;

      const worksCard = item.el.hasAttribute("data-works-card");
      const worksX = worksCard ? Number(params.worksShiftX) || 0 : 0;
      const worksY = worksCard ? Number(params.worksShiftY) || 0 : 0;
      const worksR = worksCard ? Number(params.worksRotate) || 0 : 0;
      const programCard = item.el.hasAttribute("data-program-card");

      const introX = deckIntro && !flyLocked && !mobile ? deckIntro.shift(i, now, vw) : 0;
      const introY = deckIntro && !flyLocked && mobile ? deckIntro.shift(i, now, -vh) : 0;
      const x = scrollX + parallaxX + spreadX + worksX + introX;
      const yPos = scrollY + parallaxY - item.hover * params.hoverLift + spreadY + worksY + introY;

      const dragTilt = 0;

      const twist = mobile
        ? Number.isFinite(Number(params.cardRotate))
          ? Number(params.cardRotate)
          : 1
        : 1;
      const rotateZ =
        (mobile && programCard ? PROGRAM_MOBILE_ROTATE : item.baseRotate * twist) +
        t * item.tip * params.tipScale +
        cursorRotZ +
        dragTilt * depth +
        spreadR +
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
    if (deckIntro) syncDeckIntroSounds(deckIntro, count, now);
    if (deckIntro?.done(now)) {
      deckIntro = null;
      if (canPlayTextIntro()) playTextIntro();
      else markIntroDone();
    }

    if (needsDeckFrame(mobile)) scheduleRender();
  }

  onFrameMetrics(() => {
    refreshCardBox();
    refreshDeckScale();
    scheduleRender();
  });
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
  bindNavOpen(
    WORK_NAV,
    programApi,
    () => programApi.isWorksFocused?.(),
    () => programApi.openWorks(),
  );
}

initEmbed();
initLocale();
initTweaks();
initStageSettings();
initTickClicks();
initSoundSettings();
initDeck();
initTextAppear();
const programApi = initProgramModal();
bindProgramNav(programApi);
bindWorkNav(programApi);
initImgSliders();
initFormatVideo();
initDropcaps();
