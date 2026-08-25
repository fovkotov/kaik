/**
 * Desktop Web Audio, Cuelume-style: create the context lazily on the first
 * real gesture (wheel, keydown, or tap), resume() synchronously in that
 * handler, and start() oscillators in the same turn. Do not await resume.
 *
 * Fly-in, mousemove, and load must not create a context — they caused lag
 * and stray ticks (queued whooshes dumping on the first gesture).
 *
 * Continuous move events must NEVER run unlock work. Extra unlock listeners
 * unbind after the first create so later wheel floods stay cheap. Silent
 * HTMLAudio.play() is Apple-touch only — never on desktop Chromium.
 */

import { isMobile } from "../tweaks.js";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/** Tap/click. Not wheel — that lives on DESKTOP_UNLOCK_EVENTS. */
export const UNLOCK_EVENTS = [
  "pointerdown",
  "mousedown",
  "touchstart",
  "click",
];

/** One-shot unlock: tap plus Chromium wheel/key. No mousemove. */
export const DESKTOP_UNLOCK_EVENTS = [...UNLOCK_EVENTS, "wheel", "keydown"];

const DISCRETE_UNLOCK = new Set(UNLOCK_EVENTS);

let htmlAudio = null;
let htmlUnlocked = false;
let audioGestureDone = false;

export function audioContextCtor() {
  return window.AudioContext || window.webkitAudioContext;
}

export function isAppleTouchWebKit() {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (!nav) return false;
  if (/iP(ad|hone|od)/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}

export function isDiscreteUnlock(type) {
  return DISCRETE_UNLOCK.has(type);
}

/** pointerdown / click (and mousedown / touchstart). Not wheel or key. */
export function isTapUnlockEvent(type) {
  return DISCRETE_UNLOCK.has(type);
}

/** Chromium user-activation: resume()+start() in this same turn. */
export function isDesktopChromiumGesture(type) {
  if (isAppleTouchWebKit()) return false;
  return type === "wheel" || type === "keydown";
}

export function eventCanUnlockAudio(event) {
  if (!event?.isTrusted) return false;
  if (isTapUnlockEvent(event.type)) return true;
  return isDesktopChromiumGesture(event.type);
}

export function hasAudioGesture() {
  return audioGestureDone;
}

export function markAudioUnlocked() {
  audioGestureDone = true;
}

export function unlockHtmlAudio() {
  if (isMobile()) return;
  // Desktop Chromium: HTMLMediaElement.play() spends a gesture activation
  // before AudioContext.resume() can use it. iOS still needs this.
  if (!isAppleTouchWebKit()) return;
  if (htmlUnlocked) return;
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
    if (pending && typeof pending.then === "function") {
      void pending.then(() => {
        htmlUnlocked = true;
      }).catch(() => {});
    } else {
      htmlUnlocked = true;
    }
  } catch {
    // Web Audio / media failures are silent.
  }
}

export function createUnlockedContext() {
  if (isMobile()) throw new Error("AudioContext disabled on mobile");
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

/**
 * Create once on the first wheel/key/tap. Resume in that same turn.
 * Never recreate on later wheels. No mousemove path.
 */
export function reviveAudioContext({ get, set, create, drop, resume, event } = {}) {
  if (isMobile()) return typeof get === "function" ? get() : null;
  let ctx = typeof get === "function" ? get() : null;
  // Fast path: already running — no HTMLAudio, no resume spam.
  if (ctx && ctx.state === "running") {
    return ctx;
  }

  const tap = Boolean(event?.isTrusted && isTapUnlockEvent(event.type));
  const wheelOrKey = Boolean(event?.isTrusted && isDesktopChromiumGesture(event.type));
  if (tap || wheelOrKey) markAudioUnlocked();

  // Until a real gesture: no create, no resume, no HTMLAudio.
  // Wheel is enough on desktop Chromium — no prior click required.
  if (!hasAudioGesture()) return ctx;

  const apple = isAppleTouchWebKit();
  const discrete = Boolean(event?.isTrusted && isDiscreteUnlock(event.type));
  const activated =
    typeof navigator !== "undefined" && Boolean(navigator.userActivation?.isActive);
  const gesture = discrete || wheelOrKey || activated;

  // Silent HTMLAudio only on Apple touch, and only on a tap — never desktop.
  if (apple && tap) unlockHtmlAudio();

  if (!ctx || ctx.state === "closed") {
    if (!tap && !wheelOrKey && !gesture) return ctx;
    ctx = create();
    set?.(ctx);
    resume?.(ctx);
    return ctx;
  }

  // Existing suspended context: resume in this turn. Do not drop/recreate
  // on wheel — that was the lag + stray-sound path.
  if (apple && tap && drop && create) {
    drop();
    ctx = create();
    set?.(ctx);
    resume?.(ctx);
    return ctx;
  }

  if (gesture || hasAudioGesture()) resume?.(ctx);
  return ctx;
}

/**
 * Capture-phase listeners so iframe gestures hit. Wheel/key bind once on
 * document only (not window+root) so the first burst is cheap. Callers
 * unbind after the first successful create; the tick handler stays.
 */
export function bindGestureUnlock(fn, extraTargets = []) {
  if (isMobile()) return () => {};
  const opts = { capture: true, passive: true };
  const onEvent = (event) => {
    if (!event.isTrusted) return;
    fn(event);
  };
  const tapTargets = [document, window, ...extraTargets.filter(Boolean)];
  for (const type of UNLOCK_EVENTS) {
    for (const target of tapTargets) {
      try {
        target.addEventListener(type, onEvent, opts);
      } catch {
        // window may reject some types in old WebKit.
      }
    }
  }
  const desktopTypes = DESKTOP_UNLOCK_EVENTS.filter((type) => !DISCRETE_UNLOCK.has(type));
  for (const type of desktopTypes) {
    try {
      document.addEventListener(type, onEvent, opts);
    } catch {
      // ignore
    }
  }
  return () => {
    for (const type of UNLOCK_EVENTS) {
      for (const target of tapTargets) {
        try {
          target.removeEventListener(type, onEvent, opts);
        } catch {
          // ignore
        }
      }
    }
    for (const type of desktopTypes) {
      try {
        document.removeEventListener(type, onEvent, opts);
      } catch {
        // ignore
      }
    }
  };
}
