import { getViewportSize } from "./embed.js";
import { t } from "./scriptik.js";
import { getFocusNudge, getFocusScale } from "./stage-settings.js";
import { applyDeckParams, inDeckFlow, isMobile } from "./tweaks.js";
import {
  fadeFocusScrollbar,
  focusScrollRoot,
  mountFocusScrollbar,
  syncFocusScrollbar,
  unmountFocusScrollbar,
} from "./focus-scrollbar.js";

const FOCUS_SEL = "[data-card]";
  const FOCUS_IGNORE =
  "a, button, [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings], [data-sound-settings], [data-open-program], [data-fly-close], [data-article-close], [data-fly-illust-close], [data-work-ig], [data-work-student-prev], [data-work-student-next], [data-img-slider], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next]";
  const SIDE_CHROME =
  "[data-program-nav], [data-i18n='nav.program'], [data-work-nav], [data-i18n='nav.work'], [data-fly-close], [data-article-close], [data-fly-illust-close], .landing-card__enroll, .landing-card__nav a, .landing-card__nav button, a, button, [data-tweaks], [data-tweaks-reopen], [data-deck-tune], [data-stage-settings], [data-sound-settings], input, textarea, select";
const DRAG_CLICK_PX = 6;
const WORK_OPEN = "[data-work-open]";
const WORK_IG = "[data-work-ig]";
const TYPING_SEL = "input, textarea, select, [contenteditable='true']";
const TOP_GAP = 28;
const BOTTOM_GAP = 28;
const OPEN_GUTTER = 48;
const WORKS_OPEN_SCALE = 1.16;
const A4_RATIO = 210 / 297;

/**
 * Desktop focus dest in iframe-visual pixels.
 * Same stack rectangle, height-fit to `--frame-h` minus gutter; width follows ratio.
 * destBox converts this through deck scale into `--fly-w` / `--fly-h`.
 */
export function desktopFocusDestVisual({ frameW, frameH, cardW, cardH, works = false }) {
  const maxW = Math.max(0, frameW - OPEN_GUTTER);
  const maxH = Math.max(0, frameH - TOP_GAP - BOTTOM_GAP);
  const ratio = cardW > 0 && cardH > 0 ? cardW / cardH : A4_RATIO;

  let height = maxH;
  let width = height * ratio;

  if (works) {
    width = height;
    const grown = height * WORKS_OPEN_SCALE;
    if (grown <= maxH && grown <= maxW) {
      width = grown;
      height = grown;
    }
  }

  if (width > maxW && width > 0) {
    const fit = maxW / width;
    width = maxW;
    height *= fit;
  }

  const focusScale = getFocusScale();
  width *= focusScale;
  height *= focusScale;

  const side = OPEN_GUTTER / 2;
  let left = (frameW - width) / 2;
  if (width <= frameW - OPEN_GUTTER) {
    if (left < side) left = side;
    if (left + width > frameW - side) left = Math.max(side, frameW - side - width);
  }

  const nudge = getFocusNudge();
  return {
    left: left + nudge.x,
    top: TOP_GAP + nudge.y,
    width,
    height,
    rotate: 0,
  };
}

export function initProgramModal() {
  const cards = [...new Set([...document.querySelectorAll(FOCUS_SEL)])];
  const deck = document.querySelector("[data-deck]");
  if (!cards.length || !deck) return null;

  const programCard = cards.find((el) => el.hasAttribute("data-program-card")) || null;
  const worksCard = cards.find((el) => el.hasAttribute("data-works-card")) || null;
  const closeBtn = document.querySelector("[data-fly-close]");

  const FLY_MS = 920;
  const FLY_EASE = "cubic-bezier(0.22, 1, 0.32, 1)";
  const EXPAND_MS = 500;
  const EXPAND_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
  const ORIGIN_X = 0.5;
  const ORIGIN_Y = 0.55;

  /** @type {"idle" | "opening" | "open" | "closing"} */
  let phase = "idle";
  /** @type {HTMLElement | null} */
  let card = null;
  let rest = null;
  let restTransform = "";
  /** Deck-local visual box of the tapped card — close shrinks back here. */
  let fromLocal = null;
  let fromRadius = "2px";
  /** Last close-frame |dest − current| in px (max of left/top/width/height). */
  let lastHandoffPx = 0;
  let start = null;
  let flyTimer = 0;
  /** @type {((event: TransitionEvent) => void) | null} */
  let flyOnEnd = null;
  let flyGen = 0;
  /** @type {(() => void) | null} */
  let closeAfter = null;
  /** Deck poses at the moment focus opened — reused so a switch can return home. */
  /** @type {Map<HTMLElement, { rest: object, restTransform: string, layout: object, fromFixed: object }>} */
  let poses = new Map();
  /** Cards flying back to a sibling slot while another card stays focused. */
  /** @type {Map<HTMLElement, { gen: number, timer: number, onEnd: ((event: TransitionEvent) => void) | null }>} */
  const retiring = new Map();

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frameSize() {
    const { width, height } = getViewportSize();
    return { w: width, h: height };
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

  function readTransform2d(tf) {
    if (!tf || tf === "none") return { x: 0, y: 0, rotate: 0, scale: 1 };
    try {
      const matrix = new DOMMatrix(tf);
      return {
        x: matrix.e,
        y: matrix.f,
        rotate: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
        scale: Math.hypot(matrix.a, matrix.b) || 1,
      };
    } catch {
      return { x: 0, y: 0, rotate: 0, scale: 1 };
    }
  }

  function cardLayout(el) {
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  }

  /**
   * Unrotated iframe-fixed box of a live in-deck card.
   * AABB center + layout size, so close can tween to the painted stack pose
   * (including −1deg program tilt) without measuring the fullscreen node.
   */
  function captureFixedHome(el) {
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left + rect.width / 2 - width / 2,
      top: rect.top + rect.height / 2 - height / 2,
      width,
      height,
      rotate: readVisualRotate(el),
      radius: getComputedStyle(el).borderRadius || "2px",
    };
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

  function stackCardSize(from) {
    if (from?.width > 0 && from?.height > 0) {
      return { w: from.width, h: from.height };
    }
    const root = getComputedStyle(document.documentElement);
    if (card?.hasAttribute("data-works-card") && !isMobile()) {
      const side =
        Number.parseFloat(getComputedStyle(card).getPropertyValue("--works-side")) ||
        Number.parseFloat(root.getPropertyValue("--stack-card-h")) ||
        0;
      return { w: side, h: side };
    }
    return {
      w: Number.parseFloat(root.getPropertyValue("--stack-card-w")) || 0,
      h: Number.parseFloat(root.getPropertyValue("--stack-card-h")) || 0,
    };
  }

  function destVisual(from) {
    const { w: vw, h: vh } = frameSize();
    if (isMobile()) {
      return { left: 0, top: 0, width: vw, height: vh, rotate: 0 };
    }
    const size = stackCardSize(from);
    return desktopFocusDestVisual({
      frameW: vw,
      frameH: vh,
      cardW: size.w,
      cardH: size.h,
      works: Boolean(card?.hasAttribute("data-works-card")),
    });
  }

  function destBox(from) {
    return visualBoxToCardSpace(destVisual(from));
  }

  /** Mobile fullscreen: the tapped node is the surface (no clone). */
  function useExpand() {
    return isMobile();
  }

  function visualToLocalBox(rect) {
    const tl = visualToDeckLocal(rect.left, rect.top);
    const br = visualToDeckLocal(rect.left + rect.width, rect.top + rect.height);
    return {
      left: tl.x,
      top: tl.y,
      width: br.x - tl.x,
      height: br.y - tl.y,
    };
  }

  function captureExpandFrom(el) {
    const tf = readTransform2d(el.style.transform);
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
      x: tf.x,
      y: tf.y,
      rotate: tf.rotate,
      scale: tf.scale,
      radius: getComputedStyle(el).borderRadius || "2px",
    };
  }

  function poseTransform(pose) {
    const scale = pose.scale ?? 1;
    return `translate3d(${pose.x}px, ${pose.y}px, 0) rotateZ(${pose.rotate ?? 0}deg) rotateY(0deg) rotateX(0deg) scale(${scale})`;
  }

  /** Fullscreen dest in the same translate3d + rotateZ model as the stack. */
  function expandOpenPose(from) {
    const { w: vw, h: vh } = frameSize();
    const dest = visualToLocalBox({ left: 0, top: 0, width: vw, height: vh });
    return {
      x: dest.left - from.left,
      y: dest.top - from.top,
      rotate: 0,
      scale: 1,
      width: dest.width,
      height: dest.height,
      radius: "0px",
    };
  }

  function expandClosePose() {
    const saved = card ? poses.get(card) : null;
    const tf = readTransform2d(saved?.restTransform ?? restTransform);
    const from = fromLocal;
    return {
      x: tf.x,
      y: tf.y,
      rotate: tf.rotate,
      scale: tf.scale,
      width: from?.width || saved?.layout?.width || 0,
      height: from?.height || saved?.layout?.height || 0,
      radius: fromRadius || saved?.fromFixed?.radius || "2px",
    };
  }

  /**
   * Stay in-deck: default left/top/margin, animate width/height + the stack's
   * translate3d/rotateZ. Margin is frozen at the stacked size so the layout
   * origin does not move while --card-w tracks --fly-w for type.
   */
  function applyExpandPose(el, pose, withTransition) {
    const stackW = fromLocal?.width || pose.width;
    const stackH = fromLocal?.height || pose.height;
    el.style.position = "";
    el.style.right = "";
    if (isMobile()) {
      el.style.marginTop = "0";
      const nudge =
        getComputedStyle(document.documentElement).getPropertyValue("--deck-nudge-x").trim() || "0px";
      el.style.marginLeft = `calc(${-stackW / 2}px + ${nudge})`;
    } else {
      el.style.marginLeft = `${-stackW / 2}px`;
      el.style.marginTop = `${-stackH / 2}px`;
    }
    el.style.marginRight = "0";
    el.style.marginBottom = "0";
    el.style.width = `${pose.width}px`;
    el.style.height = `${pose.height}px`;
    el.style.zIndex = "50";
    el.style.transformOrigin = "50% 50%";
    el.style.transform = poseTransform(pose);
    el.style.setProperty("--fly-w", `${pose.width}px`);
    el.style.setProperty("--fly-h", `${pose.height}px`);
    el.style.setProperty("--fly-rot", `${pose.rotate ?? 0}deg`);
    el.style.setProperty("--fly-ms", withTransition && !reduceMotion() ? `${EXPAND_MS}ms` : "0ms");
    el.style.setProperty("--fly-ease", EXPAND_EASE);
    // --card-w follows interpolating --fly-w via CSS. Setting it inline
    // to dest width snaps --u paddings/type while the box is still stacked.
    el.style.removeProperty("--card-w");
    if (pose.radius != null) el.style.borderRadius = pose.radius;
    el.style.willChange = withTransition ? "transform, width, height" : "";
  }

  function clearExpandHost(el) {
    el.removeAttribute("data-expand-host");
    el.removeAttribute("data-expand-settled");
    el.removeAttribute("data-expand-closing");
    el.removeAttribute("data-body-grow");
    el.style.position = "";
    el.style.zIndex = "";
    el.style.transformOrigin = "";
    el.style.borderRadius = "";
    el.style.willChange = "";
    el.style.marginLeft = "";
    el.style.marginTop = "";
    el.style.marginRight = "";
    el.style.marginBottom = "";
  }

  /**
   * Close dest in iframe-fixed pixels — the painted stack card, not the
   * fullscreen node and not capturePose's in-deck left/top.
   * Snapshot was taken while the card was still in the deck.
   */
  function landingBox() {
    const saved = card ? poses.get(card) : null;
    const radius = fromRadius || saved?.fromFixed?.radius || "2px";
    const home = saved?.fromFixed;
    if (home && home.width > 0 && home.height > 0) {
      return { ...home, radius };
    }
    const layout = saved?.layout;
    const tfSrc = saved?.restTransform ?? restTransform;
    if (layout && layout.width > 0) {
      const tf = readTransform2d(tfSrc);
      const vis = deckLocalToVisual(layout.left, layout.top);
      const { scaleX, scaleY } = deckSpace();
      return {
        left: vis.x + tf.x * scaleX,
        top: vis.y + tf.y * scaleY,
        width: layout.width,
        height: layout.height,
        rotate: tf.rotate,
        radius,
      };
    }
    const size = stackCardSize(rest);
    if (rest && (rest.width > 0 || size.w > 0)) {
      return {
        left: rest.left,
        top: rest.top,
        width: size.w || rest.width,
        height: size.h || rest.height,
        rotate: rest.rotate ?? 0,
        radius,
      };
    }
    if (fromLocal) {
      return { ...fromLocal, rotate: fromLocal.rotate ?? 0, radius };
    }
    return { ...expandDest(), rotate: 0, radius };
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
    if (host.hasAttribute("data-expand-host")) {
      return event.propertyName === "transform" || event.propertyName === "width";
    }
    return (
      event.propertyName === "top" ||
      event.propertyName === "left" ||
      event.propertyName === "height" ||
      event.propertyName === "width" ||
      event.propertyName === "transform" ||
      event.propertyName === "border-radius" ||
      event.propertyName === "--fly-w" ||
      event.propertyName === "--fly-rot"
    );
  }

  function trapCardScroll(event) {
    event.stopPropagation();
  }

  function resetCardScroll(el) {
    if (!el) return;
    el.scrollTop = 0;
    const program = el.querySelector(".program-card");
    if (program) program.scrollTop = 0;
    const sheet = el.querySelector(".program-card__sheet");
    if (sheet) sheet.scrollTop = 0;
    const works = el.querySelector(".works-card");
    if (works) works.scrollTop = 0;
    const worksList = el.querySelector(".works-card__list");
    if (worksList) worksList.scrollTop = 0;
  }

  function persistIllust(el) {
    if (!el?.querySelector("[data-fly-illust-close]")) return false;
    // Desktop program dog stays painted and is the close control. Mobile uses fly-close.
    return el.hasAttribute("data-program-card") && !isMobile();
  }

  function isMobilePeekIllust(target) {
    return isMobile() && Boolean(target?.closest?.("[data-fly-illust-close]"));
  }

  function setIllustOut(el, hidden) {
    if (!el) return;
    // Desktop program dog stays painted through expand (it is the close control).
    if (hidden && persistIllust(el)) {
      el.removeAttribute("data-illust-out");
      return;
    }
    if (hidden) el.setAttribute("data-illust-out", "");
    else el.removeAttribute("data-illust-out");
  }

  function lockCard() {
    if (!card) return;
    card.setAttribute("data-fly-lock", "");
    card.setAttribute("data-focus-open", "");
    card.classList.remove("is-hovered", "is-fly-pinned");
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
    el.style.removeProperty("--card-w");
  }

  function releaseCard(keepDeck) {
    if (!card) return;
    unmountFocusScrollbar(card);
    card.removeEventListener("wheel", trapCardScroll);
    card.removeEventListener("touchmove", trapCardScroll);
    resetCardScroll(card);
    card.classList.remove("is-program-open", "is-program-scroll", "is-work-open", "is-fly-pinned");
    clearExpandHost(card);
    card.style.transform = restTransform;
    clearFlyBox(card);
    setIllustOut(card, false);
    restTransform = "";
    fromLocal = null;
    fromRadius = "2px";
    card.removeAttribute("data-fly-lock");
    card.removeAttribute("data-focus-open");
    card.removeAttribute("data-work-student");
    card.setAttribute("data-rest-lock", "");
    applyDeckParams();
    if (!keepDeck && !closeAfter) deck.removeAttribute("data-program-open");
  }

  function rectMismatch(a, b) {
    return Math.max(
      Math.abs(a.left - b.left),
      Math.abs(a.top - b.top),
      Math.abs(a.width - b.width),
      Math.abs(a.height - b.height),
    );
  }

  function measureStackDest(host, home) {
    const clone = host.cloneNode(false);
    clone.className = host.className;
    clone.classList.remove("is-program-open", "is-program-scroll", "is-work-open", "is-fly-pinned");
    ["data-expand-host", "data-expand-settled", "data-expand-closing", "data-body-grow", "data-fly-lock", "data-focus-open"].forEach(
      (name) => clone.removeAttribute(name),
    );
    clone.setAttribute("data-rest-lock", "");
    clone.style.cssText = "";
    clone.style.transform = home;
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    clone.setAttribute("aria-hidden", "true");
    host.parentNode?.insertBefore(clone, host.nextSibling);
    const rect = clone.getBoundingClientRect();
    clone.remove();
    return rect;
  }

  function commitExpandRelease(host, home) {
    unmountFocusScrollbar(host);
    host.removeEventListener("wheel", trapCardScroll);
    host.removeEventListener("touchmove", trapCardScroll);
    resetCardScroll(host);
    host.classList.remove("is-program-open", "is-program-scroll", "is-work-open", "is-fly-pinned");
    clearExpandHost(host);
    clearFlyBox(host);
    setIllustOut(host, false);
    host.style.transform = home;
    host.removeAttribute("data-fly-lock");
    host.removeAttribute("data-focus-open");
    host.removeAttribute("data-work-student");
    host.setAttribute("data-rest-lock", "");
    applyDeckParams();
    host.style.transition = "";
    restTransform = "";
    fromLocal = null;
    fromRadius = "2px";
    if (!closeAfter) deck.removeAttribute("data-program-open");
  }

  /**
   * Close already landed on the live stack matrix. Drop expand chrome in the
   * same frame — no position:fixed ↔ relative swap, no leftover invert.
   * Returns false if dest rect still disagrees (one more frame, don't idle yet).
   */
  function finishExpandClose(attempt = 0) {
    if (!card) return true;
    const host = card;
    const home = restTransform || "";
    const closePose = expandClosePose();

    host.style.setProperty("--fly-ms", "0ms");
    host.style.transition = "none";
    applyExpandPose(host, closePose, false);
    host.style.transform = home;

    const current = host.getBoundingClientRect();
    const dest = measureStackDest(host, home);
    lastHandoffPx = rectMismatch(current, dest);

    if (lastHandoffPx > 0.5 && attempt < 1) {
      requestAnimationFrame(() => {
        if (card !== host || phase !== "closing") return;
        if (finishExpandClose(attempt + 1)) completeClose();
      });
      return false;
    }

    commitExpandRelease(host, home);
    const after = host.getBoundingClientRect();
    lastHandoffPx = rectMismatch(current, after);
    return true;
  }

  function completeClose() {
    phase = "idle";
    rest = null;
    poses = new Map();
    const next = closeAfter;
    closeAfter = null;
    card = null;
    syncAria();
    next?.();
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
    const ms = Number.parseFloat(host.style.getPropertyValue("--fly-ms"));
    const dur = Number.isFinite(ms) ? ms : FLY_MS;
    flyTimer = window.setTimeout(finish, dur + 48);
  }

  function onFlySettled() {
    if (phase === "opening") {
      phase = "open";
      if (card) {
        if (card.hasAttribute("data-expand-host")) {
          card.style.borderRadius = "0px";
          card.setAttribute("data-expand-settled", "");
        }
        card.classList.add("is-program-scroll");
        // Overlay pin (absolute → fixed, same inset 0) must not restart
        // width/type with a leftover duration. Zero after the scheme swap.
        card.style.setProperty("--fly-ms", "0ms");
        syncFocusScrollbar(card);
      }
      syncAria();
      return;
    }
    if (phase !== "closing") return;
    if (card?.hasAttribute("data-expand-host")) {
      if (!finishExpandClose()) return;
    } else {
      releaseCard();
    }
    completeClose();
  }

  function playFly(nextBox, immediate) {
    const run = () => {
      pin(nextBox, !reduceMotion());
      afterFly(onFlySettled);
    };
    if (reduceMotion() || immediate) {
      run();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function expandDest() {
    const { w, h } = frameSize();
    return visualToLocalBox({ left: 0, top: 0, width: w, height: h });
  }

  function startExpandOpen() {
    if (!card) {
      onFlySettled();
      return;
    }
    const origin = {
      x: fromLocal?.x ?? 0,
      y: fromLocal?.y ?? 0,
      rotate: fromLocal?.rotate ?? 0,
      scale: fromLocal?.scale ?? 1,
      width: fromLocal?.width ?? card.offsetWidth,
      height: fromLocal?.height ?? card.offsetHeight,
      radius: fromRadius,
    };
    const dest = expandOpenPose(fromLocal || origin);
    const retarget =
      card.hasAttribute("data-expand-settled") ||
      card.style.getPropertyValue("--fly-w") !== "";
    if (reduceMotion()) {
      card.setAttribute("data-body-grow", "");
      applyExpandPose(card, dest, false);
      onFlySettled();
      return;
    }
    // Arm duration before body-grow so padding/type tween with the box,
    // not as a 0ms snap from onFlySettled's leftover --fly-ms: 0.
    card.style.setProperty("--fly-ms", `${EXPAND_MS}ms`);
    card.style.setProperty("--fly-ease", EXPAND_EASE);
    card.setAttribute("data-body-grow", "");
    const run = () => {
      applyExpandPose(card, dest, true);
      afterFly(onFlySettled);
    };
    if (!retarget) {
      applyExpandPose(card, origin, false);
      card.getBoundingClientRect();
    }
    // Two frames so the stacked pose paints before the dest tween (same as playFly).
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function startExpandClose() {
    if (!card) {
      onFlySettled();
      return;
    }
    const origin = expandClosePose();
    if (reduceMotion()) {
      card.removeAttribute("data-expand-settled");
      card.removeAttribute("data-body-grow");
      card.removeAttribute("data-expand-closing");
      applyExpandPose(card, origin, false);
      setIllustOut(card, false);
      onFlySettled();
      return;
    }
    card.style.setProperty("--fly-ms", `${EXPAND_MS}ms`);
    card.style.setProperty("--fly-ease", EXPAND_EASE);
    const run = () => {
      card.setAttribute("data-expand-closing", "");
      card.removeAttribute("data-expand-settled");
      card.removeAttribute("data-body-grow");
      applyExpandPose(card, origin, true);
      setIllustOut(card, false);
      afterFly(onFlySettled);
    };
    applyExpandPose(card, expandOpenPose(fromLocal || captureExpandFrom(card)), false);
    card.getBoundingClientRect();
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function snapshotPoses() {
    if (poses.size) return;
    cards.forEach((el) => {
      poses.set(el, {
        rest: capturePose(el),
        restTransform: el.style.transform,
        layout: cardLayout(el),
        fromFixed: captureFixedHome(el),
      });
    });
  }

  function rememberPose(el, nextRest, nextTransform) {
    const prev = poses.get(el);
    const fixed = getComputedStyle(el).position === "fixed";
    poses.set(el, {
      rest: nextRest,
      restTransform: nextTransform,
      layout: fixed && prev?.layout ? prev.layout : cardLayout(el),
      fromFixed: fixed && prev?.fromFixed ? prev.fromFixed : captureFixedHome(el),
    });
  }

  /** Park at the --fly-* landing. Do not hand off to a second transform. */
  function settleRetire(el) {
    unmountFocusScrollbar(el);
    el.removeEventListener("wheel", trapCardScroll);
    el.removeEventListener("touchmove", trapCardScroll);
    el.classList.remove("is-program-open", "is-program-scroll", "is-work-open");
    el.classList.add("is-fly-pinned");
    el.style.setProperty("--fly-ms", "0ms");
    setIllustOut(el, false);
    el.removeAttribute("data-fly-lock");
    el.removeAttribute("data-focus-open");
    el.removeAttribute("data-work-student");
  }

  /** Home pose: one transform, then rest-lock until deck spread is 0. */
  function finishRetireHome(el, restTf) {
    unmountFocusScrollbar(el);
    el.removeEventListener("wheel", trapCardScroll);
    el.removeEventListener("touchmove", trapCardScroll);
    resetCardScroll(el);
    el.classList.remove("is-program-open", "is-program-scroll", "is-work-open", "is-fly-pinned");
    el.style.transform = restTf;
    clearFlyBox(el);
    setIllustOut(el, false);
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
    setIllustOut(el, false);
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
    if (useExpand()) {
      const shot = captureExpandFrom(card);
      fromLocal = shot;
      fromRadius = shot.radius;
      card.setAttribute("data-expand-host", "");
      card.style.setProperty("--fly-ms", "0ms");
      lockCard();
      applyExpandPose(card, {
        x: shot.x,
        y: shot.y,
        rotate: shot.rotate,
        scale: shot.scale,
        width: shot.width,
        height: shot.height,
        radius: shot.radius,
      }, false);
      syncAria();
      startExpandOpen();
      return;
    }
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
    fadeFocusScrollbar(card, false);
    card?.classList.remove("is-work-open", "is-program-scroll");
    cards.forEach((el) => {
      if (el === card) return;
      if (el.classList.contains("is-fly-pinned") || retiring.has(el)) retireToHome(el);
    });
    if (!closeAfter) deck.removeAttribute("data-program-open");
    syncAria();
    if (card?.hasAttribute("data-expand-host")) {
      startExpandClose();
      return;
    }
    playFly(rest ?? (card ? capturePose(card) : destBox()), true);
  }

  function demoteExpand(el) {
    if (!el.hasAttribute("data-expand-host")) return;
    const local = {
      ...visualToLocalBox(el.getBoundingClientRect()),
      rotate: readVisualRotate(el),
    };
    clearExpandHost(el);
    el.style.borderRadius = "";
    pinEl(el, local, false);
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

    resetCardScroll(outgoingEl);
    fadeFocusScrollbar(outgoingEl, false);
    outgoingEl.classList.remove("is-work-open", "is-program-scroll");
    outgoingEl.removeEventListener("wheel", trapCardScroll);
    outgoingEl.removeEventListener("touchmove", trapCardScroll);
    outgoingEl.removeAttribute("data-focus-open");
    outgoingEl.removeAttribute("data-work-student");
    demoteExpand(outgoingEl);

    cancelRetire(target);
    const expand = useExpand();
    const fromVisual = expand ? captureExpandFrom(target) : capturePose(target);
    const inSaved = poses.get(target);
    card = target;
    rest = inSaved?.rest ?? (expand ? capturePose(target) : fromVisual);
    restTransform = inSaved?.restTransform ?? target.style.transform;
    if (!inSaved) rememberPose(target, rest, restTransform);

    if (expand) {
      fromLocal = fromVisual;
      fromRadius = fromVisual.radius;
      card.setAttribute("data-expand-host", "");
      card.style.setProperty("--fly-ms", "0ms");
    } else {
      pin(fromVisual, false);
    }
    lockCard();
    if (expand) {
      applyExpandPose(card, {
        x: fromVisual.x,
        y: fromVisual.y,
        rotate: fromVisual.rotate,
        scale: fromVisual.scale,
        width: fromVisual.width,
        height: fromVisual.height,
        radius: fromVisual.radius,
      }, false);
    }
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
    if (expand) startExpandOpen();
    else playFly(dest);
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
    const flow = cards.filter((el) => inDeckFlow(el));
    const idx = flow.indexOf(card);
    if (idx < 0) return null;
    const next = idx + dir;
    if (next < 0 || next >= flow.length) return null;
    return flow[next];
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

  /** Program, works, history, or a yan/polina/alena suitcase — not the progress wrapper. */
  function canOpenOnMobile(el, sheet) {
    if (el.hasAttribute("data-program-card")) return true;
    if (el.hasAttribute("data-works-card")) return true;
    if (el.hasAttribute("data-history-card") || el.querySelector(".history-card")) return true;
    if (el.hasAttribute("data-work-card")) return Boolean(sheet);
    return false;
  }

  /** Topmost still-visible card under the point (skips fully gone / inert). */
  function topVisibleCard(x, y) {
    const hits = document.elementsFromPoint(x, y);
    for (const node of hits) {
      if (!(node instanceof Element)) continue;
      const host = node.closest(FOCUS_SEL);
      if (!host || !cards.includes(host) || !inDeckFlow(host)) continue;
      if (host.classList.contains("is-stack-inert")) continue;
      return host;
    }
    return null;
  }

  function eventEl(event) {
    const target = event.target;
    if (target instanceof Element) return target;
    return target instanceof Node ? target.parentElement : null;
  }

  /**
   * Which card should open from this tap.
   * Mobile: topmost visible card under the finger; only the allowed set opens.
   * Desktop: keep the existing openable set (any focus card).
   */
  function resolveOpenTarget(event, fallbackEl) {
    const raw = eventEl(event);
    const sheet = raw?.closest?.(WORK_OPEN) || null;
    const mobile = isMobile();
    const cardEl = mobile
      ? topVisibleCard(event.clientX, event.clientY)
      : fallbackEl || raw?.closest?.(FOCUS_SEL);
    if (!cardEl || !cards.includes(cardEl) || !inDeckFlow(cardEl)) return null;
    if (mobile && cardEl !== topVisibleCard(event.clientX, event.clientY)) return null;
    const workSheet = cardEl.hasAttribute("data-work-card") ? sheet : null;
    if (mobile && !canOpenOnMobile(cardEl, workSheet)) return null;
    return { card: cardEl, sheet: workSheet };
  }

  function applyWorkSheet(host, sheet) {
    if (!host || !sheet) return;
    host.setAttribute("data-work-student", sheet.getAttribute("data-work-open") || "");
  }

  function workStudentIds(host) {
    const root = host || card;
    if (!root?.hasAttribute("data-work-card")) return [];
    return [...root.querySelectorAll(WORK_OPEN)]
      .map((sheet) => sheet.getAttribute("data-work-open") || "")
      .filter(Boolean);
  }

  function switchWorkStudent(dir) {
    if (!card?.hasAttribute("data-work-card")) return;
    if (phase !== "open" && phase !== "opening") return;
    const list = workStudentIds(card);
    if (list.length < 2) return;
    const cur = card.getAttribute("data-work-student") || "";
    const idx = list.indexOf(cur);
    if (idx < 0) return;
    const next = list[(idx + dir + list.length) % list.length];
    if (!next || next === cur) return;
    card.classList.add("is-work-switch");
    void card.offsetWidth;
    card.setAttribute("data-work-student", next);
    card.scrollTop = 0;
    card.classList.add("is-work-open");
    requestAnimationFrame(() => {
      card?.classList.remove("is-work-switch");
      syncFocusScrollbar(card);
    });
  }

  function openFromTarget(target) {
    if (!target) return;
    const { card: next, sheet } = target;
    applyWorkSheet(next, sheet);
    if (next === card && (phase === "open" || phase === "opening")) {
      if (sheet) {
        next.classList.add("is-work-open");
        mountFocusScrollbar(next);
        syncAria();
      }
      return;
    }
    focusCard(next);
  }

  function labelKey(el, expanded) {
    if (el.hasAttribute("data-program-card")) return expanded ? "program.close" : "program.open";
    if (el.hasAttribute("data-work-card")) return expanded ? "work.close" : "work.open";
    if (el.hasAttribute("data-works-card")) return expanded ? "works.close" : "works.open";
    if (el.querySelector(".history-card")) return expanded ? "history.close" : "history.open";
    return expanded ? "card.close" : "card.open";
  }

  function syncCloseBtn() {
    const expanded = phase === "open" || phase === "opening";
    const closing = phase === "closing";
    const showGlobal = (expanded || closing) && Boolean(card) && isMobile();
    if (closeBtn) {
      closeBtn.hidden = !showGlobal;
      closeBtn.classList.toggle("is-leaving", closing);
      if (showGlobal && !closing) closeBtn.setAttribute("aria-label", t(labelKey(card, true)));
    }
    document.querySelectorAll("[data-article-close]").forEach((btn) => {
      btn.hidden = true;
    });
  }

  function syncIllustClose() {
    document.querySelectorAll("[data-fly-illust-close]").forEach((illust) => {
      const host = illust.closest(FOCUS_SEL);
      const expanded = host === card && (phase === "open" || phase === "opening");
      const closeControl = persistIllust(host) && expanded;
      illust.setAttribute("aria-hidden", closeControl ? "false" : "true");
      if (closeControl) {
        illust.setAttribute("role", "button");
        illust.setAttribute("aria-label", t("illust.close"));
      } else {
        illust.removeAttribute("role");
        illust.removeAttribute("aria-label");
      }
      const cue = illust.querySelector(".works-card__key-cue, .card-illust__cue");
      if (!cue) return;
      const key = closeControl ? "illust.close" : "illust.open";
      cue.setAttribute("data-i18n", key);
      cue.textContent = t(key);
    });
  }

  function syncAria() {
    const expanded = phase === "open" || phase === "opening";
    cards.forEach((el) => {
      const isThis = expanded && el === card;
      el.setAttribute("aria-expanded", isThis ? "true" : "false");
      el.setAttribute("aria-label", t(labelKey(el, isThis)));
    });
    syncCloseBtn();
    syncIllustClose();
  }

  syncAria();

  cards.forEach((el) => {
    el.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
      if (el.classList.contains("is-program-open")) {
        const root = focusScrollRoot(el);
        const top = root.scrollTop;
        const left = root.scrollLeft;
        requestAnimationFrame(() => {
          if (root.scrollTop !== top) root.scrollTop = top;
          if (root.scrollLeft !== left) root.scrollLeft = left;
        });
      }
      // Let the deck capture a vertical swipe. Only real controls keep the event.
      if (
        (event.target.closest?.(FOCUS_IGNORE) && !isMobilePeekIllust(event.target)) ||
        event.target.closest?.(WORK_IG)
      ) {
        event.stopPropagation();
      }
    });

    el.addEventListener("click", (event) => {
      if (event.target.closest?.(WORK_IG)) {
        event.stopPropagation();
        return;
      }
      if (
        event.target.closest?.(FOCUS_IGNORE) &&
        !event.target.closest?.(WORK_OPEN) &&
        !isMobilePeekIllust(event.target)
      ) {
        event.stopPropagation();
        return;
      }
      const moved =
        start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_CLICK_PX;
      const target = resolveOpenTarget(event, el);
      if (!target) return;
      if (target.card === card && (phase === "open" || phase === "opening") && !target.sheet) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (moved) return;
      openFromTarget(target);
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
      const target = resolveOpenTarget(event, sheet.closest("[data-work-card]"));
      if (!target?.sheet) return;
      openFromTarget(target);
    });
  });

  document.querySelectorAll(WORK_IG).forEach((ig) => {
    ig.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  document.querySelectorAll("[data-work-student-prev], [data-work-student-next]").forEach((btn) => {
    btn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      switchWorkStudent(btn.hasAttribute("data-work-student-prev") ? -1 : 1);
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
      const hit = target instanceof Element ? target : target.parentElement;
      if (hit?.closest?.(SIDE_CHROME)) return;
      if (hit?.closest?.(WORK_IG)) return;
      if (hit?.closest?.(FOCUS_IGNORE) && !hit.closest?.(WORK_OPEN) && !isMobilePeekIllust(hit)) {
        return;
      }

      const resolved = resolveOpenTarget(event, hit?.closest?.(FOCUS_SEL));
      if (resolved?.card === card) return;
      if (resolved?.card && resolved.card !== card) {
        event.preventDefault();
        event.stopPropagation();
        openFromTarget(resolved);
        return;
      }
      if (card?.contains(target)) return;
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

  document.querySelectorAll("[data-article-close]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const host = btn.closest(FOCUS_SEL);
      if (host !== card || (phase !== "open" && phase !== "opening")) return;
      event.preventDefault();
      event.stopPropagation();
      closeFocus();
    });
  });

  document.querySelectorAll("[data-fly-illust-close]").forEach((illust) => {
    illust.addEventListener("click", (event) => {
      const host = illust.closest(FOCUS_SEL);
      if (!persistIllust(host)) return;
      if (host !== card || (phase !== "open" && phase !== "opening")) return;
      event.preventDefault();
      event.stopPropagation();
      closeFocus();
    });
  });

  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;
    if (phase !== "open" && phase !== "opening") return;
    if (event.target?.closest?.("[data-stage-settings], [data-tweaks]")) return;
    if (document.querySelector(".stage-settings.is-open")) return;
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
    syncCloseBtn();
    if (card?.hasAttribute("data-expand-host")) {
      applyExpandPose(card, expandOpenPose(fromLocal || captureExpandFrom(card)), false);
      card.style.borderRadius = "0px";
      const size = stackCardSize(rest);
      if (rest && size.w > 0 && size.h > 0) {
        rest = { ...rest, width: size.w, height: size.h };
      }
    } else {
      pin(destBox(rest), false);
    }
    syncFocusScrollbar(card);
  };
  window.addEventListener("resize", onFrameResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onFrameResize, { passive: true });
  document.addEventListener("kaik:stage-nudge", onFrameResize);

  return {
    open: () => focusCard(programCard),
    openWorks: () => focusCard(worksCard),
    close: closeFocus,
    isFocused: () => phase === "open" || phase === "opening",
    isProgramFocused: () =>
      Boolean(card?.hasAttribute("data-program-card") && (phase === "open" || phase === "opening")),
    isWorksFocused: () =>
      Boolean(card?.hasAttribute("data-works-card") && (phase === "open" || phase === "opening")),
    lastHandoffPx: () => lastHandoffPx,
  };
}
