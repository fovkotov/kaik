import { initEmbed } from "./embed.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";

const TAB_WORKSHOPS = "lettering";
const TAB_FINAL = "final";

const hero = document.querySelector("[data-lettering-hero]");
const letteringImage = document.querySelector("[data-lettering-image]");
const action = document.querySelector("[data-lettering-action]");
const credit = document.querySelector("[data-lettering-credit]");
const reviewHero = document.querySelector("[data-review-hero]");
const reviewVideo = document.querySelector("[data-review-video]");
const reviewPlay = document.querySelector("[data-review-play]");
const panel = document.querySelector("[data-works-panel]");

const REVIEW_VIDEO_ID = "K06Djv3prto";
const grid = document.querySelector("[data-works-grid]");
const empty = document.querySelector("[data-works-empty]");
const tabs = [...document.querySelectorAll("[data-tab]")];

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let catalog = [];
let workshopWorks = [];
let activeTab = TAB_WORKSHOPS;
let activeLettering = null;
let follower = null;
let viewer = null;

/* ---------- helpers ---------- */

function isMobile() {
  return COARSE.matches || window.innerWidth <= 760;
}

function imageFiles(item) {
  return (item?.files || []).filter((file) => !/\.(?:ttf|otf|woff2?)$/i.test(file));
}

/** The hero draws vector only: the first .svg of a work, or nothing. */
function svgFile(item) {
  return (item?.files || []).find((file) => /\.svg$/i.test(file)) || null;
}

function shufflePick(items, excludeId = "") {
  if (!items.length) return null;
  const pool = items.filter((item) => item.id !== excludeId);
  const source = pool.length ? pool : items;
  return source[Math.floor(Math.random() * source.length)];
}

/** Name, @nick and stream as spans; muted parts get `.is-muted`. */
function metaNodes(item) {
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
    stream.textContent = `${item.stream} поток`;
    nodes.push(stream);
  }
  if (!nodes.length) {
    const anon = document.createElement("span");
    anon.className = "is-muted";
    anon.textContent = "автор не указан";
    nodes.push(anon);
  }
  return nodes;
}

function altFor(item) {
  const kind = item.type === TAB_FINAL ? "Финальный проект" : "Работа воркшопа";
  return item.author ? `${kind}, ${item.author}` : kind;
}

/* ---------- tabs + grid ---------- */

function setTab(next) {
  if (next !== TAB_WORKSHOPS && next !== TAB_FINAL) return;
  activeTab = next;
  tabs.forEach((tab) => {
    const on = tab.dataset.tab === next;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;
  });
  panel.setAttribute("aria-labelledby", `tab-${next}`);
  const showHero = next === TAB_WORKSHOPS;
  hero.hidden = !showHero;
  follower?.setActive(showHero);
  reviewHero.hidden = showHero;
  if (showHero) stopReview();
  renderGrid();
}

/* ---------- final review video ---------- */

function playReview() {
  if (reviewHero.classList.contains("is-playing")) return;
  const frame = document.createElement("iframe");
  frame.src = `https://www.youtube-nocookie.com/embed/${REVIEW_VIDEO_ID}?autoplay=1&rel=0&playsinline=1`;
  frame.title = "Финальный просмотр 1 потока";
  frame.allow = "autoplay; fullscreen; picture-in-picture; clipboard-write";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  reviewVideo.append(frame);
  reviewHero.classList.add("is-playing");
}

/** Leaving the tab: drop the embed so audio stops and the play plate comes back. */
function stopReview() {
  reviewVideo.querySelector("iframe")?.remove();
  reviewHero.classList.remove("is-playing");
}

function cardFor(item) {
  const cover = imageFiles(item)[0];
  const card = document.createElement("button");
  card.type = "button";
  card.className = "work-card";
  card.dataset.workId = item.id;

  const art = document.createElement("span");
  art.className = "work-card__art";
  const image = document.createElement("img");
  image.src = workFileUrl(cover);
  image.alt = altFor(item);
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  art.append(image);

  const meta = document.createElement("span");
  meta.className = "work-card__meta";
  meta.append(...metaNodes(item));

  card.append(art, meta);
  card.addEventListener("click", () => viewer?.open(item, card));
  return card;
}

function renderGrid() {
  const works = catalog.filter((item) => item.type === activeTab && imageFiles(item).length);
  const fragment = document.createDocumentFragment();
  works.forEach((item) => fragment.append(cardFor(item)));
  grid.replaceChildren(fragment);
  grid.dataset.tab = activeTab;
  empty.hidden = works.length > 0;
}

/* ---------- hero ---------- */

function setHero(item) {
  const file = svgFile(item);
  if (!file) return;
  activeLettering = item;
  letteringImage.src = workFileUrl(file);
  letteringImage.alt = altFor(item);
  credit.replaceChildren(...metaNodes(item));
}

function nextHero() {
  const next = shufflePick(workshopWorks, activeLettering?.id);
  if (next) setHero(next);
}

/**
 * The lettering is the cursor: its centre eases toward the pointer, nothing else.
 * Offsets are measured from the hero centre so the CSS centring stays intact,
 * and are clamped so the artwork never leaves the hero box.
 */
function createFollower() {
  const EASE = 0.16;
  const current = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const limit = { x: 0, y: 0 };
  let frame = 0;
  let active = true;

  /** Half the free room on each axis: how far the centre may drift from the middle. */
  function measure() {
    const box = hero.getBoundingClientRect();
    const art = letteringImage.getBoundingClientRect();
    limit.x = Math.max(0, (box.width - art.width) / 2);
    limit.y = Math.max(0, (box.height - art.height) / 2);
    target.x = Math.max(-limit.x, Math.min(limit.x, target.x));
    target.y = Math.max(-limit.y, Math.min(limit.y, target.y));
    wake();
  }

  function apply() {
    letteringImage.style.transform = `translate(calc(-50% + ${current.x.toFixed(2)}px), calc(-50% + ${current.y.toFixed(2)}px))`;
  }

  function tick() {
    frame = 0;
    if (!active) return;
    current.x += (target.x - current.x) * EASE;
    current.y += (target.y - current.y) * EASE;
    apply();
    const settled = Math.abs(target.x - current.x) < 0.1 && Math.abs(target.y - current.y) < 0.1;
    if (settled) {
      current.x = target.x;
      current.y = target.y;
      apply();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (active && !frame) frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    const rect = hero.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    target.x = Math.max(-limit.x, Math.min(limit.x, x));
    target.y = Math.max(-limit.y, Math.min(limit.y, y));
    wake();
  }

  function onPointerLeave() {
    target.x = 0;
    target.y = 0;
    wake();
  }

  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerleave", onPointerLeave, { passive: true });
  /* A new SVG has a new aspect, so the free room changes with every pick. */
  letteringImage.addEventListener("load", measure);
  window.addEventListener("resize", measure, { passive: true });
  new ResizeObserver(measure).observe(hero);
  measure();

  return {
    /** Hidden tab: stop animating; back on the tab: resume from wherever we are. */
    setActive(on) {
      active = Boolean(on);
      wake();
    },
  };
}

function setupHero() {
  if (REDUCE.matches || COARSE.matches) {
    hero.classList.add("is-static");
    return;
  }
  follower = createFollower();
}

/* ---------- fullscreen viewer (site lightbox mechanics) ---------- */

const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
const MANY_SLIDES = 12;

function createViewer(root) {
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
      if (i === 0) slide.classList.add("is-active");
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

  function openWork(item, shot = null) {
    items = imageFiles(item).map((file) => workFileUrl(file));
    if (!items.length) return;
    returnFocus = shot;
    buildSlides(item);
    buildDots();
    caption.replaceChildren(...metaNodes(item));
    root.classList.toggle("is-single", items.length === 1);
    root.classList.toggle("is-many", items.length > MANY_SLIDES);
    root.classList.toggle("is-mobile", isMobile());
    cancelSpring();
    index = 0;
    pending = 0;
    shift = 0;
    velocity = 0;
    setOpen(true);
    finishIndex(0);
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
    const steps = committedSteps(sampleVel(samples) || velocity);
    settleShift(-steps * widthOf(), sampleVel(samples) || velocity, index + steps);
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

  return { open: openWork, close };
}

/* ---------- boot ---------- */

async function boot() {
  initEmbed();
  setupHero();
  viewer = createViewer(document.querySelector("[data-viewer]"));

  tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
  document.querySelector(".works-tabs")?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const i = tabs.findIndex((tab) => tab.classList.contains("is-on"));
    const next = tabs[(i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  });
  action.addEventListener("click", nextHero);
  reviewPlay.addEventListener("click", playReview);

  const data = await loadWorksCatalog({ bust: true });
  catalog = data.items || [];
  workshopWorks = catalog.filter((item) => item.type === TAB_WORKSHOPS && svgFile(item));
  setTab(TAB_WORKSHOPS);
  const first = shufflePick(workshopWorks);
  if (first) setHero(first);
}

boot();
