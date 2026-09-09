/**
 * Fullscreen viewer for a works-catalog item — the site lightbox mechanics
 * (stacked slides on desktop, spring swipe on mobile, cursor-following arrows)
 * bound to the `[data-viewer]` markup. Light palette, fixed to the iframe.
 */

import { isMobile } from "./tweaks.js";
import { workFileUrl } from "./works/catalog.js";
import { imageFiles } from "./works-feed.js";
import { TYPE_FINAL } from "./works/taxonomy.js";

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
const MANY_SLIDES = 12;

/** Name, @nick and stream as spans; muted parts get `.is-muted`. */
export function workMetaNodes(item) {
  const nodes = [];
  if (item.author) {
    const name = document.createElement("span");
    name.textContent = item.author;
    nodes.push(name);
  }
  if (item.nick) {
    const nick = document.createElement("span");
    nick.className = "is-muted";
    nick.textContent = `@${item.nick}`;
    nodes.push(nick);
  }
  if (item.stream) {
    const stream = document.createElement("span");
    stream.className = "is-muted";
    stream.textContent = `поток ${item.stream}`;
    nodes.push(stream);
  }
  return nodes;
}

function altFor(item) {
  const kind = item.type === TYPE_FINAL ? "Финальный проект" : "Работа воркшопа";
  return item.author ? `${kind}, ${item.author}` : kind;
}

export function createWorksViewer(root) {
  if (!root) return null;
  const track = root.querySelector("[data-viewer-track]");
  const pager = root.querySelector("[data-viewer-dots]");
  const caption = root.querySelector("[data-viewer-caption]");
  const counter = root.querySelector("[data-viewer-counter]");
  const chrome = "[data-viewer-close], [data-viewer-dots], [data-viewer-dot]";
  const navSel = "[data-viewer-prev], [data-viewer-next]";

  let items = [];
  let slides = [];
  let dots = [];
  let index = 0;
  let pending = 0;
  let shift = 0;
  let velocity = 0;
  let stopSpring = null;
  let open = false;
  let swipe = null;
  let samples = [];
  let ignoreClickUntil = 0;
  let returnFocus = null;

  const count = () => items.length || 1;
  const wrap = (i) => ((i % count()) + count()) % count();
  const widthOf = () => track?.clientWidth || root.clientWidth || window.innerWidth || 1;

  function wrapDelta(i, current, n, offset) {
    let d = i - current;
    d -= n * Math.round(d / n);
    if (n % 2 === 0 && Math.abs(d) === n / 2) d = offset > 0 ? -n / 2 : n / 2;
    return d;
  }

  function sampleVel(list) {
    if (list.length < 2) return 0;
    const a = list[0];
    const b = list[list.length - 1];
    const dt = b.t - a.t;
    if (dt < 8) return 0;
    return ((b.x - a.x) / dt) * 1000;
  }

  function shortestSteps(from, to) {
    let delta = to - from;
    const n = count();
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    return delta;
  }

  function paint(offset) {
    if (!isMobile()) {
      slides.forEach((slide) => {
        slide.style.transform = "translate3d(0,0,0)";
      });
      return;
    }
    const w = widthOf();
    const n = slides.length;
    slides.forEach((slide, i) => {
      const x = wrapDelta(i, index, n, offset) * w + offset;
      slide.style.transform = `translate3d(${x}px,0,0)`;
      slide.style.opacity = "";
    });
  }

  function syncDots(active = index) {
    const current = wrap(active);
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
    dots.forEach((dot, i) => {
      const on = i === current;
      dot.classList.toggle("is-active", on);
      dot.setAttribute("aria-current", on ? "true" : "false");
    });
    if (counter) counter.textContent = `${current + 1} / ${count()}`;
  }

  function cancelSpring() {
    if (!stopSpring) return;
    stopSpring();
    stopSpring = null;
  }

  function springTo(dest, vel, onDone) {
    cancelSpring();
    if (REDUCE.matches) {
      shift = dest;
      paint(shift);
      onDone();
      return;
    }
    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    const zeta = Math.abs(vel) > 800 ? 0.86 : 1;
    let x = shift;
    let v = vel;
    let last = performance.now();
    let raf = 0;
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const acc = -omega * omega * (x - dest) - 2 * zeta * omega * v;
      v += acc * dt;
      x += v * dt;
      shift = x;
      velocity = v;
      paint(shift);
      if (Math.abs(x - dest) < 0.5 && Math.abs(v) < 12) {
        shift = dest;
        velocity = 0;
        paint(shift);
        stopSpring = null;
        onDone();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    stopSpring = () => cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  function finishIndex(next) {
    index = wrap(next);
    pending = index;
    shift = 0;
    velocity = 0;
    slides.forEach((slide, i) => {
      slide.style.transition = "none";
      if (!isMobile()) {
        slide.style.opacity = i === index ? "1" : "0";
        slide.style.zIndex = i === index ? "1" : "0";
      } else {
        slide.style.opacity = "";
        slide.style.zIndex = "";
      }
    });
    paint(0);
    syncDots();
  }

  function adoptPending() {
    if (pending === index) return;
    const steps = shortestSteps(index, pending);
    shift += steps * widthOf();
    index = pending;
    paint(shift);
  }

  function committedSteps(vel = 0) {
    const w = widthOf();
    if (Math.abs(shift) > w * COMMIT_RATIO) return shift < 0 ? 1 : -1;
    if (Math.abs(vel) > FLICK_VEL) return vel < 0 ? 1 : -1;
    return 0;
  }

  function settleShift(dest, vel, nextIndex) {
    pending = wrap(nextIndex);
    syncDots(nextIndex);
    springTo(dest, vel, () => finishIndex(nextIndex));
  }

  function goTo(next, vel = 0) {
    if (!open) return;
    const target = wrap(next);
    pending = target;
    if (!isMobile()) {
      finishIndex(target);
      return;
    }
    const steps = shortestSteps(index, target);
    if (!steps && Math.abs(shift) < 0.5) {
      finishIndex(target);
      return;
    }
    settleShift(-steps * widthOf(), vel, target);
  }

  const go = (step) => goTo(pending + step);

  function suppressClick() {
    ignoreClickUntil = performance.now() + 450;
  }

  function buildSlides(item) {
    track.replaceChildren();
    slides = items.map((src, i) => {
      const slide = document.createElement("div");
      slide.className = "viewer__slide";
      const image = document.createElement("img");
      image.alt = i === 0 ? altFor(item) : "";
      image.draggable = false;
      image.decoding = "async";
      image.src = src;
      slide.append(image);
      track.append(slide);
      return slide;
    });
  }

  function buildDots() {
    pager.replaceChildren();
    dots = items.map((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "viewer__dot";
      dot.setAttribute("data-viewer-dot", "");
      dot.setAttribute("aria-label", `${i + 1} / ${items.length}`);
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        goTo(i);
      });
      pager.append(dot);
      return dot;
    });
  }

  function setOpen(next) {
    open = next;
    document.documentElement.classList.toggle("is-viewer-open", next);
    root.hidden = !next;
    root.setAttribute("aria-hidden", next ? "false" : "true");
    if (next) root.removeAttribute("inert");
    else root.setAttribute("inert", "");
  }

  function close() {
    if (!open) return;
    cancelSpring();
    swipe = null;
    setOpen(false);
    root.classList.remove("is-dragging");
    root.querySelectorAll(".viewer__hit.is-aiming").forEach((hit) => hit.classList.remove("is-aiming"));
    const target = returnFocus;
    returnFocus = null;
    requestAnimationFrame(() => target?.focus?.({ preventScroll: true }));
  }

  function openWork(item, { index: start = 0, returnFocus: shot = null } = {}) {
    items = imageFiles(item).map((file) => workFileUrl(file));
    if (!items.length) return;
    returnFocus = shot;
    buildSlides(item);
    buildDots();
    caption.replaceChildren(...workMetaNodes(item));
    root.classList.toggle("is-single", items.length === 1);
    root.classList.toggle("is-many", items.length > MANY_SLIDES);
    root.classList.toggle("is-mobile", isMobile());
    cancelSpring();
    shift = 0;
    velocity = 0;
    setOpen(true);
    finishIndex(Math.min(items.length - 1, Math.max(0, Number(start) || 0)));
    root.querySelector("[data-viewer-close]")?.focus({ preventScroll: true });
  }

  /* chrome */
  root.querySelector("[data-viewer-close]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  const bindHit = (sel, step) => {
    root.querySelector(sel)?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < ignoreClickUntil) return;
      go(step);
    });
  };
  bindHit("[data-viewer-prev]", -1);
  bindHit("[data-viewer-next]", 1);

  const aimHit = (hit, event) => {
    if (!FINE.matches || isMobile()) return;
    const arrow = hit.querySelector(".viewer__arrow");
    if (!arrow) return;
    arrow.style.left = `${event.clientX}px`;
    arrow.style.top = `${event.clientY}px`;
    hit.classList.add("is-aiming");
  };
  root.querySelectorAll(navSel).forEach((hit) => {
    hit.addEventListener("pointerenter", (event) => aimHit(hit, event));
    hit.addEventListener("pointermove", (event) => aimHit(hit, event));
    hit.addEventListener("pointerleave", () => hit.classList.remove("is-aiming"));
  });

  /* Middle third: a click on the picture closes (single) or does nothing (deck). */
  root.querySelector("[data-viewer-mid]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (performance.now() < ignoreClickUntil) return;
    if (items.length === 1) close();
  });

  root.addEventListener("dragstart", (event) => event.preventDefault());

  /* mobile swipe */
  root.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.(chrome)) return;
      if (!isMobile()) return;
      if (event.pointerType === "mouse" && !COARSE.matches) return;
      cancelSpring();
      adoptPending();
      samples = [{ x: shift, t: event.timeStamp || performance.now() }];
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: shift, axis: null };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!open || !swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (!swipe.axis) {
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < TAP_PX) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.05) {
          swipe.axis = "x";
          suppressClick();
          root.classList.add("is-dragging");
        } else {
          swipe.axis = "y";
        }
      }
      if (swipe.axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      shift = swipe.origin + dx;
      velocity = 0;
      samples.push({ x: shift, t: event.timeStamp || performance.now() });
      if (samples.length > 5) samples.shift();
      if (samples.length >= 2) velocity = sampleVel(samples);
      paint(shift);
      syncDots(index + committedSteps(0));
    },
    { passive: false },
  );

  const endPointer = (event, cancelled) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const axis = swipe.axis;
    swipe = null;
    root.classList.remove("is-dragging");
    if (axis !== "x") {
      if (Math.abs(shift) > 0.5) settleShift(0, 0, index);
      return;
    }
    suppressClick();
    if (cancelled) {
      settleShift(0, 0, index);
      return;
    }
    const vel = sampleVel(samples) || velocity;
    const steps = committedSteps(vel);
    settleShift(-steps * widthOf(), vel, index + steps);
  };
  window.addEventListener("pointerup", (event) => endPointer(event, false));
  window.addEventListener("pointercancel", (event) => endPointer(event, true));

  root.addEventListener(
    "touchmove",
    (event) => {
      if (open && swipe?.axis === "x" && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  root.addEventListener("wheel", (event) => open && event.preventDefault(), { passive: false });

  window.addEventListener(
    "keydown",
    (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    },
    true,
  );

  new ResizeObserver(() => {
    if (!open || !slides.length) return;
    root.classList.toggle("is-mobile", isMobile());
    finishIndex(pending);
  }).observe(root);

  return {
    open: openWork,
    close,
    get isOpen() {
      return open;
    },
  };
}
