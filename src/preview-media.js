import { t } from "./scriptik.js";

const MOBILE_MQ = "(max-width: 900px)";

function withEmbedParams(src, extra = {}) {
  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("rel", "0");
    url.searchParams.set("enablejsapi", "1");
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return src;
  }
}

function syncHitLabel(hit) {
  const key = "preview.play";
  hit.setAttribute("data-i18n-aria", key);
  hit.setAttribute("aria-label", t(key));
}

function setPreviewMediaActive(on) {
  document.documentElement.classList.toggle("is-preview-media-active", Boolean(on));
}

function bindPreviewMedia(media) {
  const iframe = media.querySelector("iframe.preview-card__embed, iframe");
  if (!iframe) return;

  iframe.src = withEmbedParams(iframe.getAttribute("src") || iframe.src);

  let hit = media.querySelector("[data-preview-hit]");
  if (!hit) {
    hit = document.createElement("button");
    hit.type = "button";
    hit.className = "preview-card__hit";
    hit.setAttribute("data-preview-hit", "");
    media.appendChild(hit);
  }
  syncHitLabel(hit);

  const stopDeck = (event) => {
    event.stopPropagation();
  };

  const playViaApi = () => {
    try {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "playVideo", args: [] }),
        "*",
      );
    } catch {
      // Cross-origin / not ready yet — autoplay query param still applies.
    }
  };

  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new CustomEvent("kaik:cancel-deck-drag"));

    // Parent-document tap: mobile touch-action:none + card transforms keep
    // gestures out of the cross-origin YouTube iframe, so play from here.
    iframe.src = withEmbedParams(iframe.src, { autoplay: "1" });
    iframe.addEventListener("load", playViaApi, { once: true });
    hit.hidden = true;
    setPreviewMediaActive(true);
  };

  hit.addEventListener("pointerdown", stopDeck);
  hit.addEventListener("pointerup", stopDeck);
  hit.addEventListener("click", activate);

  // Direct iframe taps (desktop / after shield is gone): still cancel deck drag.
  media.addEventListener("pointerdown", (event) => {
    if (event.target === hit || hit.contains(event.target)) return;
    if (!window.matchMedia(MOBILE_MQ).matches) return;
    document.dispatchEvent(new CustomEvent("kaik:cancel-deck-drag"));
    setPreviewMediaActive(true);
  });
}

export function initPreviewMedia(scope = document) {
  scope.querySelectorAll("[data-preview-media]").forEach(bindPreviewMedia);
  document.addEventListener("kaik:translated", () => {
    scope.querySelectorAll("[data-preview-hit]").forEach(syncHitLabel);
  });
}
