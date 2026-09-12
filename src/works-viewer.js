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
/*
 * Pager = Swiper "dynamic bullets" as on portorocha.com (dynamicMainBullets: 3):
 * a window of MAIN full-size dots (the active one is the bright one), one
 * .75 and one .5 dot on either side, everything else clipped. The main
 * window is centred in a DOTS_VISIBLE-slot viewport and the strip slides
 * under it, so the active dot never drifts to the edge.
 */
const DOTS_MAIN = 3;
const DOTS_VISIBLE = DOTS_MAIN + 4;
const DOT_SLOT = 16;
const DOT_SCALE = [1, 0.75, 0.5, 0.33];

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
  const chrome = "[data-viewer-close], [data-viewer-dots], [data-viewer-dot], [data-viewer-caption]";
  const navSel = "[data-viewer-prev], [data-viewer-next]";

  /**
   * One flat strip of slides across every work in grid order:
   * `{ work, src, i (slide in work), n (slides in work), first (strip index of slide 0) }`.
   * Arrows walk the strip, so the last slide of a deck steps into the next work.
   */
  let entries = [];
  let slides = [];
  let dots = [];
  let dotsTrack = null;
  /** Position of the active dot inside the main window (0..DOTS_MAIN-1) and the slide it was computed for. */
  let dotAnchor = 0;
  let dotLast = -1;
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
  let shownWork = null;
  let onClose = null;

  const count = () => entries.length || 1;
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

  /** Caption, dots and counter follow the work under the active slide. */
  function showWork(entry) {
    if (!entry || entry.work === shownWork) return;
    shownWork = entry.work;
    caption.replaceChildren(...workMetaNodes(entry.work));
    root.classList.toggle("is-single", entry.n === 1);
    buildDots(entry);
  }

  /**
   * Swiper dynamic-bullets layout. The active dot sits at `dotAnchor` inside
   * a DOTS_MAIN-wide window; stepping forward pushes it to the right edge of
   * the window, stepping back to the left, and only then does the window
   * (and the strip under it) move. Dots outside the window shrink by distance.
   */
  function layoutDots(active) {
    const n = dots.length;
    if (!n || !dotsTrack) return;
    const main = Math.min(n, DOTS_MAIN);
    if (dotLast < 0) dotAnchor = Math.min(active, main - 1);
    else dotAnchor = Math.max(0, Math.min(main - 1, dotAnchor + (active - dotLast)));
    dotLast = active;
    const start = Math.max(0, Math.min(n - main, active - dotAnchor));
    const end = start + main - 1;
    dots.forEach((dot, i) => {
      const dist = i < start ? start - i : i > end ? i - end : 0;
      dot.style.setProperty("--dot-scale", String(DOT_SCALE[Math.min(dist, DOT_SCALE.length - 1)]));
      const on = i === active;
      dot.classList.toggle("is-active", on);
      dot.setAttribute("aria-current", on ? "true" : "false");
    });
    const visible = Math.min(n, DOTS_VISIBLE);
    const x = n > DOTS_VISIBLE ? ((visible - 1) / 2 - (start + end) / 2) * DOT_SLOT : 0;
    dotsTrack.style.setProperty("--dots-x", `${x}px`);
  }

  function syncDots(active = index) {
    const current = wrap(active);
    const entry = entries[current];
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
    showWork(entry);
    if (entry) layoutDots(entry.i);
    if (counter && entry) counter.textContent = `${entry.i + 1} / ${entry.n}`;
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
    preload(index + 1);
    preload(index - 1);
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

  function buildStrip(sequence) {
    entries = [];
    sequence.forEach((work) => {
      const files = imageFiles(work);
      const first = entries.length;
      files.forEach((file, i) => {
        entries.push({ work, src: workFileUrl(file), i, n: files.length, first });
      });
    });
  }

  function buildSlides() {
    track.replaceChildren();
    slides = entries.map((entry) => {
      const slide = document.createElement("div");
      slide.className = "viewer__slide";
      const image = document.createElement("img");
      image.alt = entry.i === 0 ? altFor(entry.work) : "";
      image.draggable = false;
      image.decoding = "async";
      image.loading = "lazy";
      image.src = entry.src;
      slide.append(image);
      track.append(slide);
      return slide;
    });
  }

  /** Dots belong to the current work only; a dot jumps within that work. */
  function buildDots(entry) {
    dotsTrack = document.createElement("div");
    dotsTrack.className = "viewer__dots-track";
    pager.replaceChildren(dotsTrack);
    pager.style.setProperty("--dots-visible", String(Math.min(entry.n, DOTS_VISIBLE)));
    dotAnchor = 0;
    dotLast = -1;
    dots = Array.from({ length: entry.n }, (_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "viewer__dot";
      dot.setAttribute("data-viewer-dot", "");
      dot.setAttribute("aria-label", `${i + 1} / ${entry.n}`);
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        goTo(entry.first + i);
      });
      dotsTrack.append(dot);
      return dot;
    });
  }

  /** Eager-load the neighbours so stepping across works does not flash. */
  function preload(i) {
    const img = slides[wrap(i)]?.querySelector("img");
    if (img) img.loading = "eager";
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
    const work = shownWork;
    const done = onClose;
    returnFocus = null;
    onClose = null;
    requestAnimationFrame(() => {
      target?.focus?.({ preventScroll: true });
      done?.(work);
    });
  }

  /**
   * Open `item` at slide `index`. `sequence` is the list of works in grid
   * order — the viewer walks through all of them; without it, only `item`.
   * `onClose(work)` gets the work that was on screen when the viewer closed.
   */
  function openWork(item, { index: start = 0, sequence = null, returnFocus: shot = null, onClose: done = null } = {}) {
    const list = Array.isArray(sequence) && sequence.length ? sequence : [item];
    buildStrip(list.some((work) => work.id === item.id) ? list : [item, ...list]);
    if (!entries.length) return;
    let at = entries.findIndex((entry) => entry.work.id === item.id && entry.i === (Number(start) || 0));
    if (at < 0) at = Math.max(0, entries.findIndex((entry) => entry.work.id === item.id));
    returnFocus = shot;
    onClose = typeof done === "function" ? done : null;
    shownWork = null;
    buildSlides();
    root.classList.toggle("is-mobile", isMobile());
    cancelSpring();
    shift = 0;
    velocity = 0;
    setOpen(true);
    finishIndex(at);
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

  /* Middle third: the picture itself is inert — close with × or Esc. */
  root.querySelector("[data-viewer-mid]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
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
