const INSET = 4;
const MIN_THUMB = 28;
const OVERFLOW_PX = 1;
const WORK_SHEETS = new Set(["yan", "polina", "alena"]);

/** @type {WeakMap<HTMLElement, { dispose: () => void, sync: () => void, track: HTMLElement }>} */
const attached = new WeakMap();

/** Pink overlay bar only on history, program, and yan/polina/alena work sheets. */
export function allowsFocusScrollbar(card) {
  if (!(card instanceof HTMLElement)) return false;
  if (card.hasAttribute("data-program-card")) return true;
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

function metrics(card) {
  const view = card.clientHeight;
  const full = card.scrollHeight;
  const rail = Math.max(0, view - INSET * 2);
  const thumbH = Math.min(rail, Math.max(MIN_THUMB, (view / Math.max(full, 1)) * rail));
  return {
    view,
    full,
    top: card.scrollTop,
    thumbH,
    maxThumb: Math.max(0, rail - thumbH),
    maxScroll: Math.max(0, full - view),
  };
}

function layout(card, track, thumb) {
  const m = metrics(card);
  const open = card.classList.contains("is-program-open");
  const scrolling = card.classList.contains("is-program-scroll");
  const overflows = m.full - m.view > OVERFLOW_PX;
  // During the fly, overflow-y is still hidden — still paint the rail.
  const show = open && (!scrolling || overflows);

  const thumbTop = INSET + (m.maxScroll > 0 ? (m.top / m.maxScroll) * m.maxThumb : 0);
  track.hidden = !show;
  if (!show) return { ...m, thumbTop };

  track.style.top = `${m.top}px`;
  track.style.height = `${m.view}px`;

  thumb.style.height = `${m.thumbH}px`;
  thumb.style.transform = `translateY(${thumbTop}px)`;
  return { ...m, thumbTop };
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
    existing.sync();
    return;
  }

  const track = document.createElement("div");
  track.setAttribute("data-focus-scroll", "");
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.setAttribute("data-focus-scroll-thumb", "");
  track.appendChild(thumb);
  card.appendChild(track);

  let drag = null;
  let raf = 0;
  let wheelTimer = 0;
  let last = { thumbTop: INSET, thumbH: MIN_THUMB };

  const sync = () => {
    last = layout(card, track, thumb) || last;
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
  };

  const onScroll = () => {
    if (drag) return;
    if (!card.classList.contains("is-wheel-scrolling")) {
      card.classList.add("is-wheel-scrolling");
    }
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(endWheel, 140);
    schedule();
  };

  const onScrollEnd = () => {
    window.clearTimeout(wheelTimer);
    endWheel();
  };

  const scrollFromClientY = (clientY, grabOffset) => {
    const m = metrics(card);
    const rect = track.getBoundingClientRect();
    const y = clientY - rect.top - INSET - grabOffset;
    const ratio = m.maxThumb > 0 ? y / m.maxThumb : 0;
    card.scrollTop = Math.min(m.maxScroll, Math.max(0, ratio * m.maxScroll));
    schedule();
  };

  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = track.getBoundingClientRect();
    const grabOffset = event.clientY - (rect.top + last.thumbTop);
    drag = { pointerId: event.pointerId, grabOffset };
    thumb.setPointerCapture(event.pointerId);
    track.classList.add("is-dragging");
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
    schedule();
  };

  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const ro = new ResizeObserver(schedule);
  ro.observe(card);
  [...card.children].forEach((child) => {
    if (child !== track) ro.observe(child);
  });

  const mo = new MutationObserver(schedule);
  mo.observe(card, { attributes: true, attributeFilter: ["class", "data-work-student"] });

  card.addEventListener("scroll", onScroll, { passive: true });
  card.addEventListener("scrollend", onScrollEnd, { passive: true });
  thumb.addEventListener("pointerdown", onPointerDown);
  thumb.addEventListener("pointermove", onPointerMove);
  thumb.addEventListener("pointerup", endDrag);
  thumb.addEventListener("pointercancel", endDrag);
  thumb.addEventListener("click", onClick);
  thumb.addEventListener("lostpointercapture", endDrag);
  window.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });
  card.addEventListener("load", schedule, true);

  const dispose = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    drag = null;
    window.clearTimeout(wheelTimer);
    wheelTimer = 0;
    card.classList.remove("is-wheel-scrolling");
    ro.disconnect();
    mo.disconnect();
    card.removeEventListener("scroll", onScroll);
    card.removeEventListener("scrollend", onScrollEnd);
    card.removeEventListener("load", schedule, true);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    track.remove();
    attached.delete(card);
  };

  attached.set(card, { dispose, sync, track });
  sync();
  const reveal = () => {
    track.classList.add("is-on");
    sync();
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
  if (shown) rec.sync();
}

export function unmountFocusScrollbar(card) {
  attached.get(card)?.dispose();
}

export function syncFocusScrollbar(card) {
  attached.get(card)?.sync();
}
