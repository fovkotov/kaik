const STRIP = "[data-program-strip]";
const TRACK = "[data-program-track]";
const PREV = "[data-program-strip-prev]";
const NEXT = "[data-program-strip-next]";
const AXIS_PX = 8;
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const COARSE = window.matchMedia("(pointer: coarse)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function isTouchPointer(event) {
  return event.pointerType === "touch" || (COARSE.matches && event.pointerType !== "mouse");
}

function bindStrip(root) {
  const track = root.querySelector(TRACK);
  const prev = root.querySelector(PREV);
  const next = root.querySelector(NEXT);
  if (!track) return;

  let x = 0;
  let swipe = null;

  const viewW = () => root.clientWidth || 1;
  const minX = () => Math.min(0, viewW() - track.scrollWidth);
  const overflowing = () => track.scrollWidth > viewW() + 1;

  const paint = () => {
    track.style.transform = `translate3d(${x}px,0,0)`;
  };

  const syncNav = () => {
    const overflow = overflowing();
    const atStart = x >= -1;
    const atEnd = x <= minX() + 1;
    root.classList.toggle("is-overflow", overflow);
    if (prev) {
      prev.hidden = !overflow;
      prev.disabled = atStart;
      prev.setAttribute("aria-disabled", atStart ? "true" : "false");
    }
    if (next) {
      next.hidden = !overflow;
      next.disabled = atEnd;
      next.setAttribute("aria-disabled", atEnd ? "true" : "false");
    }
  };

  const apply = (nextX, animate) => {
    x = clamp(nextX, minX(), 0);
    if (animate && !REDUCE.matches) {
      track.style.transition = "transform 320ms cubic-bezier(0.23, 1, 0.32, 1)";
    } else {
      track.style.transition = "none";
    }
    paint();
    syncNav();
  };

  const step = (dir) => {
    apply(x + dir * viewW() * 0.72, true);
  };

  const onPrev = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overflowing() || prev?.disabled) return;
    step(1);
  };

  const onNext = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overflowing() || next?.disabled) return;
    step(-1);
  };

  prev?.addEventListener("click", onPrev);
  next?.addEventListener("click", onNext);

  const aimHit = (hit, event) => {
    if (!FINE.matches) return;
    const arrow = hit.querySelector(".author-lb__arrow");
    if (!arrow) return;
    arrow.style.left = `${event.clientX}px`;
    arrow.style.top = `${event.clientY}px`;
    hit.classList.add("is-aiming");
  };

  [prev, next].forEach((hit) => {
    if (!hit) return;
    hit.addEventListener("pointerenter", (event) => aimHit(hit, event));
    hit.addEventListener("pointermove", (event) => aimHit(hit, event));
    hit.addEventListener("pointerleave", () => hit.classList.remove("is-aiming"));
    hit.addEventListener("pointerdown", (event) => event.stopPropagation());
  });

  const onPointerDown = (event) => {
    if (!isTouchPointer(event)) return;
    if (event.button && event.button !== 0) return;
    if (event.target.closest?.("button")) return;
    if (!overflowing()) return;
    track.style.transition = "none";
    swipe = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: x,
      axis: null,
      lastX: event.clientX,
      lastT: event.timeStamp,
      vel: 0,
    };
  };

  const onPointerMove = (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (!swipe.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
      swipe.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (swipe.axis !== "x") return;
      root.classList.add("is-swiping");
    }
    if (swipe.axis !== "x") return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const dt = event.timeStamp - swipe.lastT;
    if (dt > 0) {
      swipe.vel = ((event.clientX - swipe.lastX) / dt) * 1000;
      swipe.lastX = event.clientX;
      swipe.lastT = event.timeStamp;
    }
    apply(swipe.origin + dx, false);
  };

  const onPointerUp = (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const drifted = swipe.axis === "x";
    const vel = swipe.vel;
    swipe = null;
    root.classList.remove("is-swiping");
    if (!drifted) {
      apply(x, false);
      return;
    }
    const coast = REDUCE.matches ? 0 : clamp(vel * 0.18, -420, 420);
    apply(x + coast, true);
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove, { passive: false });
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);

  const refresh = () => {
    apply(x, false);
  };

  const ro = new ResizeObserver(refresh);
  ro.observe(root);
  ro.observe(track);
  track.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", refresh, { once: true });
  });

  refresh();
  root.classList.toggle("is-fine", FINE.matches);
  FINE.addEventListener?.("change", () => {
    root.classList.toggle("is-fine", FINE.matches);
  });
}

export function initProgramStrips(scope = document) {
  scope.querySelectorAll(STRIP).forEach(bindStrip);
}
