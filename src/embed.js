/**
 * Runtime for living inside a Cargo / parent iframe.
 *
 * The page fills the iframe viewport and scrolls internally. Parent should
 * give the iframe a real height (typically 100vh of the host page).
 */

const SOURCE = "kaik-course";

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

export function getViewportSize() {
  const vv = window.visualViewport;
  return {
    width: Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0),
    height: Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0),
  };
}

export function syncFrameMetrics() {
  const { width, height } = getViewportSize();
  const root = document.documentElement;
  root.style.setProperty("--frame-w", `${width}px`);
  root.style.setProperty("--frame-h", `${height}px`);
  root.classList.toggle("is-embedded", isEmbedded());
  return { width, height };
}

export function notifyParent(type, payload = {}) {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage({ source: SOURCE, type, ...payload }, "*");
  } catch {
    // Parent is unreachable — ignore.
  }
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

  const id = link.getAttribute("href")?.slice(1);
  if (!id) return;

  const target = document.getElementById(id);
  if (!target) return;

  event.preventDefault();
  const root = getScrollRoot();
  const top = target.getBoundingClientRect().top + root.scrollTop;
  root.scrollTo({ top, behavior: "smooth" });
}

export function initEmbed() {
  const size = syncFrameMetrics();
  document.documentElement.classList.add("is-iframe-ready");

  const onResize = () => {
    const next = syncFrameMetrics();
    notifyParent("resize", next);
  };

  window.addEventListener("resize", onResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onResize, { passive: true });

  document.addEventListener("click", rewriteExternalLinks, true);
  document.addEventListener("click", scrollHashIntoView);

  notifyParent("ready", size);
}
