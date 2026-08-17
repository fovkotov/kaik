import { getScrollRoot, getViewportSize, safeSessionStorage } from "../embed.js";
import { publicUrl } from "../public-url.js";
import { isMobile } from "../tweaks.js";
import {
  allLetters,
  clickPool,
  letterById,
  lettersForChar,
  loadCatalog,
  pickVariant,
} from "./catalog.js";
import { firstGrapheme, normalizeChar } from "./shared.js";
import { svgToInline } from "./svg.js";

const LAST_KEY = "kaik-dropcap-last";
const CYCLE_MS = 3200;
const SPIN_OUT_DEG = 450;
const SPIN_IN_FROM_DEG = -90;
const EASE_IN = "cubic-bezier(0.55, 0.055, 0.675, 0.19)";
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
/** One card of deck progress = a third of a turn (3× slower than a full spin). */
const DEG_PER_CARD = 120;
/** Swap lettering when the reel crosses edge-on (half-turn of 180°). */
const SWAP_PERIOD_DEG = 180;
const SCRUB_LERP = 0.25;
const SCRUB_SETTLE_MS = 320;
const svgCache = new Map();
const session = safeSessionStorage();
const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Fine pointer only — iOS sticky :hover / synthetic mouseenter must not pause idle. */
const canHoverPause = () =>
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

function spinTokens(button) {
  const css = getComputedStyle(button);
  const ms = (name, fallback) => {
    const n = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    outMs: ms("--dropcap-spin-out", 300),
    inMs: ms("--dropcap-spin-in", 380),
    easeIn: css.getPropertyValue("--ease-in").trim() || EASE_IN,
    easeOut: css.getPropertyValue("--ease-out").trim() || EASE_OUT,
    blur: css.getPropertyValue("--dropcap-spin-blur").trim() || "4px",
  };
}

function stopSpin(button) {
  const glyphs = button.querySelectorAll(".dropcap__glyph");
  glyphs.forEach((glyph) => {
    glyph.getAnimations().forEach((anim) => anim.cancel());
    glyph.style.transform = "";
    glyph.style.filter = "";
  });
  button.classList.remove("is-spinning");
}

function playSpin(el, fromDeg, toDeg, duration, easing, blurFrom, blurTo) {
  return el.animate(
    [
      { transform: `rotateY(${fromDeg}deg)`, filter: `blur(${blurFrom})` },
      { transform: `rotateY(${toDeg}deg)`, filter: `blur(${blurTo})` },
    ],
    { duration, easing, fill: "forwards" },
  );
}

async function waitAnim(anim) {
  try {
    await anim.finished;
  } catch {
    /* cancelled — interrupt */
  }
}

function lastMap() {
  try {
    return JSON.parse(session.getItem(LAST_KEY) || "{}");
  } catch {
    return {};
  }
}

function remember(slot, id) {
  const map = lastMap();
  map[slot] = id;
  session.setItem(LAST_KEY, JSON.stringify(map));
}

function svgStamp(entry) {
  return entry?.updatedAt || entry?.createdAt || "";
}

async function fetchSvg(entry) {
  const stamp = svgStamp(entry);
  const key = `${entry.id}:${stamp}`;
  if (svgCache.has(key)) return svgCache.get(key);
  const res = await fetch(`${publicUrl(`letters/${entry.file}`)}?t=${stamp}`);
  if (!res.ok) throw new Error("SVG missing");
  const text = await res.text();
  svgCache.set(key, text);
  return text;
}

function ensurePopover() {
  let el = document.querySelector("[data-dropcap-popover]");
  if (el) return el;

  el = document.createElement("div");
  el.className = "dropcap-popover";
  el.hidden = true;
  el.dataset.dropcapPopover = "";
  el.innerHTML = `
    <p class="dropcap-popover__author" data-pop-author></p>
    <p class="dropcap-popover__stream" data-pop-stream></p>
    <span class="dropcap-popover__arrow" aria-hidden="true"></span>
  `;
  document.body.append(el);
  return el;
}

function locale() {
  return document.documentElement.lang === "ru" ? "ru" : "en";
}

function copy() {
  return locale() === "ru"
    ? { stream: (s) => `поток ${s}` }
    : { stream: (s) => `stream ${s}` };
}

function placePopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  popover.classList.add("is-open");
  const width = popover.offsetWidth;
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    getViewportSize().width - width - 8,
  );
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + 8}px`;

  const arrow = popover.querySelector(".dropcap-popover__arrow");
  if (arrow) {
    const tip = Math.min(width - 12, Math.max(12, rect.left + rect.width / 2 - left));
    arrow.style.left = `${tip}px`;
  }
}

function hidePopover() {
  const popover = document.querySelector("[data-dropcap-popover]");
  if (!popover) return;
  popover.classList.remove("is-open");
  popover.hidden = true;
  delete popover.dataset.slot;
}

function showPopover(button, entry) {
  if (isMobile()) {
    hidePopover();
    return;
  }
  const popover = ensurePopover();
  popover.hidden = false;
  popover.querySelector("[data-pop-author]").textContent = entry.author;
  popover.querySelector("[data-pop-stream]").textContent = copy().stream(entry.stream);
  popover.dataset.slot = button.dataset.slot;
  placePopover(popover, button);
}

function ensureSwap(button) {
  let swap = button.querySelector(".dropcap__swap");
  if (swap) return swap;
  swap = document.createElement("span");
  swap.className = "dropcap__swap";
  swap.setAttribute("aria-hidden", "true");
  button.prepend(swap);
  return swap;
}

function sizeSvg(button, svg) {
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMaxYMin meet");
  const box = svg.viewBox?.baseVal;
  const hostH = button.clientHeight || 72.5;
  svg.style.height = `${hostH}px`;
  svg.style.maxWidth = "none";
  svg.style.width =
    box?.height > 0 ? `${(hostH * box.width) / box.height}px` : "auto";
}

function applyMeta(button, entry) {
  button.dataset.letterId = entry.id;
  button.dataset.char = entry.char;
  button.setAttribute(
    "aria-label",
    locale() === "ru"
      ? `Буквица ${entry.char}, ${entry.author}, поток ${entry.stream}`
      : `Drop cap ${entry.char}, ${entry.author}, stream ${entry.stream}`,
  );
}

async function makeGlyph(button, entry) {
  const raw = await fetchSvg(entry);
  const glyph = document.createElement("span");
  glyph.className = "dropcap__glyph";
  glyph.innerHTML = svgToInline(raw, entry.id);
  const svg = glyph.querySelector("svg");
  if (!svg) throw new Error("SVG empty");
  sizeSvg(button, svg);
  return glyph;
}

/** Drop in-flight idle spin so scroll-scrub can take over without clearing swap rotateY. */
function abortCycleSpin(button) {
  button._paintGen = (button._paintGen || 0) + 1;
  stopSpin(button);
  const swap = button.querySelector(".dropcap__swap");
  const glyphs = [...(swap?.querySelectorAll(".dropcap__glyph") || [])];
  glyphs.forEach((glyph, i) => {
    if (i < glyphs.length - 1) glyph.remove();
  });
}

async function paintGlyph(button, entry, { animate = false } = {}) {
  const gen = (button._paintGen = (button._paintGen || 0) + 1);
  const glyph = await makeGlyph(button, entry);
  if (button._paintGen !== gen) return;

  const swap = ensureSwap(button);
  const current = swap.querySelector(".dropcap__glyph");
  const instant = !animate || reduceMotion() || !current;

  if (instant) {
    stopSpin(button);
    swap.replaceChildren(glyph);
    applyMeta(button, entry);
    return;
  }

  stopSpin(button);
  button.classList.add("is-spinning");
  applyMeta(button, entry);

  const { outMs, inMs, easeIn, easeOut, blur } = spinTokens(button);
  const outAnim = playSpin(current, 0, SPIN_OUT_DEG, outMs, easeIn, "0px", blur);
  await waitAnim(outAnim);
  if (button._paintGen !== gen) return;

  current.remove();
  swap.append(glyph);
  const inAnim = playSpin(glyph, SPIN_IN_FROM_DEG, 0, inMs, easeOut, blur, "0px");
  await waitAnim(inAnim);
  if (button._paintGen !== gen) return;

  inAnim.cancel();
  glyph.style.transform = "";
  glyph.style.filter = "";
  button.classList.remove("is-spinning");
}

function nextInPool(pool, currentId) {
  if (pool.length < 2) return null;
  const i = pool.findIndex((item) => item.id === currentId);
  return pool[(i + 1) % pool.length];
}

function stepInPool(pool, currentId, steps) {
  if (!pool.length || !steps) return null;
  const i = pool.findIndex((item) => item.id === currentId);
  const start = i < 0 ? 0 : i;
  const n = pool.length;
  return pool[(((start + steps) % n) + n) % n];
}

function wrapSpinDeg(deg) {
  return ((((deg + 90) % SWAP_PERIOD_DEG) + SWAP_PERIOD_DEG) % SWAP_PERIOD_DEG) - 90;
}

function halfTurns(deg) {
  return Math.floor((deg + 90) / SWAP_PERIOD_DEG);
}

/** Paint the first variant whose SVG loads. Prefer `excludeId` only as a skip. */
async function paintFromPool(button, pool, excludeId, { animate = false } = {}) {
  if (!pool.length) return null;
  const remaining = pool.slice();
  let skip = excludeId;
  while (remaining.length) {
    const entry = pickVariant(remaining, skip);
    if (!entry) return null;
    try {
      await paintGlyph(button, entry, { animate });
      return entry;
    } catch {
      const idx = remaining.findIndex((item) => item.id === entry.id);
      if (idx >= 0) remaining.splice(idx, 1);
      skip = undefined;
    }
  }
  return null;
}

function startCycle(button, pool) {
  if (pool.length < 2) return { stop() {}, hold() {}, kick() {} };

  let timer = 0;
  let hovering = false;
  let busy = false;
  let paused = false;

  const stop = () => {
    window.clearTimeout(timer);
    timer = 0;
  };

  const schedule = () => {
    stop();
    if (paused || hovering || document.hidden || busy) return;
    timer = window.setTimeout(tick, CYCLE_MS);
  };

  const tick = async () => {
    if (paused || hovering || document.hidden || busy) return;
    const next = nextInPool(pool, button.dataset.letterId);
    if (!next || next.id === button.dataset.letterId) {
      schedule();
      return;
    }
    busy = true;
    try {
      await paintGlyph(button, next, { animate: true });
      if (button.dataset.letterId === next.id) remember(button.dataset.slot, next.id);
    } catch {
      /* keep current glyph */
    } finally {
      busy = false;
      if (!paused) schedule();
    }
  };

  const onVis = () => {
    if (document.hidden) stop();
    else schedule();
  };

  button.addEventListener("pointerenter", (event) => {
    if (!canHoverPause() || event.pointerType === "touch") return;
    hovering = true;
    stop();
  });

  button.addEventListener("pointerleave", (event) => {
    if (!canHoverPause() || event.pointerType === "touch") return;
    hovering = false;
    schedule();
  });

  document.addEventListener("visibilitychange", onVis);
  schedule();

  return {
    stop() {
      paused = true;
      hovering = false;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    },
    hold() {
      paused = true;
      stop();
    },
    kick() {
      paused = false;
      if (!canHoverPause()) hovering = false;
      schedule();
    },
  };
}

function visualSpinDeg(state) {
  if (state.pool.length < 2) return state.display;
  return wrapSpinDeg(state.display);
}

function applyScrubTransform(state) {
  const swap = state.button.querySelector(".dropcap__swap");
  if (!swap) return;
  swap.style.transform = `rotateY(${visualSpinDeg(state)}deg)`;
}

function createScrubber() {
  const scrubs = [];
  let scrubbing = false;
  let settleTimer = 0;
  let unwindRaf = 0;
  let scrubRaf = 0;

  const cancelUnwind = () => {
    if (!unwindRaf) return;
    cancelAnimationFrame(unwindRaf);
    unwindRaf = 0;
  };

  const stopScrubRaf = () => {
    if (!scrubRaf) return;
    cancelAnimationFrame(scrubRaf);
    scrubRaf = 0;
  };

  const rebaseVisual = (state) => {
    const visual = visualSpinDeg(state);
    state.display = visual;
    state.accum = visual;
    state.turns = halfTurns(visual);
  };

  const finishScrub = () => {
    cancelUnwind();
    stopScrubRaf();
    window.clearTimeout(settleTimer);
    settleTimer = 0;
    scrubbing = false;
    for (const state of scrubs) {
      if (state.clicking) continue;
      state.accum = 0;
      state.display = 0;
      state.turns = 0;
      state.pending = 0;
      const swap = state.button.querySelector(".dropcap__swap");
      if (swap) swap.style.transform = "";
      state.button.classList.remove("is-scrubbing");
      state.cycle.kick();
    }
  };

  const unwindToRest = () => {
    cancelUnwind();
    stopScrubRaf();
    for (const state of scrubs) {
      if (!state.clicking) rebaseVisual(state);
    }
    const step = () => {
      unwindRaf = 0;
      if (!scrubbing) return;
      let leftover = false;
      for (const state of scrubs) {
        if (state.clicking) continue;
        state.accum = 0;
        state.display += (0 - state.display) * SCRUB_LERP;
        if (Math.abs(state.display) > 0.4) leftover = true;
        else state.display = 0;
        applyScrubTransform(state);
      }
      if (leftover) {
        unwindRaf = requestAnimationFrame(step);
        return;
      }
      finishScrub();
    };
    unwindRaf = requestAnimationFrame(step);
  };

  const paintScrubGlyph = async (state, entry) => {
    const button = state.button;
    const gen = (button._paintGen = (button._paintGen || 0) + 1);
    const glyph = await makeGlyph(button, entry);
    if (button._paintGen !== gen) return;
    const swap = ensureSwap(button);
    swap.replaceChildren(glyph);
    applyMeta(button, entry);
    remember(button.dataset.slot, entry.id);
    applyScrubTransform(state);
  };

  const flushSwaps = async (state) => {
    if (state.swapping || state.pool.length < 2 || !state.pending) return;
    state.swapping = true;
    try {
      while (state.pending) {
        const steps = state.pending;
        state.pending = 0;
        const next = stepInPool(state.pool, state.button.dataset.letterId, steps);
        if (!next || next.id === state.button.dataset.letterId) break;
        await paintScrubGlyph(state, next);
      }
    } finally {
      state.swapping = false;
    }
    if (state.pending) flushSwaps(state);
  };

  const tickScrub = () => {
    scrubRaf = 0;
    if (!scrubbing) return;
    for (const state of scrubs) {
      if (state.clicking) continue;
      state.display += (state.accum - state.display) * SCRUB_LERP;
      if (state.pool.length >= 2) {
        const turns = halfTurns(state.display);
        const step = turns - state.turns;
        if (step) {
          state.turns = turns;
          state.pending += step;
          flushSwaps(state);
        }
      }
      applyScrubTransform(state);
    }
    if (scrubbing) scrubRaf = requestAnimationFrame(tickScrub);
  };

  const ingest = (delta) => {
    const amount = Number(delta) || 0;
    if (!amount) return;
    for (const state of scrubs) {
      if (state.clicking) continue;
      state.accum += amount * DEG_PER_CARD;
    }
  };

  const beginScrub = () => {
    cancelUnwind();
    window.clearTimeout(settleTimer);
    settleTimer = 0;
    if (!scrubbing) {
      scrubbing = true;
      for (const state of scrubs) {
        if (state.clicking) continue;
        state.cycle.hold();
        abortCycleSpin(state.button);
        state.button.classList.add("is-scrubbing");
        rebaseVisual(state);
      }
    }
    if (!scrubRaf) scrubRaf = requestAnimationFrame(tickScrub);
  };

  const onDeckProgress = (event) => {
    if (reduceMotion() || !scrubs.length) return;
    const { delta } = event.detail || {};
    const meaningful = Math.abs(Number(delta) || 0) > 1e-4;
    if (meaningful) {
      beginScrub();
      ingest(delta);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(unwindToRest, SCRUB_SETTLE_MS);
      return;
    }
    /* Stuck `active` / iframe jitter must not refresh settle — idle has to resume. */
    if (scrubbing && !settleTimer) {
      settleTimer = window.setTimeout(unwindToRest, SCRUB_SETTLE_MS);
    }
  };

  document.addEventListener("kaik:deck-progress", onDeckProgress);

  return {
    add(button, pool, cycle) {
      scrubs.push({
        button,
        pool,
        cycle,
        accum: 0,
        display: 0,
        turns: 0,
        pending: 0,
        swapping: false,
        clicking: false,
      });
    },
    reset(button) {
      const state = scrubs.find((item) => item.button === button);
      if (!state) return null;
      state.accum = 0;
      state.display = 0;
      state.turns = 0;
      state.pending = 0;
      const swap = state.button.querySelector(".dropcap__swap");
      if (swap) swap.style.transform = "";
      state.button.classList.remove("is-scrubbing");
      return state;
    },
    clear() {
      cancelUnwind();
      stopScrubRaf();
      window.clearTimeout(settleTimer);
      settleTimer = 0;
      scrubbing = false;
      scrubs.splice(0);
    },
  };
}

export async function initDropcaps() {
  const catalog = await loadCatalog();
  const hosts = [...document.querySelectorAll("[data-dropcap]")];
  if (!hosts.length) return;

  ensurePopover();

  let mountGen = 0;
  const cycles = [];
  const scrubber = createScrubber();
  const mount = async () => {
    const gen = ++mountGen;
    cycles.splice(0).forEach((cycle) => cycle.stop());
    scrubber.clear();
    await Promise.all(
      hosts.map(async (host, index) => {
        const isI18n = host.hasAttribute("data-i18n");
        const loc = document.documentElement.getAttribute("data-locale") || locale();
        const fromLocale =
          loc === "ru"
            ? host.getAttribute("data-dropcap-ru")
            : host.getAttribute("data-dropcap-en");
        const attr = fromLocale || host.getAttribute("data-dropcap");
        const explicit = attr && attr !== "true" ? normalizeChar(attr) : "";

        if (!explicit && (isI18n || !host.hasAttribute("data-dropcap-source"))) {
          const live = host.textContent;
          if (live) host.setAttribute("data-dropcap-source", live);
        }

        const source = host.getAttribute("data-dropcap-source") || host.textContent || "";
        const first = firstGrapheme(source);
        const char = explicit || normalizeChar(first);
        const matched = char ? lettersForChar(catalog, char) : [];
        const pool = matched.length ? matched : allLetters(catalog);
        if (!pool.length) {
          if (source) host.textContent = source;
          return;
        }

        const slot = host.id || `dropcap-${index}`;
        const painted = host.querySelector(".dropcap");
        const paintedChar = painted?.dataset.char;
        const last =
          paintedChar && (!char || paintedChar === char)
            ? painted?.dataset.letterId || lastMap()[slot]
            : undefined;

        const rest =
          char && (!explicit || normalizeChar(first) === char)
            ? source.slice(first.length)
            : source;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dropcap";
        button.dataset.slot = slot;

        if (gen !== mountGen) return;
        host.replaceChildren(button, document.createTextNode(rest));
        const entry = await paintFromPool(button, pool, last);
        if (gen !== mountGen) return;
        if (!entry) {
          host.textContent = source;
          return;
        }
        remember(slot, entry.id);

        const cyclePool = clickPool(catalog, char);
        const cycle = startCycle(button, cyclePool);
        cycles.push(cycle);
        scrubber.add(button, cyclePool, cycle);

        const currentEntry = () => letterById(catalog, button.dataset.letterId);

        button.addEventListener("pointerenter", (event) => {
          if (!canHoverPause() || event.pointerType === "touch") return;
          const current = currentEntry();
          if (current) showPopover(button, current);
        });

        button.addEventListener("pointerleave", (event) => {
          if (!canHoverPause() || event.pointerType === "touch") return;
          hidePopover();
        });

        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const scrub = scrubber.reset(button);
          if (scrub) scrub.clicking = true;
          cycle.hold();
          const prevId = button.dataset.letterId;
          const next = await paintFromPool(button, cyclePool, prevId, {
            animate: true,
          });
          if (next && next.id !== prevId && button.dataset.letterId === next.id) {
            remember(slot, next.id);
            if (!isMobile()) showPopover(button, next);
          }
          if (scrub) scrub.clicking = false;
          cycle.kick();
        });
      }),
    );
  };

  await mount();
  document.addEventListener("kaik:translated", () => {
    hidePopover();
    mount();
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".dropcap, [data-dropcap-popover]")) return;
    hidePopover();
  });

  window.addEventListener(
    "resize",
    () => {
      if (isMobile()) {
        hidePopover();
        return;
      }
      const popover = document.querySelector("[data-dropcap-popover]");
      const slot = popover?.dataset.slot;
      if (!popover || popover.hidden || !slot) return;
      const button = document.querySelector(`.dropcap[data-slot="${slot}"]`);
      if (button) placePopover(popover, button);
    },
    { passive: true },
  );

  getScrollRoot().addEventListener("scroll", hidePopover, { passive: true });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopover();
  });
}
