import { getScrollRoot, getViewportSize } from "../embed.js";
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
import { sameCatalog, subscribeCatalog } from "./live.js";

/** First paint always opens on this gothic L. Click / scroll still cycle. */
const FIRST_DROPCAP_ID = "ltr_53a64d7a";

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
const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Fine pointer only — iOS sticky :hover / synthetic mouseenter must not open the popover. */
const canHoverPause = () =>
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

function spinTokens(button) {
  const css = getComputedStyle(button);
  const ms = (name, fallback) => {
    const n = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(n) && n > 0 ? n : fallback;
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

function introDone() {
  return document.documentElement.classList.contains("intro-done");
}

function svgStamp(entry) {
  return entry?.updatedAt || entry?.createdAt || "";
}

function svgCacheKey(entry) {
  return `${entry.id}:${svgStamp(entry)}`;
}

function svgReady(entry) {
  return typeof svgCache.get(svgCacheKey(entry)) === "string";
}

async function fetchSvg(entry) {
  const key = svgCacheKey(entry);
  const hit = svgCache.get(key);
  if (typeof hit === "string") return hit;
  if (hit) return hit;
  /* Same URL as <link rel="preload"> / first-paint <img> — no cache-bust query. */
  const req = (async () => {
    const res = await fetch(publicUrl(`letters/${entry.file}`));
    if (!res.ok) throw new Error("SVG missing");
    const text = await res.text();
    svgCache.set(key, text);
    return text;
  })();
  svgCache.set(key, req);
  try {
    return await req;
  } catch (err) {
    if (svgCache.get(key) === req) svgCache.delete(key);
    throw err;
  }
}

function warmPool(pool) {
  for (const entry of pool) {
    fetchSvg(entry).catch(() => {});
  }
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
  button.dataset.svgStamp = svgStamp(entry);
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

/** Drop in-flight click spin so scroll-scrub can take over without clearing swap rotateY. */
function abortCycleSpin(button) {
  button._paintGen = (button._paintGen || 0) + 1;
  stopSpin(button);
  const swap = button.querySelector(".dropcap__swap");
  const glyphs = [...(swap?.querySelectorAll(".dropcap__glyph") || [])];
  glyphs.forEach((glyph, i) => {
    if (i < glyphs.length - 1) glyph.remove();
  });
}

async function paintGlyph(button, entry, { animate = false, onStart } = {}) {
  const gen = (button._paintGen = (button._paintGen || 0) + 1);
  const swap = ensureSwap(button);
  const current = swap.querySelector(".dropcap__glyph");
  /* Intro lockup WAAPI flattens rotateY — swap now, don't wait for it to end. */
  const instant = !animate || reduceMotion() || !current || !introDone();
  const glyphPromise = makeGlyph(button, entry);
  applyMeta(button, entry);
  onStart?.(entry);

  if (instant) {
    const glyph = await glyphPromise;
    if (button._paintGen !== gen) return false;
    stopSpin(button);
    swap.replaceChildren(glyph);
    return true;
  }

  stopSpin(button);
  button.classList.add("is-spinning");

  const { outMs, inMs, easeIn, easeOut, blur } = spinTokens(button);
  const cached = svgReady(entry);
  const outAnim = cached
    ? null
    : playSpin(current, 0, SPIN_OUT_DEG, outMs, easeIn, "0px", blur);

  let glyph;
  try {
    glyph = await glyphPromise;
  } catch (err) {
    if (button._paintGen === gen) stopSpin(button);
    throw err;
  }
  if (button._paintGen !== gen) return false;

  /* Swap as soon as the SVG is ready — don't wait out the 300ms spin. */
  outAnim?.cancel();
  current.remove();
  swap.append(glyph);
  const inAnim = playSpin(glyph, SPIN_IN_FROM_DEG, 0, inMs, easeOut, blur, "0px");
  await waitAnim(inAnim);
  if (button._paintGen !== gen) return false;

  inAnim.cancel();
  glyph.style.transform = "";
  glyph.style.filter = "";
  button.classList.remove("is-spinning");
  return true;
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

/** Paint a preferred letter first; fall back to the pool if it is missing. */
async function paintPreferred(button, pool, preferredId, opts = {}) {
  const preferred = preferredId
    ? pool.find((item) => item.id === preferredId)
    : null;
  if (preferred) {
    try {
      const painted = await paintGlyph(button, preferred, opts);
      if (painted) return preferred;
      return null;
    } catch {
      /* SVG missing — keep going through the pool. */
    }
  }
  return paintFromPool(button, pool, preferredId, opts);
}

/** Paint the first variant whose SVG loads. Prefer `excludeId` only as a skip. */
async function paintFromPool(button, pool, excludeId, opts = {}) {
  if (!pool.length) return null;
  const remaining = pool.slice();
  let skip = excludeId;
  while (remaining.length) {
    const entry = pickVariant(remaining, skip);
    if (!entry) return null;
    try {
      const painted = await paintGlyph(button, entry, opts);
      if (painted) return entry;
      return null;
    } catch {
      const idx = remaining.findIndex((item) => item.id === entry.id);
      if (idx >= 0) remaining.splice(idx, 1);
      skip = undefined;
    }
  }
  return null;
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
    /* Stuck `active` / iframe jitter must not refresh settle. */
    if (scrubbing && !settleTimer) {
      settleTimer = window.setTimeout(unwindToRest, SCRUB_SETTLE_MS);
    }
  };

  document.addEventListener("kaik:deck-progress", onDeckProgress);

  return {
    add(button, pool) {
      scrubs.push({
        button,
        pool,
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

function syncHostRest(host, button, rest) {
  const leftover = [...host.childNodes].filter((node) => node !== button);
  leftover.forEach((node) => node.remove());
  host.append(document.createTextNode(rest));
}

/** Kick the catalog fetch as soon as this module evaluates — before deck/modals. */
const catalogReady = loadCatalog();

export async function initDropcaps() {
  let catalog = await catalogReady;
  const hosts = [...document.querySelectorAll("[data-dropcap]")];
  if (!hosts.length) return;

  warmPool(allLetters(catalog));

  const popover = ensurePopover();

  let mountGen = 0;
  const scrubber = createScrubber();
  const runtime = new WeakMap();

  const bound = new WeakSet();
  const POINTER_CYCLE_MS = 700;

  const cycleButton = (button) => {
    const state = runtime.get(button);
    if (!state) return;
    const scrub = scrubber.reset(button);
    const cycleGen = (button._cycleGen = (button._cycleGen || 0) + 1);
    if (scrub) scrub.clicking = true;
    const prevId = button.dataset.letterId;
    paintFromPool(button, state.cyclePool, prevId, {
      animate: true,
      onStart: (entry) => {
        if (!isMobile()) showPopover(button, entry);
      },
    }).finally(() => {
      if (scrub && button._cycleGen === cycleGen) scrub.clicking = false;
    });
  };

  const bindButton = (button) => {
    if (bound.has(button)) return;
    bound.add(button);

    button.addEventListener("pointerenter", (event) => {
      if (!canHoverPause() || event.pointerType === "touch") return;
      const current = letterById(catalog, button.dataset.letterId);
      if (current) showPopover(button, current);
    });

    button.addEventListener("pointerleave", (event) => {
      if (!canHoverPause() || event.pointerType === "touch") return;
      if (event.relatedTarget?.closest?.("[data-dropcap-popover]")) return;
      hidePopover();
    });

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      button._dropcapAt = performance.now();
      cycleButton(button);
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() - (button._dropcapAt || 0) < POINTER_CYCLE_MS) return;
      cycleButton(button);
    });
  };

  const attachRuntime = (button, cyclePool) => {
    scrubber.add(button, cyclePool);
    runtime.set(button, { cyclePool });
    warmPool(cyclePool);
  };

  popover.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const slot = popover.dataset.slot;
    const button = slot && document.querySelector(`.dropcap[data-slot="${slot}"]`);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    button._dropcapAt = performance.now();
    cycleButton(button);
  });
  popover.addEventListener("pointerleave", (event) => {
    if (event.relatedTarget?.closest?.(".dropcap")) return;
    hidePopover();
  });

  const mount = async ({ animate = false } = {}) => {
    const gen = ++mountGen;
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

        const slot = host.id || `dropcap-${index}`;
        let button = host.querySelector(".dropcap");
        const hadGlyph = Boolean(button?.querySelector(".dropcap__glyph"));
        const paintedChar = button?.dataset.char;
        const currentId = button?.dataset.letterId;
        const currentEntry = currentId ? letterById(catalog, currentId) : null;

        if (!pool.length) {
          /* Keep the HTML first-paint glyph; never leave a hole if catalog fails. */
          if (hadGlyph) {
            bindButton(button);
            return;
          }
          if (source) host.textContent = source;
          return;
        }

        const rest =
          char && (!explicit || normalizeChar(first) === char)
            ? source.slice(first.length)
            : source;

        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "dropcap";
          button.dataset.slot = slot;
          if (gen !== mountGen) return;
          host.replaceChildren(button, document.createTextNode(rest));
          bindButton(button);
        } else {
          const swap = button.querySelector(".dropcap__swap");
          if (swap) swap.style.transform = "";
          button.classList.remove("is-scrubbing");
          syncHostRest(host, button, rest);
          bindButton(button);
        }

        if (gen !== mountGen) return;

        const cyclePool = clickPool(catalog, char);
        const picked = button.hasAttribute("data-dropcap-picked");
        const localeSwap = Boolean(
          animate && matched.length && paintedChar && paintedChar !== char,
        );
        /* Keep the first-paint pinned glyph. Re-pick only when locale has a
           matching set, or when the inline pick never ran. */
        const keepHtmlGlyph =
          hadGlyph && !localeSwap && (picked || animate || !pool.length);

        if (keepHtmlGlyph) {
          if (currentEntry) applyMeta(button, currentEntry);
          attachRuntime(button, cyclePool);
          return;
        }

        const entry = await paintPreferred(button, pool, FIRST_DROPCAP_ID, {
          animate: animate && hadGlyph,
        });
        if (gen !== mountGen) return;
        if (!entry) {
          if (hadGlyph) {
            attachRuntime(button, cyclePool);
            return;
          }
          host.textContent = source;
          return;
        }
        button.setAttribute("data-dropcap-picked", "");
        attachRuntime(button, cyclePool);
      }),
    );
  };

  await mount();
  document.addEventListener("kaik:translated", () => {
    hidePopover();
    mount({ animate: true });
  });
  subscribeCatalog(async () => {
    const next = await loadCatalog({ bust: true });
    if (sameCatalog(catalog, next)) return;
    catalog = next;
    hidePopover();
    mount({ animate: true });
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
