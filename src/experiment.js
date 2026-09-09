function navEl() {
  return document.querySelector("[data-experiment-nav]");
}

function wrapEl() {
  return document.querySelector("[data-experiment-embed]");
}

function frameEl() {
  return wrapEl()?.querySelector("iframe") || null;
}

function fit() {
  const nav = navEl();
  const wrap = wrapEl();
  const iframe = frameEl();
  if (!wrap || !iframe) return;

  const top = nav ? Math.round(nav.getBoundingClientRect().bottom) : 0;
  const height = Math.max(0, window.innerHeight - top);
  wrap.style.height = `${height}px`;

  const width = wrap.clientWidth;
  try {
    iframe.contentWindow?.postMessage({ type: "kaik:frame-size", width, height }, "*");
  } catch {
    /* ignore */
  }
}

function boot() {
  const iframe = frameEl();
  window.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("scroll", fit);
  iframe?.addEventListener("load", fit);
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== "kaik-course") return;
    if (data.type === "ready" || data.type === "resize") fit();
  });
  fit();
}

boot();
