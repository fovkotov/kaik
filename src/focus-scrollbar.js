const INSET = 4;
const MIN_THUMB = 28;
const OVERFLOW_PX = 1;
const RAIL_W = 14;
const SEAM_OVERLAP = 2;
const DESKTOP_MQ = "(min-width: 901px)";
const WORK_SHEETS = new Set(["yan", "polina", "alena"]);
const HINT_PEEK_MS = 220;
const HINT_HOLD_MS = 70;
const HINT_BACK_MS = 260;
const HINT_EASE_OUT = [0.23, 1, 0.32, 1];
const HINT_EASE_INOUT = [0.77, 0, 0.175, 1];

function unitBezier(p1x, p1y, p2x, p2y, t) {
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const inv = 1 - u;
    const x = 3 * inv * inv * u * p1x + 3 * inv * u * u * p2x + u * u * u;
    const dx = 3 * inv * inv * p1x + 6 * inv * u * (p2x - p1x) + 3 * u * u * (1 - p2x);
    if (Math.abs(dx) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - (x - t) / dx));
  }
  const inv = 1 - u;
  return 3 * inv * inv * u * p1y + 3 * inv * u * u * p2y + u * u * u;
}

/** @type {WeakMap<HTMLElement, { dispose: () => void, sync: () => void, track: HTMLElement }>} */
const attached = new WeakMap();

function isDesktopRail() {
  return (
    window.matchMedia(DESKTOP_MQ).matches &&
    !document.documentElement.classList.contains("is-mobile")
  );
}

function visualScale(card) {
  const deck = card.closest(".deck");
  if (deck) {
    const t = getComputedStyle(deck).transform;
    if (t && t !== "none") {
      try {
        const mx = new DOMMatrixReadOnly(t);
        const s = Math.hypot(mx.a, mx.b);
        if (s > 0.01) return s;
      } catch {
        /* fall through */
      }
    }
  }
  const n = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--deck-scale"),
  );
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function placeInnerHost(card, track) {
  if (isDesktopRail()) {
    if (track.parentElement !== document.body) document.body.appendChild(track);
    return;
  }
  if (track.parentElement !== card) card.prepend(track);
  track.style.top = "";
  track.style.left = "";
  track.style.width = "";
  track.style.height = "";
  track.style.removeProperty("--focus-rail");
}

function paintInner(card, track, thumb, m) {
  const thumbTop = thumbOffset(m);
  track.style.removeProperty("--focus-rail");
  thumb.style.width = "";
  thumb.style.height = `${m.thumbH}px`;
  thumb.style.transform = `translateY(${thumbTop}px)`;
  return thumbTop;
}

/**
 * Desktop split capsule in viewport px, from the card box — never from a
 * clipped inner thumb. Both halves share this geometry in the same paint.
 */
function splitGeometry(card, m) {
  const box = card.getBoundingClientRect();
  const view = Math.max(m.view, 1);
  const scale = box.height > 0 ? box.height / view : visualScale(card);
  const inset = INSET * scale;
  const thumbH = Math.min(
    Math.max(MIN_THUMB * scale, m.thumbH * scale),
    Math.max(0, box.height - inset * 2),
  );
  const maxThumb = Math.max(0, box.height - inset * 2 - thumbH);
  const ratio = m.maxScroll > 0 ? Math.min(1, Math.max(0, m.top / m.maxScroll)) : 0;
  return { box, thumbH, y: inset + ratio * maxThumb };
}

function paintSplit(card, track, thumb, out, outThumb, m) {
  const { box, thumbH, y } = splitGeometry(card, m);
  const innerW = RAIL_W;
  const outerW = RAIL_W + SEAM_OVERLAP;
  const railH = Math.max(0, box.height);
  const innerLeft = box.right - innerW;
  const outerLeft = box.right - SEAM_OVERLAP;

  track.style.top = `${box.top}px`;
  track.style.left = `${innerLeft}px`;
  track.style.width = `${innerW}px`;
  track.style.height = `${railH}px`;
  track.style.setProperty("--focus-view", `${railH}px`);
  track.style.setProperty("--focus-rail", `${innerW}px`);
  thumb.style.width = `${innerW}px`;
  thumb.style.height = `${thumbH}px`;
  thumb.style.transform = `translateY(${y}px)`;

  if (!out || !outThumb) return;
  out.style.top = `${box.top}px`;
  out.style.left = `${outerLeft}px`;
  out.style.width = `${outerW}px`;
  out.style.height = `${railH}px`;
  out.style.setProperty("--focus-view", `${railH}px`);
  outThumb.style.width = `${outerW}px`;
  outThumb.style.height = `${thumbH}px`;
  outThumb.style.transform = `translateY(${y}px)`;
}

function paintLocked(card, track, thumb, out, outThumb, m) {
  placeInnerHost(card, track);
  if (isDesktopRail() && out && outThumb && !out.hidden) {
    paintSplit(card, track, thumb, out, outThumb, m);
    return { ...m, thumbTop: thumbOffset(m) };
  }
  const thumbTop = paintInner(card, track, thumb, m);
  return { ...m, thumbTop };
}

function makeTrack(kind) {
  const track = document.createElement("div");
  track.setAttribute(kind === "out" ? "data-focus-scroll-out" : "data-focus-scroll", "");
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.setAttribute("data-focus-scroll-thumb", "");
  if (kind === "out") thumb.setAttribute("data-focus-scroll-thumb-out", "");
  track.appendChild(thumb);
  return { track, thumb };
}

/** Pink overlay bar on history, program, student works, and yan/polina/alena work sheets. */
export function allowsFocusScrollbar(card) {
  if (!(card instanceof HTMLElement)) return false;
  if (card.hasAttribute("data-program-card")) return true;
  if (card.hasAttribute("data-works-card") || card.querySelector("article.works-card, .works-card")) {
    return true;
  }
  if (card.hasAttribute("data-history-card") || card.querySelector(".history-card")) return true;
  const who = (card.getAttribute("data-work-student") || "").toLowerCase();
  if (
    (card.hasAttribute("data-work-card") || card.classList.contains("is-work-open")) &&
    WORK_SHEETS.has(who)
  ) {
    return true;
  }
  return false;
}

/** Inner face scrolls when expand-host must not itself be the scroller (dog/key are in-flow inside). */
export function focusScrollRoot(card) {
  if (!(card instanceof HTMLElement)) return card;
  if (card.hasAttribute("data-works-card")) {
    return card.querySelector(".works-card") || card;
  }
  if (card.hasAttribute("data-expand-host") && card.hasAttribute("data-program-card")) {
    return card.querySelector(".program-card") || card;
  }
  return card;
}

function metrics(card) {
  const root = focusScrollRoot(card);
  const view = card.clientHeight;
  const port = root === card ? view : root.clientHeight;
  const maxScroll = Math.max(0, root.scrollHeight - port);
  const full = port + maxScroll;
  const rail = Math.max(0, view - INSET * 2);
  const thumbH = Math.min(rail, Math.max(MIN_THUMB, (port / Math.max(full, 1)) * rail));
  return {
    view,
    full,
    top: root.scrollTop,
    thumbH,
    maxThumb: Math.max(0, rail - thumbH),
    maxScroll,
  };
}

function thumbOffset(m) {
  const ratio = m.maxScroll > 0 ? Math.min(1, Math.max(0, m.top / m.maxScroll)) : 0;
  return INSET + ratio * m.maxThumb;
}

function layout(card, track, thumb, out, outThumb) {
  const m = metrics(card);
  const open = card.classList.contains("is-program-open");
  const scrolling = card.classList.contains("is-program-scroll");
  const overflows = m.maxScroll > OVERFLOW_PX;
  // During the fly, overflow-y is still hidden — still paint the rail.
  const show = open && (!scrolling || overflows);
  const showOut = show && isDesktopRail();

  track.hidden = !show;
  if (out) out.hidden = !showOut;
  if (!show) return { ...m, thumbTop: thumbOffset(m) };

  track.style.setProperty("--focus-view", `${m.view}px`);
  return paintLocked(card, track, thumb, out, outThumb, m);
}

/**
 * Always-visible overlay scrollbar on a focused card scrollport.
 * Native overlay bars stay hidden until the user scrolls; this does not.
 */
export function mountFocusScrollbar(card) {
  if (!(card instanceof HTMLElement) || !allowsFocusScrollbar(card)) return;
  const existing = attached.get(card);
  if (existing) {
    existing.track.classList.add("is-on");
    existing.out?.classList.add("is-on");
    existing.sync();
    return;
  }

  const { track, thumb } = makeTrack("in");
  const { track: out, thumb: outThumb } = makeTrack("out");
  card.prepend(track);
  document.body.appendChild(out);

  let drag = null;
  let raf = 0;
  let follow = 0;
  let followStable = 0;
  let wheelTimer = 0;
  let last = { thumbTop: INSET, thumbH: MIN_THUMB };
  let lastRectKey = "";

  const thumbs = () => [thumb, outThumb];

  const sync = () => {
    followStable = 0;
    last = layout(card, track, thumb, out, outThumb) || last;
    if (!out.hidden && !follow) follow = requestAnimationFrame(followOuter);
  };

  const followOuter = () => {
    follow = 0;
    if (!attached.has(card) || out.hidden) return;
    const m = metrics(card);
    const rect = card.getBoundingClientRect();
    const key = `${rect.left|0},${rect.top|0},${rect.width|0},${rect.height|0},${m.thumbH},${m.scroll}`;
    last = paintLocked(card, track, thumb, out, outThumb, m);
    if (key === lastRectKey) {
      followStable += 1;
      // Stop perpetual paint once the card + thumb settle (was a permanent rAF loop).
      if (followStable > 6) return;
    } else {
      followStable = 0;
      lastRectKey = key;
    }
    follow = requestAnimationFrame(followOuter);
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      sync();
    });
  };

  const endWheel = () => {
    wheelTimer = 0;
    card.classList.remove("is-wheel-scrolling");
    track.classList.remove("is-wheel-scrolling");
    out.classList.remove("is-wheel-scrolling");
  };

  const onScroll = () => {
    if (drag) return;
    if (!card.classList.contains("is-wheel-scrolling")) {
      card.classList.add("is-wheel-scrolling");
      track.classList.add("is-wheel-scrolling");
      out.classList.add("is-wheel-scrolling");
    }
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(endWheel, 140);
    // Same frame as the scroll, not rAF — rAF left the thumb one tick behind.
    followStable = 0;
    last = paintLocked(card, track, thumb, out, outThumb, metrics(card));
    if (!out.hidden && !follow) follow = requestAnimationFrame(followOuter);
  };

  const onScrollEnd = () => {
    window.clearTimeout(wheelTimer);
    endWheel();
  };

  const scrollFromClientY = (clientY, grabOffset) => {
    const root = focusScrollRoot(card);
    const m = metrics(card);
    let railTop;
    let insetV;
    let thumbH;
    let maxThumb;
    if (isDesktopRail()) {
      const g = splitGeometry(card, m);
      const scale = g.box.height / Math.max(m.view, 1);
      railTop = g.box.top;
      insetV = INSET * scale;
      thumbH = g.thumbH;
      maxThumb = Math.max(0, g.box.height - insetV * 2 - thumbH);
    } else {
      const scale = visualScale(card);
      insetV = INSET * scale;
      const inner = thumb.getBoundingClientRect();
      railTop = inner.top - last.thumbTop * scale;
      thumbH = inner.height || last.thumbH * scale;
      const viewLocal = parseFloat(getComputedStyle(track).getPropertyValue("--focus-view")) || m.view;
      const railH = viewLocal * scale;
      maxThumb = Math.max(0, railH - insetV * 2 - thumbH);
    }
    const y = clientY - railTop - insetV - grabOffset;
    const ratio = maxThumb > 0 ? y / maxThumb : 0;
    root.scrollTop = Math.min(m.maxScroll, Math.max(0, ratio * m.maxScroll));
    last = paintLocked(card, track, thumb, out, outThumb, metrics(card));
  };

  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const grabOffset = event.clientY - event.currentTarget.getBoundingClientRect().top;
    drag = { pointerId: event.pointerId, grabOffset };
    event.currentTarget.setPointerCapture(event.pointerId);
    track.classList.add("is-dragging");
    out.classList.add("is-dragging");
    card.classList.remove("is-wheel-scrolling");
  };

  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    scrollFromClientY(event.clientY, drag.grabOffset);
  };

  const endDrag = (event) => {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    drag = null;
    track.classList.remove("is-dragging");
    out.classList.remove("is-dragging");
    schedule();
  };

  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const root = focusScrollRoot(card);

  const ro = new ResizeObserver(schedule);
  ro.observe(card);
  if (root !== card) ro.observe(root);
  [...card.children].forEach((child) => {
    if (child !== track) ro.observe(child);
  });

  const mo = new MutationObserver(schedule);
  mo.observe(card, { attributes: true, attributeFilter: ["class", "data-work-student"] });

  root.addEventListener("scroll", onScroll, { passive: true });
  root.addEventListener("scrollend", onScrollEnd, { passive: true });
  thumbs().forEach((el) => {
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("click", onClick);
    el.addEventListener("lostpointercapture", endDrag);
  });
  const mq = window.matchMedia(DESKTOP_MQ);
  mq.addEventListener("change", schedule);
  window.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });
  card.addEventListener("load", schedule, true);

  let hintRaf = 0;
  let hintHold = 0;
  let hinting = false;
  let stopHint = null;

  const cancelHint = () => {
    if (hintRaf) cancelAnimationFrame(hintRaf);
    if (hintHold) window.clearTimeout(hintHold);
    hintRaf = 0;
    hintHold = 0;
    hinting = false;
    if (stopHint) {
      root.removeEventListener("wheel", stopHint);
      root.removeEventListener("pointerdown", stopHint);
      root.removeEventListener("touchstart", stopHint);
      root.removeEventListener("keydown", stopHint);
      stopHint = null;
    }
  };

  const hint = () => {
    cancelHint();
    if (!isDesktopRail()) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const m = metrics(card);
    if (root.scrollTop > OVERFLOW_PX) return;
    const peek = Math.min(160, Math.round(m.maxScroll * 0.4), Math.round(m.view * 0.28));
    if (peek < 12) return;

    hinting = true;
    stopHint = () => cancelHint();
    root.addEventListener("wheel", stopHint, { passive: true });
    root.addEventListener("pointerdown", stopHint);
    root.addEventListener("touchstart", stopHint, { passive: true });
    root.addEventListener("keydown", stopHint);

    const run = (from, to, ms, ease, done) => {
      const t0 = performance.now();
      const step = (now) => {
        if (!hinting) return;
        const p = Math.min(1, (now - t0) / ms);
        root.scrollTop = from + (to - from) * ease(p);
        last = paintLocked(card, track, thumb, out, outThumb, metrics(card));
        if (p < 1) hintRaf = requestAnimationFrame(step);
        else done();
      };
      hintRaf = requestAnimationFrame(step);
    };

    const easeOut = (t) => unitBezier(...HINT_EASE_OUT, t);
    const easeInOut = (t) => unitBezier(...HINT_EASE_INOUT, t);
    run(0, peek, HINT_PEEK_MS, easeOut, () => {
      if (!hinting) return;
      hintHold = window.setTimeout(() => {
        hintHold = 0;
        run(root.scrollTop, 0, HINT_BACK_MS, easeInOut, cancelHint);
      }, HINT_HOLD_MS);
    });
  };

  const dispose = () => {
    cancelHint();
    if (raf) cancelAnimationFrame(raf);
    if (follow) cancelAnimationFrame(follow);
    raf = 0;
    follow = 0;
    drag = null;
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    card.classList.remove("is-wheel-scrolling");
    track.classList.remove("is-wheel-scrolling");
    out.classList.remove("is-wheel-scrolling");
    ro.disconnect();
    mo.disconnect();
    root.removeEventListener("scroll", onScroll);
    root.removeEventListener("scrollend", onScrollEnd);
    card.removeEventListener("load", schedule, true);
    mq.removeEventListener("change", schedule);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    thumbs().forEach((el) => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("click", onClick);
      el.removeEventListener("lostpointercapture", endDrag);
    });
    track.remove();
    out.remove();
    attached.delete(card);
  };

  attached.set(card, { dispose, sync, hint, track, out });
  sync();
  const reveal = () => {
    track.classList.add("is-on");
    out.classList.add("is-on");
    sync();
    if (!follow && !out.hidden) follow = requestAnimationFrame(followOuter);
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    reveal();
    return;
  }
  requestAnimationFrame(() => {
    reveal();
    requestAnimationFrame(sync);
  });
}

export function fadeFocusScrollbar(card, shown) {
  const rec = attached.get(card);
  if (!rec) return;
  rec.track.classList.toggle("is-on", shown);
  rec.out?.classList.toggle("is-on", shown);
  if (shown) rec.sync();
}

export function unmountFocusScrollbar(card) {
  attached.get(card)?.dispose();
}

export function syncFocusScrollbar(card) {
  attached.get(card)?.sync();
}

export function hintFocusScroll(card) {
  if (!isDesktopRail()) return;
  attached.get(card)?.hint();
}
