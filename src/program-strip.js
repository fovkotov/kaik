const STRIP = "[data-program-strip]";
const TRACK = "[data-program-track]";
const PREV = "[data-program-strip-prev]";
const NEXT = "[data-program-strip-next]";
const AXIS_PX = 8;
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function bindStrip(root) {
  const track = root.querySelector(TRACK);
  const prev = root.querySelector(PREV);
  const next = root.querySelector(NEXT);
  if (!track) return;

  let x = 0;
  let gesture = null;
  let raf = 0;

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
    step(1);
  };

  const onNext = (event) => {
    event.preventDefault();
    event.stopPropagation();
    step(-1);
  };

  prev?.addEventListener("click", onPrev);
  next?.addEventListener("click", onNext);
  prev?.addEventListener("pointerdown", (event) => event.stopPropagation());
  next?.addEventListener("pointerdown", (event) => event.stopPropagation());

  const onPointerDown = (event) => {
    if (event.button && event.button !== 0) return;
    if (event.target.closest?.("button")) return;
    if (!overflowing()) return;
    cancelAnimationFrame(raf);
    track.style.transition = "none";
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: x,
      axis: null,
      lastX: event.clientX,
      lastT: event.timeStamp,
      vel: 0,
    };
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const onPointerMove = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
      gesture.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (gesture.axis === "x") {
        root.classList.add("is-dragging");
        event.preventDefault();
        event.stopPropagation();
      }
    }
    if (gesture.axis !== "x") return;
    event.preventDefault();
    event.stopPropagation();
    const dt = event.timeStamp - gesture.lastT;
    if (dt > 0) {
      gesture.vel = ((event.clientX - gesture.lastX) / dt) * 1000;
      gesture.lastX = event.clientX;
      gesture.lastT = event.timeStamp;
    }
    apply(gesture.origin + dx, false);
  };

  const onPointerUp = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const drifted = gesture.axis === "x";
    const vel = gesture.vel;
    gesture = null;
    root.classList.remove("is-dragging");
    try {
      root.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (!drifted) {
      apply(x, false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const coast = REDUCE.matches ? 0 : clamp(vel * 0.18, -420, 420);
    apply(x + coast, true);
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("lostpointercapture", onPointerUp);

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
