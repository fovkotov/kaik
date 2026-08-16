import { getScrollRoot, getViewportSize, initEmbed } from "./embed.js";
import { initImgSliders } from "./img-slider.js";
import { initProgramModal } from "./program-modal.js";
import { initDropcaps } from "./letters/dropcap.js";
import { applyTranslations, getLocale, setLocale } from "./scriptik.js";
import {
  MOBILE_MQ,
  applyDeckParams,
  easeByName,
  getParams,
  initTweaks,
  isMobile,
} from "./tweaks.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

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
 * Distance from the focus card: 0 = at center, + = waiting below, − = passed/fading.
 */
function mobileStackSlot(index, focus) {
  return index - focus;
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

  document.documentElement.style.setProperty("--card-count", String(cards.length));

  const state = cards.map((card, index) => ({
    el: card,
    index,
    baseRotate: Number(card.dataset.baseRotate || 0),
    baseX: Number(card.dataset.baseX || 0),
    baseY: Number(card.dataset.baseY || 0),
    tip: Number(card.dataset.tip || 12),
    baseZ: Number.parseInt(getComputedStyle(card).zIndex, 10) || cards.length - index,
    hover: 0,
    /** Un-spread visual box; never a live dest/fly rect. */
    home: null,
  }));

  const pointer = { x: 0, y: 0 };
  const gyro = { x: 0, y: 0 };
  const pointerSmooth = { x: 0, y: 0 };
  let hoveredIndex = -1;
  let running = true;
  let motionEnabled = false;

  /** Virtual progress used on mobile instead of page scroll (card units: 0 = first on top) */
  let dragProgress = 0;
  /** Leftover velocity after a flick (card units per frame); decays with friction. */
  let dragInertia = 0;
  /** @type {null | { from: number, to: number, t0: number, dur: number, onDone?: (() => void) | null }} */
  let snapAnim = null;
  /** @type {null | { id: number, startX: number, startY: number, startProgress: number, lastY: number, lastT: number, vel: number, moved: boolean }} */
  let drag = null;
  const RUBBER = 0.28;
  const INERTIA_MIN = 0.00035;
  const INERTIA_DECEL = 0.00055;
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
  const lockup = document.querySelector("[data-lockup]");
  if (lockup) {
    lockup.style.transform = "";
    lockup.style.visibility = "";
  }

  const programLocked = () => Boolean(deck.querySelector("[data-fly-lock]"));
  const reduceMotionSpread = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  function deckMax() {
    return Math.max(0, state.length - 1);
  }

  function cardUnitPx(params) {
    const h = state[0]?.el.offsetHeight || 400;
    // 1.36 = 2.04 / 1.5 — same swipe advances another 1.5× farther.
    // Floor 0.05 (was 0.3) so the speed slider works below 0.3.
    const sens = Number(params.dragSensitivity);
    return (h * 1.36) / Math.max(0.05, Number.isFinite(sens) ? sens : 1);
  }

  function applyRubber(raw) {
    const max = deckMax();
    if (raw < 0) return raw * RUBBER;
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
      return state.map((item, i) => {
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

    const gutter = vw <= 900 ? 32 : 48;
    const maxW = Math.max(0, vw - gutter);
    let openW = Math.min(680, maxW);
    if (works && focusEl) {
      const raw = getComputedStyle(focusEl).getPropertyValue("--focus-open-w").trim();
      const parsed = Number.parseFloat(raw);
      const foldedVisual = Math.max(focusEl.offsetWidth, focusEl.offsetHeight) * deckScale;
      const scaleRaw = Number.parseFloat(
        getComputedStyle(focusEl).getPropertyValue("--works-open-scale"),
      );
      const openScale = Number.isFinite(scaleRaw) && scaleRaw > 1 ? scaleRaw : 1.16;
      openW = Math.min(
        maxW,
        Math.max(foldedVisual * openScale, foldedVisual, Number.isFinite(parsed) ? parsed : 0),
      );
    }
    const destL = (vw - openW) / 2;
    const destR = destL + openW;
    const gap = works ? 64 : 40;
    const stepX = works ? 62 : 44;
    const baseR = 2.8;
    const stepR = 0.55;
    const peek = 64;

    return state.map((item, i) => {
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

  state.forEach((item) => {
    item.el.addEventListener("pointerenter", () => {
      if (isMobile()) return;
      if (programLocked()) return;
      hoveredIndex = item.index;
      item.el.classList.add("is-hovered");
    });

    item.el.addEventListener("pointerleave", () => {
      if (hoveredIndex === item.index) hoveredIndex = -1;
      item.el.classList.remove("is-hovered");
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
    "a, button, [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-fly-close], [data-lockup] .dropcap, [data-work-ig], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next]";

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
    }

    const params = getParams();
    const unit = cardUnitPx(params);
    // Finger down (dy > 0) advances: current yields down, next comes from above.
    dragProgress = applyRubber(drag.startProgress + dy / unit);

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    const vy = (event.clientY - drag.lastY) / dt;
    drag.vel = vy / unit;
    drag.lastY = event.clientY;
    drag.lastT = now;

    event.preventDefault();
  }

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    deck.classList.remove("is-dragging");
    drag = null;
    dragInertia = 0;
    const max = deckMax();
    if (dragProgress < 0 || dragProgress > max) {
      animateProgress(clamp(dragProgress, 0, max));
    }
  }

  [deck, root].forEach((el) => {
    el.addEventListener("pointerdown", onDeckPointerDown);
    el.addEventListener("pointermove", onDeckPointerMove);
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
  window.addEventListener(
    "wheel",
    (event) => {
      if (eventFrom(event.target, ".is-program-open")) return;
      if (eventFrom(event.target, "[data-tweaks], [data-tweaks-reopen], [data-deck-tune]")) return;
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
        // Wheel down (deltaY > 0) advances the stack.
        const delta = px / unit;
        const raw = dragProgress + delta;
        dragProgress = applyRubber(raw);
        dragInertia = 0;
        return;
      }
      if (root.contains(event.target)) return;
      root.scrollTop += event.deltaY;
    },
    { passive: false },
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (!isMobile()) return;
      if (eventFrom(event.target, ".is-program-open")) return;
      if (eventFrom(event.target, "[data-tweaks], [data-tweaks-reopen], [data-deck-tune]")) return;
      if (programLocked()) {
        event.preventDefault();
        holdFlyLock();
        return;
      }
      event.preventDefault();
    },
    { passive: false },
  );

  root.addEventListener("scroll", () => {
    if (freezeY == null || isMobile()) return;
    if (root.scrollTop !== freezeY) root.scrollTop = freezeY;
  });

  new MutationObserver(() => holdFlyLock()).observe(deck, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-fly-lock"],
  });

  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    applyDeckParams();
    root.scrollTop = 0;
    if (isMobile()) {
      cancelDeckDrag();
      cancelSnap();
      dragInertia = 0;
      dragProgress = 0;
    }
  });

  if (isMobile()) root.scrollTop = 0;

  function render() {
    const params = getParams();
    const mobile = isMobile();
    const { width: vw, height: vh } = getViewportSize();
    const totalScroll = maxProgress(state.length, params);
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
        dragInertia = 0;
        if (dragProgress < 0 || dragProgress > max) {
          animateProgress(dragProgress < 0 ? 0 : max);
        }
      }
    }

    holdFlyLock();
    const deckScaleNow =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--deck-scale"),
      ) || 1;
    const spreadScale = Math.max(0.35, deckScaleNow);
    const y = freezeY != null ? freezeY : mobile ? dragProgress : root.scrollTop || 0;
    const originY = 0;
    const p = clamp(totalScroll ? y / totalScroll : 0, 0, 1);

    const wantSpread = deck.hasAttribute("data-program-open") ? 1 : 0;
    const focusOpenIndex = state.findIndex((entry) => entry.el.hasAttribute("data-focus-open"));
    const lockedIndex = state.findIndex((entry) => entry.el.hasAttribute("data-fly-lock"));
    const openingIndex = state.findIndex(
      (entry) =>
        entry.el.classList.contains("is-program-open") &&
        !entry.el.classList.contains("is-fly-pinned"),
    );
    const spreadAround =
      focusOpenIndex >= 0
        ? focusOpenIndex
        : openingIndex >= 0
          ? openingIndex
          : lockedIndex >= 0
            ? lockedIndex
            : programIndex;
    if (wantSpread && spreadPlanFor !== spreadAround) {
      const next = measureSpread(spreadAround >= 0 ? state[spreadAround].el : null, spreadAround);
      if (spreadPlan && spreadPlanFor >= 0 && spreadAround >= 0 && spreadPlanFor !== spreadAround) {
        spreadPlanFrom = state.map((_, i) => mixedSpread(i));
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

    state.forEach((item, i) => {
      const t = mobile ? 0 : cardFlightT(i, state.length, params, p);
      const slot = mobileStackSlot(i, y);

      if (item.el.hasAttribute("data-rest-lock")) {
        if (spread > 0.001) {
          if (mobile) {
            item.el.style.zIndex = String(state.length - i);
            item.el.style.opacity = "1";
            item.el.style.pointerEvents = "";
          }
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
          item.el.style.zIndex = String(state.length - i);
          item.el.style.opacity = "1";
          item.el.style.pointerEvents = "";
        }
        return;
      }

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

      const cardH = item.el.offsetHeight || vh * 0.55;
      const tossX = mobile ? 0 : params.travelDir * t * travel;
      let tossY;
      let stackScale = 1;
      if (mobile) {
        const lift = Number.isFinite(Number(params.stackLift)) ? Number(params.stackLift) : 8;
        const rear = clamp(Number(params.rearScale) || 0.55, 0.2, 1);
        const curve = Math.max(0.2, Number(params.scaleProgress) || 1);
        if (slot >= 0) {
          const depthT = clamp(slot, 0, 5) / 5;
          stackScale = lerp(1, rear, depthT ** curve);
          const scaleComp = (cardH * (1 - stackScale)) / 2;
          tossY = -slot * lift - scaleComp;
        } else {
          const pass = clamp(-slot, 0, 1);
          stackScale = 1 - 0.06 * pass;
          tossY = pass * 16;
        }
      } else {
        tossY = t * (i % 2 === 0 ? -params.driftY : params.driftY);
      }
      const scrollX = mobile ? baseX : baseX + tossX;
      const scrollY = baseY - originY + tossY;
      const stackOpacity =
        !mobile || wantSpread ? 1 : slot >= 0 ? 1 : clamp(1 + slot * 1.25, 0, 1);

      const planned = mixedSpread(i);
      const spreadX = planned.x * spread;
      const spreadY = planned.y * spread;
      const spreadR = planned.r * spread;

      const worksCard = item.el.hasAttribute("data-works-card");
      const worksX = worksCard ? Number(params.worksShiftX) || 0 : 0;
      const worksY = worksCard ? Number(params.worksShiftY) || 0 : 0;
      const worksR = worksCard ? Number(params.worksRotate) || 0 : 0;

      const x = scrollX + parallaxX + spreadX + worksX;
      const yPos = scrollY + parallaxY - item.hover * params.hoverLift + spreadY + worksY;

      const dragTilt = 0;

      const twist = mobile
        ? Number.isFinite(Number(params.cardRotate))
          ? Number(params.cardRotate)
          : 1
        : 1;
      const rotateZ =
        item.baseRotate * twist +
        t * item.tip * params.tipScale +
        cursorRotZ +
        dragTilt * depth +
        spreadR +
        worksR;
      const rotateY =
        t * (params.rotateYBase + i * params.rotateYStep) * (i % 2 === 0 ? 1 : -1) + cursorRotY;
      const rotateX =
        t * params.rotateXAmt * (i % 2 === 0 ? -1 : 1) + cursorRotX;

      item.el.style.transform = `translate3d(${x}px, ${yPos}px, 0) rotateZ(${rotateZ}deg) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${stackScale})`;
      item.el.style.opacity = mobile ? String(stackOpacity) : "";
      item.el.style.pointerEvents = mobile && stackOpacity < 0.16 ? "none" : "";
      if (mobile) {
        // Current/earlier cards stay in front while they fade, next sits underneath.
        item.el.style.zIndex = String(state.length - i);
      } else if (!item.el.matches(FOCUS_SEL)) {
        item.el.style.zIndex = String(item.baseZ);
      } else {
        item.el.style.zIndex = "";
      }
    });

    if (running) requestAnimationFrame(render);
  }

  requestAnimationFrame(render);

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
      const y = scrollYForCard(index, state.length, params);
      if (isMobile()) return clamp(y, 0, deckMax());
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
      return clamp(y, 0, maxTop || maxProgress(state.length, params));
    })();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (isMobile()) {
      cancelDeckDrag();
      if (reduced || Math.abs(dragProgress - target) < 0.002) {
        cancelSnap();
        dragProgress = target;
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
initDeck();
const programApi = initProgramModal();
bindProgramNav(programApi);
bindWorkNav(programApi);
initImgSliders();
initDropcaps();
