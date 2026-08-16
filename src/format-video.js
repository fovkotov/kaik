import { t } from "./scriptik.js";

const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
const SOUND_ON = "format.sound.on";
const SOUND_OFF = "format.sound.off";

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

  const playIfAllowed = () => {
    if (reduce() && video.muted) {
      video.pause();
      return;
    }
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

  if (!reduce()) tryPlay(video);
}

export function initFormatVideo(scope = document) {
  scope.querySelectorAll(".format-card__media").forEach(bindFormatVideo);
}
