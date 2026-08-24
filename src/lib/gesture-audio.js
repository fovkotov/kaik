/**
 * iOS Safari (especially inside a cross-origin iframe) will not play Web Audio
 * until a real user gesture unlocks it. pointerdown is not enough there —
 * touchstart / touchend / click are. A silent HTMLAudio.play() in the same
 * turn is what actually opens the media gate in WebKit iframes.
 */

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchstart", "touchend", "keydown", "click"];

let htmlAudio = null;

export function audioContextCtor() {
  return window.AudioContext || window.webkitAudioContext;
}

export function isAppleTouchWebKit() {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (!nav) return false;
  if (/iP(ad|hone|od)/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}

export function unlockHtmlAudio() {
  try {
    if (!htmlAudio) {
      htmlAudio = new Audio(SILENT_WAV);
      htmlAudio.setAttribute("playsinline", "");
      htmlAudio.setAttribute("webkit-playsinline", "");
      htmlAudio.preload = "auto";
      htmlAudio.muted = false;
      htmlAudio.volume = 1;
      htmlAudio.setAttribute("aria-hidden", "true");
      Object.assign(htmlAudio.style, {
        position: "fixed",
        width: "0",
        height: "0",
        opacity: "0",
        pointerEvents: "none",
      });
      (document.documentElement || document.body)?.appendChild(htmlAudio);
    }
    const pending = htmlAudio.play();
    if (pending && typeof pending.catch === "function") {
      void pending.catch(() => {});
    }
  } catch {
    // Web Audio / media failures are silent.
  }
}

export function createUnlockedContext() {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error("AudioContext unavailable");
  const apple = isAppleTouchWebKit();
  try {
    if (apple) return new Ctor({ latencyHint: "interactive" });
    return new Ctor({ latencyHint: 0 });
  } catch {
    try {
      return new Ctor({ latencyHint: "interactive" });
    } catch {
      return new Ctor();
    }
  }
}

/** Capture-phase listeners on document + window so iframe taps always hit. */
export function bindGestureUnlock(fn) {
  const opts = { capture: true, passive: true };
  const onEvent = (event) => {
    if (!event.isTrusted) return;
    fn(event);
  };
  for (const type of UNLOCK_EVENTS) {
    document.addEventListener(type, onEvent, opts);
    window.addEventListener(type, onEvent, opts);
  }
}
