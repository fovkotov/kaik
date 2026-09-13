import { bindLightboxShot } from "./author-lightbox.js";
import { t } from "./scriptik.js";

const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
const SOUND_ON = "format.sound.on";
const SOUND_OFF = "format.sound.off";
const OPEN_LABEL = "format.workshops.open";

function stopDeck(event) {
  event.stopPropagation();
}

function syncMute(video, btn) {
  const muted = video.muted;
  btn.setAttribute("aria-pressed", muted ? "false" : "true");
  const key = muted ? SOUND_ON : SOUND_OFF;
  btn.setAttribute("data-i18n-aria", key);
  btn.setAttribute("aria-label", t(key));
}

function syncHitLabel(hit) {
  hit.setAttribute("data-i18n-aria", OPEN_LABEL);
  hit.setAttribute("aria-label", t(OPEN_LABEL));
}

/** Real button over the clip: native Enter / Space, focus ring, no fake roles. */
function buildHit(media) {
  let hit = media.querySelector("[data-format-open]");
  if (!hit) {
    hit = document.createElement("button");
    hit.type = "button";
    hit.className = "format-card__hit";
    hit.setAttribute("data-format-open", "");
    media.append(hit);
  }
  syncHitLabel(hit);
  return hit;
}

function tryPlay(video) {
  const play = video.play();
  if (play && typeof play.catch === "function") play.catch(() => {});
}

function bindFormatVideo(media) {
  const video = media.querySelector("video");
  const btn = media.querySelector("[data-format-mute]");
  if (!video || !btn) return;

  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.removeAttribute("controls");
  video.controls = false;
  video.draggable = false;

  const reduce = () => REDUCE.matches;

  const hostOpen = () => Boolean(media.closest("[data-focus-open], .is-program-open"));

  const playIfAllowed = () => {
    if (reduce() && video.muted) {
      video.pause();
      return;
    }
    if (document.documentElement.classList.contains("is-focus-frozen") && !hostOpen()) {
      video.pause();
      return;
    }
    if (!video.paused) return;
    tryPlay(video);
  };

  syncMute(video, btn);

  btn.addEventListener("pointerdown", stopDeck);
  btn.addEventListener("pointerup", stopDeck);
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    video.muted = !video.muted;
    if (!video.muted) tryPlay(video);
    else if (reduce()) video.pause();
    syncMute(video, btn);
  });

  document.addEventListener("kaik:translated", () => syncMute(video, btn));
  REDUCE.addEventListener("change", playIfAllowed);

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) {
        video.pause();
        return;
      }
      playIfAllowed();
    },
    { threshold: 0.2 },
  );
  io.observe(media);

  if (!reduce()) playIfAllowed();

  document.addEventListener("kaik:focus-frozen", () => {
    if (!hostOpen()) video.pause();
  });

  // Same click-to-fullscreen as the program / author images, with the clip and
  // its mute state handed over so the viewer picks up where the card left off.
  const hit = buildHit(media);
  document.addEventListener("kaik:translated", () => syncHitLabel(hit));

  bindLightboxShot(media, (event) => {
    if (event?.target?.closest?.("[data-format-mute]")) return null;
    const src = video.currentSrc || video.getAttribute("src");
    if (!src) return null;
    return {
      items: [
        {
          src,
          poster: video.getAttribute("poster") || "",
          video: true,
          muted: video.muted,
          time: video.currentTime,
        },
      ],
      index: 0,
    };
  });

  // One clip at a time: the viewer plays it, the card waits.
  document.addEventListener("kaik:lightbox", (event) => {
    if (event.detail?.open) video.pause();
    else playIfAllowed();
  });

  document.addEventListener("kaik:lightbox-mute", (event) => {
    const src = video.currentSrc || video.getAttribute("src");
    if (!event.detail || !src || !sameSrc(event.detail.src, src)) return;
    video.muted = Boolean(event.detail.muted);
    syncMute(video, btn);
  });
}

function sameSrc(a, b) {
  if (!a || !b) return false;
  try {
    return new URL(a, window.location.href).href === new URL(b, window.location.href).href;
  } catch {
    return a === b;
  }
}

export function initFormatVideo(scope = document) {
  scope.querySelectorAll(".format-card__media").forEach(bindFormatVideo);
}
