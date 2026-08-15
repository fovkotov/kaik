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
  const targetT = isMobile() ? 0.5 : REVEAL_FLIGHT;
  if (!isMobile() && index <= 0) return 0;
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
 * Mobile rest: card tops just enter `--frame-h` from below (a ~10–20px sliver).
 * Flight still goes that peek → fully off the top.
 */
function mobileRestTossY(el, cardH, vh, t, params) {
  const peekRaw = Number(params.peekPx);
  const peek = Number.isFinite(peekRaw) ? peekRaw : 16;
  const cs = getComputedStyle(el);
  const topPx = Number.parseFloat(cs.top);
  const marginTop = Number.parseFloat(cs.marginTop);
  const restTop =
    (Number.isFinite(topPx) ? topPx : vh * 0.5) +
    (Number.isFinite(marginTop) ? marginTop : -cardH / 2);
  const restY = vh - peek - restTop;
  const exitY = restTop + cardH + 24;
  return restY - t * (restY + exitY) * (params.travelMult ?? 1);
}

/**
 * Desktop: scroll-driven stack + cursor parallax (right → left).
 * Mobile: same lead curve, vertical only — cards rise from below the viewport.
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
  const INERTIA_FRICTION = 0.92;
  const INERTIA_MIN = 0.00035;
  /** Scroll/parallax freeze while the program card is in-deck focused */
  let freezeY = null;
  let spread = 0;
  let spreadFrom = 0;
  let spreadTarget = 0;
  let spreadT0 = 0;
  /** @type {null | { x: number, y: number, r: number }[]} */
  let spreadPlan = null;
  const SPREAD_MS = 920;
  const FOCUS_SEL = "[data-focus-card], [data-program-card]";
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
    // 3× the previous mobile unit (2.04) so the same swipe advances the stack a third as far.
    return (h * 6.12) / Math.max(0.3, params.dragSensitivity ?? 1.2);
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

  /**
   * Push siblings out of the focused dest box using live rects (any scroll pose).
   * Left-of-focus → further left; right-of-focus → further right.
   * Works card is wider than the 680 program dest — stronger clear + multiplier.
   */
  function measureSpread(focusEl, focusIndex) {
    const mobile = isMobile();
    const { width: vw, height: vh } = getViewportSize();
    const gutter = mobile || vw <= 900 ? 32 : 48;
    const works = Boolean(focusEl?.hasAttribute("data-works-card"));
    const maxW = Math.max(0, vw - gutter);
    let openW = Math.min(680, maxW);
    if (works && focusEl) {
      const raw = getComputedStyle(focusEl).getPropertyValue("--focus-open-w").trim();
      const parsed = Number.parseFloat(raw);
      const deckScale =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--deck-scale"),
        ) || 1.15;
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
    const gap = works ? (mobile ? 36 : 64) : mobile ? 20 : 40;
    const spreadMul = works ? 1.4 : 1;

    const focusRect = focusEl?.getBoundingClientRect();
    const focusCx = focusRect ? focusRect.left + focusRect.width / 2 : vw / 2;
    const focusCy = focusRect ? focusRect.top + focusRect.height / 2 : vh / 2;

    const baseX = (mobile ? 56 : 100) * spreadMul;
    const stepX = (mobile ? 24 : 44) * spreadMul;
    const baseY = (mobile ? 16 : 28) * spreadMul;
    const stepY = (mobile ? 8 : 12) * spreadMul;
    const baseR = mobile ? 1.6 : 2.8;
    const stepR = mobile ? 0.3 : 0.55;

    return state.map((item, i) => {
      if (focusIndex >= 0 && i === focusIndex) return { x: 0, y: 0, r: 0 };
      const rect = item.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = focusIndex >= 0 ? Math.max(1, Math.abs(i - focusIndex)) : 1;

      const dirX =
        cx < focusCx - 6 ? -1 : cx > focusCx + 6 ? 1 : focusIndex >= 0 && i < focusIndex ? -1 : 1;
      const dirY = cy < focusCy - 6 ? -1 : cy > focusCy + 6 ? 1 : i % 2 === 0 ? -1 : 1;

      const clearX =
        dirX < 0 ? Math.max(0, rect.right + gap - destL) : Math.max(0, destR + gap - rect.left);

      return {
        x: dirX * Math.max(baseX + (dist - 1) * stepX, clearX),
        y: dirY * (baseY + (dist - 1) * stepY),
        r: dirX * (baseR + (dist - 1) * stepR) * (works ? 1.2 : 1),
      };
    });
  }

  state.forEach((item) => {
    if (!item.el.matches(FOCUS_SEL) || item.el.hasAttribute("data-work-card")) return;

    item.el.addEventListener("pointerenter", () => {
      if (isMobile()) return;
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
    "a, button, [data-fly-close], [data-lockup] .dropcap, [data-work-ig], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next]";

  function onDeckPointerDown(event) {
    if (!isMobile()) return;
    if (programLocked()) return;
    if (event.target.closest?.(DRAG_IGNORE)) return;

    enableMotion();
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
    dragProgress = applyRubber(drag.startProgress - dy / unit);

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    const vy = (event.clientY - drag.lastY) / dt;
    drag.vel = -vy / unit;
    drag.lastY = event.clientY;
    drag.lastT = now;

    event.preventDefault();
  }

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { moved, vel } = drag;
    deck.classList.remove("is-dragging");
    drag = null;
    const max = deckMax();
    if (dragProgress < 0 || dragProgress > max) {
      dragInertia = 0;
      animateProgress(clamp(dragProgress, 0, max));
      return;
    }
    dragInertia = moved ? vel * 16 : 0;
  }

  [deck, root].forEach((el) => {
    el.addEventListener("pointerdown", onDeckPointerDown);
    el.addEventListener("pointermove", onDeckPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  });

  // Kill page scroll on mobile — cards move only via drag
  window.addEventListener(
    "wheel",
    (event) => {
      if (eventFrom(event.target, ".is-program-open")) return;
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
        const delta = px / unit;
        const raw = dragProgress + delta;
        const max = deckMax();
        dragProgress = applyRubber(raw);
        dragInertia = raw >= 0 && raw <= max ? delta * 0.4 : 0;
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
      enableMotion();
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
    const fan = mobile ? params.fanScale ?? 0.12 : 1;
    const travel = mobile ? 0 : vw * params.travelMult;

    const locked = programLocked();
    if (!locked && mobile && !drag) {
      if (snapAnim) {
        const u = clamp((performance.now() - snapAnim.t0) / snapAnim.dur, 0, 1);
        dragProgress = lerp(snapAnim.from, snapAnim.to, 1 - (1 - u) ** 3);
        if (u >= 1) {
          const done = snapAnim.onDone;
          dragProgress = snapAnim.to;
          snapAnim = null;
          if (done) afterPoseFrame(done);
        }
      } else {
        const max = deckMax();
        if (dragProgress < 0 || dragProgress > max) {
          const target = dragProgress < 0 ? 0 : max;
          dragProgress = lerp(dragProgress, target, 0.22);
          dragInertia = 0;
          if (Math.abs(dragProgress - target) < 0.003) dragProgress = target;
        } else if (Math.abs(dragInertia) > INERTIA_MIN) {
          dragProgress += dragInertia;
          dragInertia *= INERTIA_FRICTION;
        } else {
          dragInertia = 0;
        }
      }
    }

    holdFlyLock();
    const y = freezeY != null ? freezeY : mobile ? dragProgress : root.scrollTop || 0;
    const originY = 0;
    const p = clamp(totalScroll ? y / totalScroll : 0, 0, 1);

    const wantSpread = deck.hasAttribute("data-program-open") ? 1 : 0;
    const lockedIndex = state.findIndex((entry) => entry.el.hasAttribute("data-fly-lock"));
    const spreadAround = lockedIndex >= 0 ? lockedIndex : programIndex;
    if (wantSpread && !spreadPlan) {
      spreadPlan = measureSpread(spreadAround >= 0 ? state[spreadAround].el : null, spreadAround);
    }
    if (wantSpread !== spreadTarget) {
      spreadTarget = wantSpread;
      spreadFrom = spread;
      spreadT0 = performance.now();
    }
    if (spread !== spreadTarget) {
      const u = reduceMotionSpread() ? 1 : clamp((performance.now() - spreadT0) / SPREAD_MS, 0, 1);
      spread = lerp(spreadFrom, spreadTarget, spreadEase(u));
      if (u >= 1) spread = spreadTarget;
    }
    if (!wantSpread && spread === 0) spreadPlan = null;

    const inputX = mobile ? 0 : pointer.x;
    const inputY = mobile ? gyro.y : pointer.y;
    if (!locked) {
      pointerSmooth.x = lerp(pointerSmooth.x, inputX, params.pointerLerp);
      pointerSmooth.y = lerp(pointerSmooth.y, inputY, params.pointerLerp);
    }

    state.forEach((item, i) => {
      const t = cardFlightT(i, state.length, params, p);

      const flyLocked = item.el.hasAttribute("data-fly-lock");
      if (flyLocked) {
        if (hoveredIndex === i) hoveredIndex = -1;
        item.hover = 0;
        if (mobile) item.el.style.zIndex = "";
        return;
      }

      const hoverTarget =
        !mobile && !locked && hoveredIndex === i && !item.el.hasAttribute("data-work-card") ? 1 : 0;
      item.hover = lerp(item.hover, hoverTarget, params.hoverLerp);

      const depth = Math.pow(params.cursorFalloff, i);
      const pointerAmt = locked ? 0 : depth;
      const parallaxX = mobile ? 0 : pointerSmooth.x * params.parallaxX * pointerAmt;
      const parallaxY = pointerSmooth.y * params.parallaxY * pointerAmt;
      const cursorRotY = mobile ? 0 : pointerSmooth.x * params.cursorTiltY * pointerAmt;
      const cursorRotX = -pointerSmooth.y * params.cursorTiltX * pointerAmt;
      const cursorRotZ = mobile ? 0 : pointerSmooth.x * params.cursorTiltZ * pointerAmt * 0.65;

      const baseX = item.baseX * fan;
      const baseY = mobile ? 0 : item.baseY * fan;

      const cardH = item.el.offsetHeight || vh * 0.55;
      const hide = (vh + cardH) / 2 + 24;
      const travelY = hide * 2 * (params.travelMult ?? 1);

      const tossX = mobile ? 0 : params.travelDir * t * travel;
      const tossY = mobile
        ? mobileRestTossY(item.el, cardH, vh, t, params)
        : t * (i % 2 === 0 ? -params.driftY : params.driftY);
      const scrollX = mobile ? baseX : baseX + tossX;
      const scrollY = baseY - originY + tossY;

      const planned = spreadPlan?.[i];
      const spreadX = (planned?.x ?? 0) * spread;
      const spreadY = (planned?.y ?? 0) * spread;
      const spreadR = (planned?.r ?? 0) * spread;

      const worksCard = item.el.hasAttribute("data-works-card");
      const worksX = worksCard ? Number(params.worksShiftX) || 0 : 0;
      const worksY = worksCard ? Number(params.worksShiftY) || 0 : 0;
      const worksR = worksCard ? Number(params.worksRotate) || 0 : 0;

      const x = scrollX + parallaxX + spreadX + worksX;
      const yPos = scrollY + parallaxY - item.hover * params.hoverLift + spreadY + worksY;

      const dragTilt =
        mobile && drag?.moved ? clamp((drag.startY - drag.lastY) * 0.035, -12, 12) : 0;

      const rotateZ =
        item.baseRotate * fan +
        t * item.tip * params.tipScale +
        cursorRotZ +
        dragTilt * depth +
        spreadR +
        worksR;
      const rotateY =
        t * (params.rotateYBase + i * params.rotateYStep) * (i % 2 === 0 ? 1 : -1) + cursorRotY;
      const rotateX =
        t * params.rotateXAmt * (i % 2 === 0 ? -1 : 1) + cursorRotX;

      item.el.style.transform = `translate3d(${x}px, ${yPos}px, 0) rotateZ(${rotateZ}deg) rotateY(${rotateY}deg) rotateX(${rotateX}deg)`;
      if (mobile) {
        // Later cards (still below) paint over earlier ones already flying up.
        item.el.style.zIndex = String(i + 1);
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

function bindProgramNav(deckApi, programApi) {
  if (!deckApi || !programApi) return;
  document.querySelectorAll(PROGRAM_NAV).forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (programApi.isProgramFocused?.()) return;
      const go = () => deckApi.revealProgram(() => programApi.open());
      if (programApi.isFocused()) {
        programApi.close(go);
        return;
      }
      go();
    });
  });
}

function bindWorkNav(deckApi, programApi) {
  if (!deckApi || !programApi) return;
  document.querySelectorAll(WORK_NAV).forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (programApi.isWorksFocused?.()) return;
      const go = () => deckApi.revealWorks(() => programApi.openWorks());
      if (programApi.isFocused()) {
        programApi.close(go);
        return;
      }
      go();
    });
  });
}

initEmbed();
initLocale();
initTweaks();
const deckApi = initDeck();
const programApi = initProgramModal();
bindProgramNav(deckApi, programApi);
bindWorkNav(deckApi, programApi);
initImgSliders();
initDropcaps();
