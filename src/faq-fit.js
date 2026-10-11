const DESKTOP_MQ = "(min-width: 901px)";

/** @type {WeakMap<HTMLElement, { ro: ResizeObserver, raf: number, stable: number, ticks: number, ownWrite: boolean }>} */
const watched = new WeakMap();

function trackedOpen(card) {
  return card.classList.contains("is-program-open") || card.classList.contains("is-list-open");
}

function desktop() {
  return (
    window.matchMedia(DESKTOP_MQ).matches &&
    !document.documentElement.classList.contains("is-mobile")
  );
}

export function isFaqCard(card) {
  return Boolean(card?.querySelector?.(":scope > .faq-card"));
}

/**
 * Uniform scale so the open FAQ poster (same absolute title, illustration,
 * and list as the closed card) sits inside the focus frame. Transform does
 * not reflow the internals. A face that already fits stays at scale 1.
 */
export function fitFaqCard(card) {
  if (!(card instanceof HTMLElement) || !isFaqCard(card)) return;
  if (!desktop() || !card.classList.contains("is-program-open")) {
    card.style.removeProperty("--faq-fit");
    return;
  }
  const face = card.querySelector(":scope > .faq-card");
  const avail = card.clientHeight;
  const need = face?.offsetHeight || 0;
  if (!(avail > 0) || !(need > 0)) return;
  const fit = need > avail + 0.5 ? Math.max(0.05, (avail - 1) / need) : 1;
  const next = fit.toFixed(4);
  if (card.style.getPropertyValue("--faq-fit") !== next) {
    card.style.setProperty("--faq-fit", next);
  }
}

function pump(card) {
  const rec = watched.get(card);
  if (!rec) return;
  rec.raf = 0;
  if (!desktop() || !trackedOpen(card)) {
    rec.ownWrite = false;
    return;
  }
  const before = card.style.getPropertyValue("--faq-fit");
  rec.ownWrite = true;
  fitFaqCard(card);
  const after = card.style.getPropertyValue("--faq-fit");
  if (before === after) rec.stable += 1;
  else {
    rec.stable = 0;
    rec.ticks += 1;
  }
  // Stop once the scale settles. A hard cap covers a resize loop that never
  // settles; the trailing frame re-opens the observer for a real size change.
  if (rec.stable < 10 && rec.ticks < 120) {
    rec.raf = requestAnimationFrame(() => pump(card));
    return;
  }
  rec.raf = requestAnimationFrame(() => {
    const live = watched.get(card);
    if (!live) return;
    live.ownWrite = false;
    live.raf = 0;
  });
}

/** Track the open FAQ card while it flies and after the frame resizes. */
export function watchFaqFit(card) {
  if (!(card instanceof HTMLElement) || !isFaqCard(card) || !desktop()) return;
  unwatchFaqFit(card);
  const ro = new ResizeObserver(() => {
    const rec = watched.get(card);
    if (!rec || rec.ownWrite || !desktop() || !trackedOpen(card)) return;
    rec.stable = 0;
    rec.ticks = 0;
    if (!rec.raf) rec.raf = requestAnimationFrame(() => pump(card));
  });
  ro.observe(card);
  const face = card.querySelector(":scope > .faq-card");
  if (face) ro.observe(face);
  watched.set(card, { ro, raf: 0, stable: 0, ticks: 0, ownWrite: false });
  fitFaqCard(card);
  const rec = watched.get(card);
  if (rec) rec.raf = requestAnimationFrame(() => pump(card));
}

export function unwatchFaqFit(card) {
  if (!(card instanceof HTMLElement)) return;
  const rec = watched.get(card);
  if (rec) {
    rec.ro.disconnect();
    if (rec.raf) cancelAnimationFrame(rec.raf);
    watched.delete(card);
  }
  card.style.removeProperty("--faq-fit");
}
