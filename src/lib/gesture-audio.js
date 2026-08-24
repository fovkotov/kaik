/**
 * iOS Safari (especially inside a cross-origin iframe) will not play Web Audio
 * until a real user gesture unlocks it. pointerdown is not enough there —
 * touchstart / touchend / click are. A silent HTMLAudio.play() in the same
 * turn is what actually opens the media gate in WebKit iframes.
 *
 * Chromium treats `wheel` as a user gesture if AudioContext.resume() /
 * oscillator.start() run in that same turn. Do not call HTMLAudio.play()
 * first on desktop — it consumes the activation and leaves the context
 * suspended until a click.
 */

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export const UNLOCK_EVENTS = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "mousedown",
  "mouseup",
  "mousemove",
  "touchstart",
  "touchend",
  "touchmove",
  "wheel",
  "keydown",
  "keyup",
  "click",
];

const DISCRETE_UNLOCK = new Set([
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "wheel",
  "keydown",
  "keyup",
  "click",
]);

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

export function isDiscreteUnlock(type) {
  return DISCRETE_UNLOCK.has(type);
}

export function unlockHtmlAudio() {
  // Desktop Chromium: HTMLMediaElement.play() spends the wheel/keydown
  // activation before AudioContext.resume() can use it. iOS still needs this.
  if (!isAppleTouchWebKit()) return;
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

function isColdCtx(ctx) {
  return !ctx || ctx.state === "closed" || ctx.state === "suspended" || ctx.state === "interrupted";
}

/** Chromium: wheel/key run resume()+start() in the same turn — no isActive check. */
export function isDesktopChromiumGesture(type) {
  if (isAppleTouchWebKit()) return false;
  return type === "wheel" || type === "keydown" || type === "keyup";
}

/**
 * iOS: silent HTMLAudio + drop/recreate on a discrete gesture so the new
 * context starts in this turn. Desktop: never HTMLAudio (it spends the
 * wheel/keydown activation). Recreate while cold only when this turn is a
 * real activation (Chrome wheel/key) — not on pointermove floods, and not
 * on Safari wheel which is not a gesture.
 */
export function reviveAudioContext({ get, set, create, drop, resume, event } = {}) {
  const apple = isAppleTouchWebKit();
  const activated = typeof navigator !== "undefined" && Boolean(navigator.userActivation?.isActive);
  const discrete = isDiscreteUnlock(event?.type);
  const gesture = apple || activated || isDesktopChromiumGesture(event?.type);
  if (apple) unlockHtmlAudio();

  let ctx = typeof get === "function" ? get() : null;
  if (ctx && ctx.state === "running") {
    return ctx;
  }

  if (isColdCtx(ctx) && discrete && gesture) {
    drop?.();
    ctx = create();
    set?.(ctx);
    resume?.(ctx);
    return ctx;
  }

  if (!ctx || ctx.state === "closed") {
    if (!gesture) return ctx;
    ctx = create();
    set?.(ctx);
    resume?.(ctx);
    return ctx;
  }

  if (gesture) resume?.(ctx);
  return ctx;
}

/** Capture-phase listeners on document + window (+ extra) so iframe gestures hit. */
export function bindGestureUnlock(fn, extraTargets = []) {
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
}
