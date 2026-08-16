import { t } from "./scriptik.js";
import { applyDeckParams } from "./tweaks.js";
import {
  fadeFocusScrollbar,
  mountFocusScrollbar,
  syncFocusScrollbar,
  unmountFocusScrollbar,
} from "./focus-scrollbar.js";

const FOCUS_SEL = "[data-card]";
const FOCUS_IGNORE =
  "a, button, [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-open-program], [data-fly-close], [data-work-ig], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next]";
const SIDE_CHROME =
  "[data-program-nav], [data-i18n='nav.program'], [data-work-nav], [data-i18n='nav.work'], [data-fly-close], a, button, [data-tweaks], [data-tweaks-reopen], [data-deck-tune], input, textarea, select";
const DRAG_CLICK_PX = 6;
const WORK_OPEN = "[data-work-open]";
const WORK_IG = "[data-work-ig]";
const TYPING_SEL = "input, textarea, select, [contenteditable='true']";

export function initProgramModal() {
  const cards = [...new Set([...document.querySelectorAll(FOCUS_SEL)])];
  const deck = document.querySelector("[data-deck]");
  if (!cards.length || !deck) return null;

  const programCard = cards.find((el) => el.hasAttribute("data-program-card")) || null;
  const worksCard = cards.find((el) => el.hasAttribute("data-works-card")) || null;
  const closeBtn = document.querySelector("[data-fly-close]");

  const FLY_MS = 920;
  const FLY_EASE = "cubic-bezier(0.22, 1, 0.32, 1)";
  const TOP_GAP = 28;
  const OPEN_W = 680;
  const OPEN_GUTTER = 48;
  const OPEN_GUTTER_NARROW = 32;
  const WORKS_OPEN_SCALE = 1.16;
  const ORIGIN_X = 0.5;
  const ORIGIN_Y = 0.55;

  /** @type {"idle" | "opening" | "open" | "closing"} */
  let phase = "idle";
  /** @type {HTMLElement | null} */
  let card = null;
  let rest = null;
  let restTransform = "";
  let start = null;
  let flyTimer = 0;
  /** @type {((event: TransitionEvent) => void) | null} */
  let flyOnEnd = null;
  let flyGen = 0;
  /** @type {(() => void) | null} */
  let closeAfter = null;
  /** Deck poses at the moment focus opened — reused so a switch can return home. */
  /** @type {Map<HTMLElement, { rest: object, restTransform: string }>} */
  let poses = new Map();
  /** Cards flying back to a sibling slot while another card stays focused. */
  /** @type {Map<HTMLElement, { gen: number, timer: number, onEnd: ((event: TransitionEvent) => void) | null }>} */
  const retiring = new Map();

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frameSize() {
    const root = document.documentElement;
    return {
      w: Number.parseFloat(root.style.getPropertyValue("--frame-w")) || window.innerWidth,
      h: Number.parseFloat(root.style.getPropertyValue("--frame-h")) || window.innerHeight,
    };
  }

  function readVisualRotate(el) {
    const inline = el.style.transform;
    const fromZ = inline.match(/rotateZ\(\s*([+-]?\d*\.?\d+)deg\s*\)/i);
    if (fromZ) return Number.parseFloat(fromZ[1]);
    const raw = getComputedStyle(el).transform;
    if (!raw || raw === "none") return 0;
    try {
      const matrix = new DOMMatrix(raw);
      return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    } catch {
      return 0;
    }
  }

  /** Deck scale + origin so iframe-visual boxes can be expressed in card local space. */
  function deckSpace() {
    const style = getComputedStyle(deck);
    let matrix;
    try {
      matrix = new DOMMatrix(style.transform);
    } catch {
      matrix = new DOMMatrix();
    }
    const origin = style.transformOrigin.split(" ");
    const ox = Number.parseFloat(origin[0]) || 0;
    const oy = Number.parseFloat(origin[1]) || 0;
    const scaleX = Math.hypot(matrix.a, matrix.b) || 1;
    const scaleY = Math.hypot(matrix.c, matrix.d) || 1;
    const rect = deck.getBoundingClientRect();
    return {
      matrix,
      ox,
      oy,
      scaleX,
      scaleY,
      vx0: rect.left + ox * scaleX,
      vy0: rect.top + oy * scaleY,
    };
  }

  function visualToDeckLocal(vx, vy) {
    const { matrix, ox, oy, vx0, vy0 } = deckSpace();
    let inv;
    try {
      inv = matrix.inverse();
    } catch {
      inv = new DOMMatrix();
    }
    const p = inv.transformPoint(new DOMPoint(vx - vx0, vy - vy0));
    return { x: p.x + ox, y: p.y + oy };
  }

  function visualBoxToCardSpace(box) {
    if (card && getComputedStyle(card).position === "fixed") return box;
    const tl = visualToDeckLocal(box.left, box.top);
    const br = visualToDeckLocal(box.left + box.width, box.top + box.height);
    return {
      left: tl.x,
      top: tl.y,
      width: br.x - tl.x,
      height: br.y - tl.y,
      rotate: box.rotate ?? 0,
    };
  }

  function capturePose(el) {
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const rect = el.getBoundingClientRect();
    const rotate = readVisualRotate(el);
    const origin = getComputedStyle(el).transformOrigin.split(" ");
    const ox = Number.parseFloat(origin[0]);
    const oy = Number.parseFloat(origin[1]);
    const originX = Number.isFinite(ox) ? ox : width * ORIGIN_X;
    const originY = Number.isFinite(oy) ? oy : height * ORIGIN_Y;
    const rad = (rotate * Math.PI) / 180;
    const axis = visualToDeckLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const vx = width / 2 - originX;
    const vy = height / 2 - originY;
    return {
      left: axis.x - originX - vx * Math.cos(rad) + vy * Math.sin(rad),
      top: axis.y - originY - vx * Math.sin(rad) - vy * Math.cos(rad),
      width,
      height,
      rotate,
    };
  }

  function openWidth() {
    const host = card;
    const raw = host
      ? getComputedStyle(host).getPropertyValue("--focus-open-w").trim() ||
        getComputedStyle(host).getPropertyValue("--program-open-w").trim()
      : "";
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const { w: vw } = frameSize();
    const gutter = window.matchMedia("(max-width: 900px)").matches
      ? OPEN_GUTTER_NARROW
      : OPEN_GUTTER;
    return Math.min(OPEN_W, Math.max(0, vw - gutter));
  }

  function destVisual(from) {
    const { w: vw, h: vh } = frameSize();
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      return { left: 0, top: 0, width: vw, height: vh, rotate: 0 };
    }
    const gutter = OPEN_GUTTER;
    const side = gutter / 2;
    const topGap = TOP_GAP;
    const bottomGap = 28;
    const { scaleX, scaleY } = deckSpace();
    const maxW = Math.max(0, vw - gutter);
    const maxH = Math.max(0, vh - topGap - bottomGap);
    let width = Math.min(openWidth(), maxW);
    let height = Math.max((from?.height ?? 0) * scaleY, maxH);
    if (card?.hasAttribute("data-works-card")) {
      const foldedVisual = Math.max((from?.width ?? 0) * scaleX, (from?.height ?? 0) * scaleY);
      const grown = foldedVisual > 0 ? foldedVisual * WORKS_OPEN_SCALE : 0;
      // Square works card is already wider than A4 — never cap at the 680 program dest.
      // Dest is a tall column; inner 64:20 --u uses layout width (cqw/842), not this height.
      width = Math.min(maxW, Math.max(foldedVisual, grown));
      if (width <= 0) width = Math.min(maxW, maxH * 0.72);
      height = maxH;
    }
    let left = (vw - width) / 2;
    if (left < side) left = side;
    if (left + width > vw - side) left = Math.max(side, vw - side - width);
    const top = topGap;
    return { left, top, width, height, rotate: 0 };
  }

  function destBox(from) {
    return visualBoxToCardSpace(destVisual(from));
  }

  function deckLocalToVisual(x, y) {
    const { matrix, ox, oy, vx0, vy0 } = deckSpace();
    const p = matrix.transformPoint(new DOMPoint(x - ox, y - oy));
    return { x: p.x + vx0, y: p.y + vy0 };
  }

  /**
   * Same dest-clearance + peek clamp as main.js measureSpread.
   * Landing X is dest.left - width - gap (left) or dest.right + gap (right),
   * converted to deck-local, then clamped so the card still peeks in the iframe.
   */
  function siblingLanding(from, outgoingEl, incomingEl) {
    const i = cards.indexOf(outgoingEl);
    const focusIndex = cards.indexOf(incomingEl);
    if (i < 0 || focusIndex < 0 || i === focusIndex) return from;
    const { w: vw, h: vh } = frameSize();
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    const { scaleX, scaleY } = deckSpace();
    const toLocal = (px) =>
      px / Math.max(0.35, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--deck-scale")) || 1);
    const dist = Math.max(1, Math.abs(i - focusIndex));
    const works = incomingEl.hasAttribute("data-works-card");
    const dest = destVisual(poses.get(incomingEl)?.rest);
    const origin = deckLocalToVisual(from.left, from.top);
    const restW = from.width * scaleX;
    const restH = from.height * scaleY;
    const restRight = origin.x + restW;
    const restBottom = origin.y + restH;
    const restCy = origin.y + restH / 2;
    const focusCy = dest.top + dest.height / 2;
    const dirX = i < focusIndex ? -1 : 1;

    if (mobile) {
      const clearlyAbove = restCy + restH * 0.2 < focusCy;
      const dirY = clearlyAbove ? -1 : 1;
      const gap = 28;
      const clearX =
        dirX < 0 ? Math.max(0, restRight + gap - dest.left) : Math.max(0, dest.left + dest.width + gap - origin.x);
      const clearY =
        dirY < 0 ? Math.max(0, restBottom + gap - dest.top) : Math.max(0, dest.top + dest.height + gap - origin.y);
      const kickX = Math.max(380, vw * 0.55) + (dist - 1) * 130;
      const kickY = Math.max(480, vh * 0.85, restH + 220) + (dist - 1) * 160;
      return {
        left: from.left + dirX * toLocal(Math.max(clearX, kickX)),
        top: from.top + dirY * toLocal(clearY + kickY),
        width: from.width,
        height: from.height,
        rotate: (from.rotate ?? 0) + dirX * (10 + (dist - 1) * 3),
      };
    }

    const gap = works ? 64 : 40;
    const step = (works ? 62 : 44) * (dist - 1);
    const rotPad = Math.abs(Math.sin(((from.rotate ?? 0) * Math.PI) / 180)) * restH * 0.35;
    const destRight = dest.left + dest.width;
    let targetLeft =
      dirX < 0 ? dest.left - gap - rotPad - step - restW : destRight + gap + rotPad + step;
    const peek = 64;
    const peekStack = Math.min(Math.max(24, restW - 12), peek + (dist - 1) * 14);
    targetLeft = Math.max(peekStack - restW, Math.min(vw - peekStack, targetLeft));
    const r = dirX * (2.8 + (dist - 1) * 0.55) * (works ? 1.2 : 1);
    return {
      left: from.left + toLocal(targetLeft - origin.x),
      top: from.top,
      width: from.width,
      height: from.height,
      rotate: (from.rotate ?? 0) + r,
    };
  }

  function pinEl(el, box, withTransition) {
    if (!el) return;
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.margin = "";
    el.style.width = "";
    el.style.height = "";
    el.style.setProperty("--fly-l", `${box.left}px`);
    el.style.setProperty("--fly-t", `${box.top}px`);
    el.style.setProperty("--fly-w", `${box.width}px`);
    el.style.setProperty("--fly-h", `${box.height}px`);
    el.style.setProperty("--fly-rot", `${box.rotate ?? 0}deg`);
    el.style.setProperty("--fly-ms", withTransition ? `${FLY_MS}ms` : "0ms");
    el.style.setProperty("--fly-ease", FLY_EASE);
    el.style.transform = "";
  }

  function pin(box, withTransition) {
    pinEl(card, box, withTransition);
  }

  function flyEnded(event, host) {
    if (event.target !== host) return false;
    return (
      event.propertyName === "top" ||
      event.propertyName === "left" ||
      event.propertyName === "height" ||
      event.propertyName === "width" ||
      event.propertyName === "transform" ||
      event.propertyName === "--fly-w" ||
      event.propertyName === "--fly-rot"
    );
  }

  function trapCardScroll(event) {
    event.stopPropagation();
  }

  function lockCard() {
    if (!card) return;
    card.classList.remove("is-hovered", "is-fly-pinned");
    card.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    card.setAttribute("data-fly-lock", "");
    card.setAttribute("data-focus-open", "");
    card.classList.add("is-program-open");
    if (card.hasAttribute("data-work-student")) {
      card.getBoundingClientRect();
      card.classList.add("is-work-open");
    }
    deck.setAttribute("data-program-open", "");
    card.addEventListener("wheel", trapCardScroll, { passive: true });
    card.addEventListener("touchmove", trapCardScroll, { passive: true });
    mountFocusScrollbar(card);
  }

  function clearFlyBox(el) {
    [
      "--fly-l",
      "--fly-t",
      "--fly-w",
      "--fly-h",
      "--fly-rot",
      "--fly-ms",
      "--fly-ease",
    ].forEach((name) => el.style.removeProperty(name));
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.margin = "";
    el.style.width = "";
    el.style.height = "";
  }

  function releaseCard(keepDeck) {
    if (!card) return;
    unmountFocusScrollbar(card);
    card.removeEventListener("wheel", trapCardScroll);
    card.removeEventListener("touchmove", trapCardScroll);
    card.classList.remove("is-program-open", "is-program-scroll", "is-work-open", "is-fly-pinned");
    card.style.transform = restTransform;
    clearFlyBox(card);
    restTransform = "";
    card.removeAttribute("data-fly-lock");
    card.removeAttribute("data-focus-open");
    card.removeAttribute("data-work-student");
    card.setAttribute("data-rest-lock", "");
    applyDeckParams();
    if (!keepDeck && !closeAfter) deck.removeAttribute("data-program-open");
  }

  function afterFly(fn) {
    if (!card) {
      fn();
      return;
    }
    window.clearTimeout(flyTimer);
    if (flyOnEnd) {
      card.removeEventListener("transitionend", flyOnEnd);
      flyOnEnd = null;
    }
    const host = card;
    const gen = ++flyGen;
    if (reduceMotion()) {
      fn();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled || gen !== flyGen) return;
      settled = true;
      if (flyOnEnd) {
        host.removeEventListener("transitionend", flyOnEnd);
        flyOnEnd = null;
      }
      fn();
    };
    flyOnEnd = (event) => {
      if (!flyEnded(event, host)) return;
      finish();
    };
    host.addEventListener("transitionend", flyOnEnd);
    flyTimer = window.setTimeout(finish, FLY_MS);
  }

  function playFly(nextBox, immediate) {
    const run = () => {
      pin(nextBox, !reduceMotion());
      afterFly(() => {
        if (phase === "opening") {
          phase = "open";
          if (card) {
            card.classList.add("is-program-scroll");
            syncFocusScrollbar(card);
          }
          syncAria();
          return;
        }
        if (phase !== "closing") return;
        releaseCard();
        phase = "idle";
        rest = null;
        poses = new Map();
        const next = closeAfter;
        closeAfter = null;
        card = null;
        syncAria();
        next?.();
      });
    };
    if (reduceMotion() || immediate) {
      run();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function snapshotPoses() {
    if (poses.size) return;
    cards.forEach((el) => {
      poses.set(el, {
        rest: capturePose(el),
        restTransform: el.style.transform,
      });
    });
  }

  function rememberPose(el, nextRest, nextTransform) {
    poses.set(el, { rest: nextRest, restTransform: nextTransform });
  }

  /** Park at the --fly-* landing. Do not hand off to a second transform. */
  function settleRetire(el) {
    unmountFocusScrollbar(el);
    el.removeEventListener("wheel", trapCardScroll);
    el.removeEventListener("touchmove", trapCardScroll);
    el.classList.remove("is-program-open", "is-program-scroll", "is-work-open");
    el.classList.add("is-fly-pinned");
    el.style.setProperty("--fly-ms", "0ms");
    el.removeAttribute("data-fly-lock");
    el.removeAttribute("data-focus-open");
    el.removeAttribute("data-work-student");
  }

  /** Home pose: one transform, then rest-lock until deck spread is 0. */
  function finishRetireHome(el, restTf) {
    unmountFocusScrollbar(el);
    el.removeEventListener("wheel", trapCardScroll);
    el.removeEventListener("touchmove", trapCardScroll);
    el.classList.remove("is-program-open", "is-program-scroll", "is-work-open", "is-fly-pinned");
    el.style.transform = restTf;
    clearFlyBox(el);
    el.removeAttribute("data-fly-lock");
    el.removeAttribute("data-focus-open");
    el.removeAttribute("data-work-student");
    el.setAttribute("data-rest-lock", "");
  }

  function cancelRetire(el) {
    const rec = retiring.get(el);
    if (!rec) return;
    rec.gen += 1;
    window.clearTimeout(rec.timer);
    if (rec.onEnd) el.removeEventListener("transitionend", rec.onEnd);
    retiring.delete(el);
  }

  function playRetire(el, box, restTf, mode) {
    cancelRetire(el);
    const rec = { gen: 0, timer: 0, onEnd: null, box };
    retiring.set(el, rec);
    const finish = () => {
      if (retiring.get(el) !== rec) return;
      if (rec.onEnd) el.removeEventListener("transitionend", rec.onEnd);
      retiring.delete(el);
      if (mode === "home") finishRetireHome(el, restTf);
      else settleRetire(el);
    };
    pinEl(el, rec.box, !reduceMotion());
    if (reduceMotion()) {
      finish();
      return;
    }
    rec.onEnd = (event) => {
      if (!flyEnded(event, el)) return;
      finish();
    };
    el.addEventListener("transitionend", rec.onEnd);
    rec.timer = window.setTimeout(finish, FLY_MS);
  }

  function retireToHome(el) {
    const saved = poses.get(el);
    if (!saved) {
      cancelRetire(el);
      finishRetireHome(el, el.style.transform);
      return;
    }
    playRetire(el, saved.rest, saved.restTransform, "home");
  }

  function openFocus(target) {
    const next = target || programCard;
    if (phase !== "idle" || !next) return;
    snapshotPoses();
    card = next;
    phase = "opening";
    const saved = poses.get(card);
    rest = saved?.rest ?? capturePose(card);
    restTransform = saved?.restTransform ?? card.style.transform;
    if (!saved) rememberPose(card, rest, restTransform);
    pin(rest, false);
    lockCard();
    card.getBoundingClientRect();
    syncAria();
    playFly(destBox(rest));
  }

  function closeFocus(after) {
    if (phase !== "open" && phase !== "opening") {
      after?.();
      return;
    }
    phase = "closing";
    closeAfter = typeof after === "function" ? after : null;
    window.clearTimeout(flyTimer);
    if (card) card.scrollTop = 0;
    fadeFocusScrollbar(card, false);
    card?.classList.remove("is-work-open", "is-program-scroll");
    cards.forEach((el) => {
      if (el === card) return;
      if (el.classList.contains("is-fly-pinned") || retiring.has(el)) retireToHome(el);
    });
    if (!closeAfter) deck.removeAttribute("data-program-open");
    syncAria();
    playFly(rest ?? (card ? capturePose(card) : destBox()), true);
  }

  function switchFocus(target) {
    if (!target || !card || target === card) return;
    const outgoingEl = card;
    const outSaved = poses.get(outgoingEl) || { rest, restTransform };

    window.clearTimeout(flyTimer);
    if (flyOnEnd && outgoingEl) {
      outgoingEl.removeEventListener("transitionend", flyOnEnd);
      flyOnEnd = null;
    }
    flyGen += 1;
    closeAfter = null;

    outgoingEl.scrollTop = 0;
    fadeFocusScrollbar(outgoingEl, false);
    outgoingEl.classList.remove("is-work-open", "is-program-scroll");
    outgoingEl.removeEventListener("wheel", trapCardScroll);
    outgoingEl.removeEventListener("touchmove", trapCardScroll);
    outgoingEl.removeAttribute("data-focus-open");
    outgoingEl.removeAttribute("data-work-student");

    cancelRetire(target);
    const fromVisual = capturePose(target);
    const inSaved = poses.get(target);
    card = target;
    rest = inSaved?.rest ?? fromVisual;
    restTransform = inSaved?.restTransform ?? target.style.transform;
    if (!inSaved) rememberPose(target, rest, restTransform);

    pin(fromVisual, false);
    lockCard();
    outgoingEl.removeAttribute("data-fly-lock");
    card.getBoundingClientRect();

    const dest = destBox(rest);
    const outLanding = siblingLanding(outSaved.rest, outgoingEl, target);
    const parked = cards.filter(
      (el) =>
        el !== outgoingEl &&
        el !== target &&
        (el.classList.contains("is-fly-pinned") || retiring.has(el)),
    );
    playRetire(outgoingEl, outLanding, outSaved.restTransform, "park");
    parked.forEach((el) => {
      const saved = poses.get(el);
      if (!saved) return;
      playRetire(el, siblingLanding(saved.rest, el, target), saved.restTransform, "park");
    });

    phase = "opening";
    syncAria();
    playFly(dest);
  }

  function focusCard(target) {
    if (!target) return;
    if (target === card && (phase === "open" || phase === "opening")) return;
    if (phase === "closing") {
      closeAfter = () => openFocus(target);
      return;
    }
    if (phase === "open" || phase === "opening") {
      switchFocus(target);
      return;
    }
    openFocus(target);
  }

  function neighborCard(dir) {
    if (!card) return null;
    const idx = cards.indexOf(card);
    if (idx < 0) return null;
    const next = idx + dir;
    if (next < 0 || next >= cards.length) return null;
    return cards[next];
  }

  function goToNeighbor(dir) {
    const target = neighborCard(dir);
    if (!target) return;
    focusCard(target);
  }

  function isTypingTarget(el) {
    if (!(el instanceof Element)) return false;
    if (el.isContentEditable) return true;
    return Boolean(el.closest(TYPING_SEL));
  }

  function labelKey(el, expanded) {
    if (el.hasAttribute("data-program-card")) return expanded ? "program.close" : "program.open";
    if (el.hasAttribute("data-work-card")) return expanded ? "work.close" : "work.open";
    if (el.hasAttribute("data-works-card")) return expanded ? "works.close" : "works.open";
    if (el.querySelector(".history-card")) return expanded ? "history.close" : "history.open";
    return expanded ? "card.close" : "card.open";
  }

  function syncCloseBtn() {
    if (!closeBtn) return;
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    const expanded = phase === "open" || phase === "opening";
    const show = mobile && expanded && card;
    closeBtn.hidden = !show;
    if (show && card) closeBtn.setAttribute("aria-label", t(labelKey(card, true)));
  }

  function syncAria() {
    const expanded = phase === "open" || phase === "opening";
    cards.forEach((el) => {
      const isThis = expanded && el === card;
      el.setAttribute("aria-expanded", isThis ? "true" : "false");
      el.setAttribute("aria-label", t(labelKey(el, isThis)));
    });
    syncCloseBtn();
  }

  syncAria();

  cards.forEach((el) => {
    el.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
      // Let the deck capture a vertical swipe. Only real controls keep the event.
      if (event.target.closest?.(FOCUS_IGNORE) || event.target.closest?.(WORK_IG)) {
        event.stopPropagation();
      }
    });

    el.addEventListener("click", (event) => {
      if (event.target.closest?.(WORK_IG)) {
        event.stopPropagation();
        return;
      }
      const moved =
        start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_CLICK_PX;
      const sheet = el.hasAttribute("data-work-card")
        ? event.target.closest?.(WORK_OPEN)
        : null;
      if (sheet) {
        event.preventDefault();
        event.stopPropagation();
        if (moved) return;
        el.setAttribute("data-work-student", sheet.getAttribute("data-work-open") || "");
        if (phase === "idle") {
          openFocus(el);
          return;
        }
        if (el === card && (phase === "open" || phase === "opening")) {
          el.classList.add("is-work-open");
          mountFocusScrollbar(el);
          return;
        }
        focusCard(el);
        return;
      }
      if (event.target.closest?.(FOCUS_IGNORE)) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      if (moved) return;
      if (el === card && (phase === "open" || phase === "opening")) return;
      if (phase === "open" || phase === "opening" || phase === "closing") {
        focusCard(el);
        return;
      }
      openFocus(el);
    });
  });

  document.querySelectorAll(WORK_OPEN).forEach((sheet) => {
    sheet.addEventListener("click", (event) => {
      if (event.target.closest?.(WORK_IG)) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_CLICK_PX) return;
      const host = sheet.closest("[data-work-card]");
      if (!host) return;
      host.setAttribute("data-work-student", sheet.getAttribute("data-work-open") || "");
      if (phase === "idle") {
        openFocus(host);
        return;
      }
      if (host === card && (phase === "open" || phase === "opening")) {
        host.classList.add("is-work-open");
        mountFocusScrollbar(host);
        return;
      }
      focusCard(host);
    });
  });

  document.querySelectorAll(WORK_IG).forEach((ig) => {
    ig.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  document.querySelectorAll("[data-open-program]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!programCard) return;
      if (card === programCard && (phase === "open" || phase === "opening")) return;
      focusCard(programCard);
    });
  });

  document.addEventListener(
    "click",
    (event) => {
      if (phase !== "open" && phase !== "opening") return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (card?.contains(target)) return;
      const hit = target instanceof Element ? target : target.parentElement;
      if (hit?.closest?.(SIDE_CHROME)) return;
      const hitCard = hit?.closest?.(FOCUS_SEL);
      if (hitCard && hitCard !== card) {
        if (hit.closest?.(WORK_IG)) return;
        if (hit.closest?.(FOCUS_IGNORE) && !hit.closest?.(WORK_OPEN)) return;
        event.preventDefault();
        event.stopPropagation();
        const sheet = hit.closest?.(WORK_OPEN);
        if (sheet && hitCard.hasAttribute("data-work-card")) {
          hitCard.setAttribute("data-work-student", sheet.getAttribute("data-work-open") || "");
        }
        focusCard(hitCard);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeFocus();
    },
    true,
  );

  closeBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (phase !== "open" && phase !== "opening") return;
    closeFocus();
  });

  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;
    if (phase !== "open" && phase !== "opening") return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeFocus();
      return;
    }
    const prev = event.key === "ArrowLeft" || event.key === "j" || event.key === "J";
    const next = event.key === "ArrowRight" || event.key === "k" || event.key === "K";
    if (!prev && !next) return;
    event.preventDefault();
    goToNeighbor(prev ? -1 : 1);
  });

  document.addEventListener("kaik:translated", syncAria);

  const onFrameResize = () => {
    if (phase !== "open") return;
    pin(destBox(rest), false);
    syncFocusScrollbar(card);
  };
  window.addEventListener("resize", onFrameResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onFrameResize, { passive: true });

  return {
    open: () => focusCard(programCard),
    openWorks: () => focusCard(worksCard),
    close: closeFocus,
    isFocused: () => phase === "open" || phase === "opening",
    isProgramFocused: () =>
      Boolean(card?.hasAttribute("data-program-card") && (phase === "open" || phase === "opening")),
    isWorksFocused: () =>
      Boolean(card?.hasAttribute("data-works-card") && (phase === "open" || phase === "opening")),
  };
}
