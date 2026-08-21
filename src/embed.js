/**
 * Runtime for living inside a Cargo / parent iframe.
 *
 * The page fills the iframe and scrolls internally. Kaik itself is
 * `html, body { height: 100% }` and `--frame-h: calc(100% - clips)` —
 * not 100vh. Parent must size the iframe to the space **below its menu**.
 *
 * Cargo / kaik.pictures — keep the same compact iframe, but do not use
 * plain `100vh`: Cargo already pads the page by the pinned nav
 * (`--pin-padding-top`, different on mobile vs desktop). `100vh` on top
 * of that padding makes the iframe taller than the screen.
 *
 *   <iframe
 *     src="https://fovkotov.github.io/kaik/"
 *     title="KÄIK"
 *     style="width:100%;height:calc(var(--viewport-height, 100vh) - var(--pin-padding-top, 0px));border:0;display:block;"
 *     allow="autoplay; clipboard-write"
 *     loading="eager"
 *   ></iframe>
 *
 * If CSS cannot see those variables, size the wrapper in JS and
 * optionally postMessage `{ type: 'kaik:frame-size', width, height }`.
 *
 * Production: https://kaik-one.vercel.app/ (frame-ancestors *). GitHub Pages ok.
 */

import { initHangingPrepositions } from "./hanging-prepositions.js";

const SOURCE = "kaik-course";

/** Optional override from parent postMessage `{ type: "kaik:frame-size", width, height }`. */
let parentFrameSize = null;

function memoryStore() {
  const memory = new Map();
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => {
      memory.set(k, String(v));
    },
    removeItem: (k) => {
      memory.delete(k);
    },
  };
}

function probeStore(store) {
  const key = "__kaik_probe__";
  store.setItem(key, "1");
  store.removeItem(key);
  return store;
}

export function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getScrollRoot() {
  return (
    document.querySelector("[data-scroll-root]") ||
    document.scrollingElement ||
    document.documentElement
  );
}

/**
 * Visible iframe rect. When the host iframe extends below the browser window
 * (common with height:100vh + external nav), visualViewport is shorter than
 * innerHeight — fixed footer chrome would sit off-screen without clip insets.
 */
function getVisualClipInsets() {
  const innerW = window.innerWidth || document.documentElement.clientWidth || 0;
  const innerH = window.innerHeight || document.documentElement.clientHeight || 0;
  const vv = window.visualViewport;

  if (!vv || !isEmbedded()) {
    return {
      clipTop: 0,
      clipBottom: 0,
      visibleWidth: Math.round(innerW),
      visibleHeight: Math.round(innerH),
    };
  }

  const clipTop = Math.max(0, Math.round(vv.offsetTop));
  const visibleBottom = Math.round(vv.offsetTop + vv.height);
  const clipBottom = Math.max(0, Math.round(innerH - visibleBottom));
  const visibleWidth = Math.round(Math.min(innerW, vv.width || innerW));
  const visibleHeight = Math.round(
    Math.max(1, Math.min(vv.height || innerH, innerH - clipTop - clipBottom)),
  );

  return { clipTop, clipBottom, visibleWidth, visibleHeight };
}

function getVisibleFrameRect() {
  const { clipTop, clipBottom, visibleWidth, visibleHeight } = getVisualClipInsets();
  return {
    width: visibleWidth,
    height: visibleHeight,
    clipTop,
    clipBottom,
  };
}

export function getViewportSize() {
  if (parentFrameSize) {
    const { clipTop, clipBottom, visibleHeight } = getVisualClipInsets();
    if (clipTop || clipBottom) {
      return {
        width: parentFrameSize.width,
        height: Math.max(1, Math.min(parentFrameSize.height, visibleHeight)),
      };
    }
    return { ...parentFrameSize };
  }

  const { width, height } = getVisibleFrameRect();
  return { width, height };
}

const frameListeners = new Set();

/** Run after `--frame-w` / `--frame-h` update (resize, visualViewport, parent message). */
export function onFrameMetrics(fn) {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

export function syncFrameMetrics() {
  const root = document.documentElement;
  let width;
  let height;
  let clipTop = 0;
  let clipBottom = 0;

  if (parentFrameSize) {
    width = parentFrameSize.width;
    height = parentFrameSize.height;
    ({ clipTop, clipBottom } = getVisualClipInsets());
    if (clipTop || clipBottom) {
      height = Math.max(1, height - clipTop - clipBottom);
    }
    root.style.setProperty("--frame-w", `${width}px`);
    root.style.setProperty("--frame-h", `${height}px`);
  } else {
    ({ width, height, clipTop, clipBottom } = getVisibleFrameRect());
    root.style.removeProperty("--frame-w");
    root.style.removeProperty("--frame-h");
  }

  root.style.setProperty("--frame-clip-top", `${clipTop}px`);
  root.style.setProperty("--frame-clip-bottom", `${clipBottom}px`);
  root.classList.toggle("is-embedded", isEmbedded());
  frameListeners.forEach((fn) => {
    try {
      fn({ width, height });
    } catch {
      // Listener must not break frame sync.
    }
  });
  return { width, height };
}

/** Apply explicit frame size from parent (optional; innerHeight is fine when iframe height is correct). */
export function applyParentFrameSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    parentFrameSize = { width: Math.round(w), height: Math.round(h) };
  } else {
    parentFrameSize = null;
  }
  return syncFrameMetrics();
}

function onParentMessage(event) {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type !== "kaik:frame-size") return;
  applyParentFrameSize(data.width, data.height);
}

export function listenForParentFrameSize() {
  window.addEventListener("message", onParentMessage);
  return () => window.removeEventListener("message", onParentMessage);
}

export function notifyParent(type, payload = {}) {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage({ source: SOURCE, type, ...payload }, "*");
  } catch {
    // Parent is unreachable — ignore.
  }
}

/** Hint for Cargo hosts: lock page scroll so deck swipes stay inside the iframe. */
export function requestParentScrollLock() {
  notifyParent("scroll-lock", {
    hint:
      "Size iframe to remaining height below nav (calc(var(--viewport-height) - var(--pin-padding-top)), not 100vh). " +
      "Optional: postMessage {type:'kaik:frame-size',width,height}.",
  });
}

/** localStorage is often blocked in third-party iframes (Safari ITP). */
export function safeStorage() {
  try {
    return probeStore(window.localStorage);
  } catch {
    return memoryStore();
  }
}

export function safeSessionStorage() {
  try {
    return probeStore(window.sessionStorage);
  } catch {
    return memoryStore();
  }
}

function rewriteExternalLinks(event) {
  const link = event.target.closest?.("a[href]");
  if (!link) return;

  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
  if (link.target) return;

  let url;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }

  if (url.origin !== window.location.origin) {
    link.setAttribute("target", "_top");
    link.setAttribute("rel", "noopener noreferrer");
  }
}

function scrollHashIntoView(event) {
  const link = event.target.closest?.('a[href^="#"]');
  if (!link) return;
  if (event.defaultPrevented) return;
  if (link.matches("[data-work-nav], [data-program-nav]")) return;

  const id = link.getAttribute("href")?.slice(1);
  if (!id) return;

  const target = document.getElementById(id);
  if (!target) return;
  // Deck cards are transformed / stacked — their box is not a page section.
  if (target.closest("[data-card], [data-deck]")) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  const root = getScrollRoot();
  const top = target.getBoundingClientRect().top + root.scrollTop;
  root.scrollTo({ top, behavior: "smooth" });
}

export function initEmbed() {
  listenForParentFrameSize();

  const size = syncFrameMetrics();
  document.documentElement.classList.add("is-iframe-ready");

  const onResize = () => {
    // After the iframe box changes, innerHeight is authoritative again.
    parentFrameSize = null;
    const next = syncFrameMetrics();
    notifyParent("resize", next);
  };

  window.addEventListener("resize", onResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onResize, { passive: true });
  window.visualViewport?.addEventListener("scroll", onResize, { passive: true });

  document.addEventListener("click", rewriteExternalLinks, true);
  document.addEventListener("click", scrollHashIntoView);

  initHangingPrepositions();
  notifyParent("ready", size);
  requestParentScrollLock();
}
