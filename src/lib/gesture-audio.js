/**
 * Desktop audio starts only after the first real tap/click. Wheel, keydown,
 * fly-in, and mousemove must not create an AudioContext — they caused lag and
 * stray ticks/whooshes (queued fly-ins dumping on the first click, wheel
 * unlocking a suspended context).
 *
 * After that tap, Chromium can still start oscillators in the same wheel
 * turn (resume()+start(), no HTMLAudio-first). Continuous move events must
 * NEVER run unlock work — they thrash the main thread.
 */

import { isMobile } from "../tweaks.js";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/** First unlock: tap/click only. No wheel, key, or move floods. */
export const UNLOCK_EVENTS = [
  "pointerdown",
  "mousedown",
  "touchstart",
  "click",
];

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

function isColdCtx(ctx) {
  return !ctx || ctx.state === "closed" || ctx.state === "suspended" || ctx.state === "interrupted";
}

/** Chromium: after the first tap, wheel/key may start() in that same turn. */
export function isDesktopChromiumGesture(type) {
  if (isAppleTouchWebKit()) return false;
  return type === "wheel" || type === "keydown" || type === "keyup";
}

/**
 * Create the context only on the first tap/click. Wheel/key/userActivation
 * must not open a new one — they used to dump a backlog on the next click.
 * After that tap: resume an existing context (do not close on every wheel).
 * No mousemove / pointermove / touchmove path.
 */
export function reviveAudioContext({ get, set, create, drop, resume, event } = {}) {
  if (isMobile()) return typeof get === "function" ? get() : null;
  let ctx = typeof get === "function" ? get() : null;
  // Fast path: already running — no HTMLAudio, no resume spam.
  if (ctx && ctx.state === "running") {
    return ctx;
  }

  const tap = Boolean(event?.isTrusted && isTapUnlockEvent(event.type));
  if (tap) markAudioUnlocked();

  // Until the first tap: no create, no resume, no HTMLAudio.
  if (!hasAudioGesture()) return ctx;

  const apple = isAppleTouchWebKit();
  const discrete = isDiscreteUnlock(event?.type);
  const wheelOrKey = isDesktopChromiumGesture(event?.type);
  const activated = typeof navigator !== "undefined" && Boolean(navigator.userActivation?.isActive);
  const gesture = discrete || wheelOrKey || activated;

  // Silent HTMLAudio only on Apple, and only on a tap.
  if (apple && tap) unlockHtmlAudio();

  if (isColdCtx(ctx) && tap) {
    if (apple) {
      drop?.();
      ctx = create();
      set?.(ctx);
      resume?.(ctx);
      return ctx;
    }
    if (!ctx || ctx.state === "closed") {
      ctx = create();
      set?.(ctx);
      resume?.(ctx);
      return ctx;
    }
    resume?.(ctx);
    return ctx;
  }

  if (!ctx || ctx.state === "closed") {
    // Recreate only after a tap already happened — never on first wheel.
    if (!tap && !hasAudioGesture()) return ctx;
    if (!gesture) return ctx;
    ctx = create();
    set?.(ctx);
    resume?.(ctx);
    return ctx;
  }

  if (gesture) resume?.(ctx);
  return ctx;
}

/**
 * Capture-phase listeners on document + window (+ extra) so iframe taps hit.
 * Returns an unbind function. Callers should unbind after the first successful
 * unlock so later wheel floods never keep thrashing the main thread.
 */
export function bindGestureUnlock(fn, extraTargets = []) {
  if (isMobile()) return () => {};
  const opts = { capture: true, passive: true };
  const onEvent = (event) => {
    if (!event.isTrusted) return;
    fn(event);
  };
  const targets = [document, window, ...extraTargets.filter(Boolean)];
  for (const type of UNLOCK_EVENTS) {
    for (const target of targets) {
      try {
        target.addEventListener(type, onEvent, opts);
      } catch {
        // window may reject some types in old WebKit.
      }
    }
  }
  return () => {
    for (const type of UNLOCK_EVENTS) {
      for (const target of targets) {
        try {
          target.removeEventListener(type, onEvent, opts);
        } catch {
          // ignore
        }
      }
    }
  };
}
