import { t } from "./scriptik.js";
import { applyDeckParams, isMobile } from "./tweaks.js";

const PROGRAM_NAV = "[data-program-nav], [data-i18n='nav.program']";
const FOCUS_SEL = "[data-focus-card], [data-program-card], [data-work-card]";
const FOCUS_IGNORE = "a, button, [data-tweaks], [data-tweaks-reopen], [data-img-slider], [data-history-slideshow], [data-open-program]";
const WORK_OPEN = "[data-work-open]";
const WORK_IG = "[data-work-ig]";
const FLY_CLOSE = "[data-fly-close]";
const CLOSE_BAR_FALLBACK = 72;

export function initProgramModal() {
  const cards = [...new Set([...document.querySelectorAll(FOCUS_SEL)])];
  const deck = document.querySelector("[data-deck]");
  if (!cards.length || !deck) return null;

  const programCard = cards.find((el) => el.hasAttribute("data-program-card")) || null;

  const FLY_MS = 920;
  const FLY_EASE = "cubic-bezier(0.22, 1, 0.32, 1)";
  const TOP_GAP = 28;
  const OPEN_W = 680;
  const OPEN_GUTTER = 48;
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

  function closeBarH() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--fly-close-h");
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : CLOSE_BAR_FALLBACK;
  }

  function openWidth() {
    const { w: vw } = frameSize();
    if (isMobile()) return vw;
    const host = card;
    const raw = host
      ? getComputedStyle(host).getPropertyValue("--focus-open-w").trim() ||
        getComputedStyle(host).getPropertyValue("--program-open-w").trim()
      : "";
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return Math.min(OPEN_W, Math.max(0, vw - OPEN_GUTTER));
  }

  function destBox(from) {
    const { w: vw, h: vh } = frameSize();
    const mobile = isMobile();
    const gutter = mobile ? 0 : OPEN_GUTTER;
    const side = gutter / 2;
    const panel = document.querySelector("[data-panel]");
    const panelH = panel?.getBoundingClientRect().height ?? 0;
    const topGap = mobile ? Math.min(Math.max(TOP_GAP, panelH + 8), vh * 0.32) : TOP_GAP;
    const bottomGap = mobile ? closeBarH() : 28;
    const { scaleX, scaleY } = deckSpace();
    const maxW = Math.max(0, vw - gutter);
    const maxH = Math.max(0, vh - topGap - bottomGap);
    let width = Math.min(openWidth(), maxW);
    let height = Math.max((from?.height ?? 0) * scaleY, maxH);
    if (mobile) {
      width = maxW;
      height = maxH;
    } else if (card?.hasAttribute("data-works-card")) {
      const foldedVisual = Math.max((from?.width ?? 0) * scaleX, (from?.height ?? 0) * scaleY);
      const grown = foldedVisual > 0 ? foldedVisual * WORKS_OPEN_SCALE : 0;
      // Square works card is already wider than A4 — never cap at the 680 program dest.
      // Dest is a tall column; inner 64:20 --u uses layout width (cqw/842), not this height.
      width = Math.min(maxW, Math.max(foldedVisual, grown));
      if (width <= 0) width = Math.min(maxW, maxH * 0.72);
      height = maxH;
    }
    let left = mobile ? 0 : (vw - width) / 2;
    if (!mobile) {
      if (left < side) left = side;
      if (left + width > vw - side) left = Math.max(side, vw - side - width);
    }
    const top = topGap;
    return visualBoxToCardSpace({
      left,
      top,
      width,
      height,
      rotate: 0,
    });
  }

  function pin(box, withTransition) {
    if (!card) return;
    card.style.left = "";
    card.style.right = "";
    card.style.top = "";
    card.style.margin = "";
    card.style.width = "";
    card.style.height = "";
    card.style.setProperty("--fly-l", `${box.left}px`);
    card.style.setProperty("--fly-t", `${box.top}px`);
    card.style.setProperty("--fly-w", `${box.width}px`);
    card.style.setProperty("--fly-h", `${box.height}px`);
    card.style.setProperty("--fly-rot", `${box.rotate ?? 0}deg`);
    card.style.setProperty("--fly-ms", withTransition ? `${FLY_MS}ms` : "0ms");
    card.style.setProperty("--fly-ease", FLY_EASE);
    card.style.transform = "";
  }

  function trapCardScroll(event) {
    event.stopPropagation();
  }

  function lockCard() {
    if (!card) return;
    card.classList.remove("is-hovered");
    card.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    card.setAttribute("data-fly-lock", "");
    card.classList.add("is-program-open");
    if (card.hasAttribute("data-work-student")) {
      card.getBoundingClientRect();
      card.classList.add("is-work-open");
    }
    deck.setAttribute("data-program-open", "");
    card.addEventListener("wheel", trapCardScroll, { passive: true });
    card.addEventListener("touchmove", trapCardScroll, { passive: true });
  }

  function releaseCard() {
    if (!card) return;
    card.removeEventListener("wheel", trapCardScroll);
    card.removeEventListener("touchmove", trapCardScroll);
    card.classList.remove("is-program-open", "is-program-scroll", "is-work-open");
    [
      "--fly-l",
      "--fly-t",
      "--fly-w",
      "--fly-h",
      "--fly-rot",
      "--fly-ms",
      "--fly-ease",
    ].forEach((name) => card.style.removeProperty(name));
    card.style.left = "";
    card.style.right = "";
    card.style.top = "";
    card.style.margin = "";
    card.style.width = "";
    card.style.height = "";
    card.style.transform = restTransform;
    restTransform = "";
    card.removeAttribute("data-fly-lock");
    card.removeAttribute("data-work-student");
    applyDeckParams();
    deck.removeAttribute("data-program-open");
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
      if (event.target !== host) return;
      if (
        event.propertyName !== "top" &&
        event.propertyName !== "left" &&
        event.propertyName !== "height" &&
        event.propertyName !== "width" &&
        event.propertyName !== "transform" &&
        event.propertyName !== "--fly-w" &&
        event.propertyName !== "--fly-rot"
      ) {
        return;
      }
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
          card?.classList.add("is-program-scroll");
          syncAria();
          return;
        }
        if (phase !== "closing") return;
        releaseCard();
        phase = "idle";
        rest = null;
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

  function openFocus(target) {
    const next = target || programCard;
    if (phase !== "idle" || !next) return;
    card = next;
    phase = "opening";
    rest = capturePose(card);
    restTransform = card.style.transform;
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
    card?.classList.remove("is-work-open", "is-program-scroll");
    deck.removeAttribute("data-program-open");
    syncAria();
    playFly(rest ?? (card ? capturePose(card) : destBox()), true);
  }

  function labelKey(el, expanded) {
    if (el.hasAttribute("data-program-card")) return expanded ? "program.close" : "program.open";
    if (el.hasAttribute("data-work-card")) return expanded ? "work.close" : "work.open";
    if (el.hasAttribute("data-works-card")) return expanded ? "works.close" : "works.open";
    return expanded ? "history.close" : "history.open";
  }

  function ensureCloseBtn() {
    const existing = document.querySelector(FLY_CLOSE);
    if (existing instanceof HTMLButtonElement) return existing;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fly-close";
    btn.setAttribute("data-fly-close", "");
    btn.hidden = true;
    btn.setAttribute("aria-hidden", "true");
    const mark = document.createElement("span");
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "×";
    btn.append(mark);
    document.body.append(btn);
    btn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeFocus();
    });
    return btn;
  }

  function syncClose() {
    const btn = ensureCloseBtn();
    const show = isMobile() && (phase === "opening" || phase === "open");
    btn.hidden = !show;
    if (show) {
      btn.removeAttribute("aria-hidden");
      btn.setAttribute("aria-label", t(card ? labelKey(card, true) : "program.close"));
    } else {
      btn.setAttribute("aria-hidden", "true");
    }
  }

  function syncAria() {
    const expanded = phase === "open" || phase === "opening";
    cards.forEach((el) => {
      const isThis = expanded && el === card;
      el.setAttribute("aria-expanded", isThis ? "true" : "false");
      el.setAttribute("aria-label", t(labelKey(el, isThis)));
    });
    syncClose();
  }

  syncAria();

  cards.forEach((el) => {
    el.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
      event.stopPropagation();
    });

    el.addEventListener("click", (event) => {
      if (event.target.closest?.(WORK_IG)) {
        event.stopPropagation();
        return;
      }
      const sheet = el.hasAttribute("data-work-card")
        ? event.target.closest?.(WORK_OPEN)
        : null;
      if (sheet) {
        event.preventDefault();
        event.stopPropagation();
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
        if (phase !== "idle") return;
        el.setAttribute("data-work-student", sheet.getAttribute("data-work-open") || "");
        openFocus(el);
        return;
      }
      if (event.target.closest?.(FOCUS_IGNORE)) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
      if (phase !== "idle") return;
      if (el.hasAttribute("data-work-card")) return;
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
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
      const host = sheet.closest("[data-work-card]");
      if (!host) return;
      if (phase !== "idle") return;
      host.setAttribute("data-work-student", sheet.getAttribute("data-work-open") || "");
      openFocus(host);
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
      const go = () => openFocus(programCard);
      if (phase === "open" || phase === "opening") {
        closeFocus(go);
        return;
      }
      go();
    });
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (phase !== "open") return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (card?.contains(target)) return;
      const hit = target instanceof Element ? target : target.parentElement;
      if (hit?.closest?.(PROGRAM_NAV)) return;
      if (hit?.closest?.(FLY_CLOSE)) return;
      closeFocus();
    },
    true,
  );

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (phase !== "open") return;
    event.preventDefault();
    closeFocus();
  });

  document.addEventListener("kaik:translated", syncAria);

  const onFrameResize = () => {
    if (phase !== "open") return;
    pin(destBox(rest), false);
    syncClose();
  };
  window.addEventListener("resize", onFrameResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onFrameResize, { passive: true });

  return {
    open: () => openFocus(programCard),
    close: closeFocus,
    isFocused: () => phase === "open" || phase === "opening",
    isProgramFocused: () =>
      Boolean(card?.hasAttribute("data-program-card") && (phase === "open" || phase === "opening")),
  };
}
