import { publicUrl } from "../public-url.js";
import { isMobile } from "../tweaks.js";
import { createUnlockedContext, hasAudioGesture, reviveAudioContext } from "./gesture-audio.js";
import { beltHandle1Sound } from "./belt-handle-1.ts";
import { beltHandle2Sound } from "./belt-handle-2.ts";
import { cloth1Sound } from "./cloth-1.ts";
import { cloth2Sound } from "./cloth-2.ts";
import { cloth3Sound } from "./cloth-3.ts";
import { cloth4Sound } from "./cloth-4.ts";
import { clothBeltSound } from "./cloth-belt.ts";
import { clothBelt2Sound } from "./cloth-belt-2.ts";
import { drop003Sound } from "./drop-003.ts";
import { dropLeatherSound } from "./drop-leather.ts";
import { handleCoinsSound } from "./handle-coins.ts";
import { handleCoins2Sound } from "./handle-coins-2.ts";
import { handleSmallLeatherSound } from "./handle-small-leather.ts";
import { handleSmallLeather2Sound } from "./handle-small-leather-2.ts";

const SND_URL = publicUrl("sounds/snd01.m4a");

/** SND01 sprite slices — UI clips only (no loops / typewriter). */
export const SND_SPRITES = {
  button: { start: 0, end: 0.1001814058956916 },
  caution: { start: 2, end: 2.160544217687075 },
  celebration: { start: 4, end: 5 },
  disabled: { start: 6, end: 6.070113378684807 },
  notification: { start: 8, end: 8.30031746031746 },
  select: { start: 16, end: 16.1 },
  swipe: { start: 18, end: 18.15 },
  tap_01: { start: 30, end: 30.01 },
  tap_02: { start: 32, end: 32.01 },
  tap_03: { start: 34, end: 34.01004535147392 },
  tap_04: { start: 36, end: 36.01002267573696 },
  tap_05: { start: 38, end: 38.01 },
  toggle_off: { start: 40, end: 40.09972789115646 },
  toggle_on: { start: 42, end: 42.09972789115646 },
  transition_down: { start: 44, end: 44.10018140589569 },
  transition_up: { start: 46, end: 46.10063492063492 },
};

const SOUNDCN = {
  "belt-handle-1": beltHandle1Sound,
  "belt-handle-2": beltHandle2Sound,
  "cloth-1": cloth1Sound,
  "cloth-2": cloth2Sound,
  "cloth-3": cloth3Sound,
  "cloth-4": cloth4Sound,
  "cloth-belt": clothBeltSound,
  "cloth-belt-2": clothBelt2Sound,
  "drop-003": drop003Sound,
  "drop-leather": dropLeatherSound,
  "handle-coins": handleCoinsSound,
  "handle-coins-2": handleCoins2Sound,
  "handle-small-leather": handleSmallLeatherSound,
  "handle-small-leather-2": handleSmallLeather2Sound,
};

let clipCtx = null;
const uriBuffers = new Map();
let spriteBuffer = null;
let spriteLoading = false;

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function resumeNow(ctx) {
  if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
  try {
    const pending = ctx.resume();
    if (pending && typeof pending.catch === "function") void pending.catch(() => {});
  } catch {
    // Web Audio failures are silent.
  }
}

function createClipContext() {
  return createUnlockedContext();
}

function dropClipContext() {
  const prev = clipCtx;
  clipCtx = null;
  if (prev && prev.state !== "closed") {
    try {
      void prev.close();
    } catch {
      // ignore
    }
  }
}

function ensureClipContext() {
  if (isMobile()) return null;
  if (clipCtx && clipCtx.state === "closed") dropClipContext();
  if (clipCtx) {
    resumeNow(clipCtx);
    return clipCtx;
  }
  if (!hasAudioGesture()) return null;
  clipCtx = createClipContext();
  resumeNow(clipCtx);
  return clipCtx;
}

function getClipContext() {
  return ensureClipContext();
}

function playBuffer(buffer, volume, offset = 0, duration) {
  const ctx = getClipContext();
  if (!ctx) return;
  resumeNow(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const destGain = Math.min(1, volume);
  const sourceBoost = volume > 1 ? volume : 1;
  let node = ctx.destination;
  if (destGain < 1) {
    const tap = ctx.createGain();
    tap.gain.value = destGain;
    tap.connect(node);
    node = tap;
  }
  if (sourceBoost > 1) {
    const boost = ctx.createGain();
    boost.gain.value = sourceBoost;
    boost.connect(node);
    node = boost;
  }
  src.connect(node);
  const when = ctx.currentTime;
  if (duration != null && duration > 0) src.start(when, offset, duration);
  else src.start(when, offset);
}

function decodeUri(dataUri) {
  if (isMobile()) return;
  if (uriBuffers.has(dataUri) || !dataUri) return;
  let ctx;
  try {
    ctx = getClipContext();
  } catch {
    return;
  }
  if (!ctx) return;
  const base64 = dataUri.split(",")[1];
  if (!base64) return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  void ctx.decodeAudioData(bytes.buffer.slice(0)).then((buf) => {
    uriBuffers.set(dataUri, buf);
  }).catch(() => {});
}

function loadSprite() {
  if (isMobile()) return;
  if (spriteBuffer || spriteLoading) return;
  spriteLoading = true;
  fetch(SND_URL)
    .then((res) => res.arrayBuffer())
    .then((raw) => {
      const ctx = getClipContext();
      if (!ctx) {
        spriteLoading = false;
        return null;
      }
      return ctx.decodeAudioData(raw);
    })
    .then((buf) => {
      if (buf) spriteBuffer = buf;
      else spriteLoading = false;
    })
    .catch(() => {
      spriteLoading = false;
    });
}

export function warmClipAudio(event) {
  if (isMobile() || reduced()) return;
  try {
    if (clipCtx && clipCtx.state === "running") return;
    reviveAudioContext({
      get: () => clipCtx,
      set: (ctx) => {
        clipCtx = ctx;
      },
      create: createClipContext,
      drop: dropClipContext,
      resume: resumeNow,
      event,
    });
  } catch {
    // Web Audio failures are silent.
  }
}

export function playSoundcn(name, volume = 1) {
  if (isMobile() || reduced() || volume <= 0) return;
  const asset = SOUNDCN[name];
  if (!asset) return;
  const cached = uriBuffers.get(asset.dataUri);
  if (cached) {
    playBuffer(cached, volume);
    return;
  }
  decodeUri(asset.dataUri);
  try {
    const audio = new Audio(asset.dataUri);
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play();
  } catch {
    // ignore
  }
}

export function playSnd(name, volume = 1) {
  if (isMobile() || reduced() || volume <= 0) return;
  const slice = SND_SPRITES[name];
  if (!slice) return;
  const dur = Math.max(0.01, slice.end - slice.start);
  if (spriteBuffer) {
    playBuffer(spriteBuffer, volume, slice.start, dur);
    return;
  }
  loadSprite();
  try {
    const audio = new Audio(SND_URL);
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.addEventListener(
      "loadedmetadata",
      () => {
        try {
          audio.currentTime = slice.start;
          void audio.play();
          window.setTimeout(() => {
            try {
              audio.pause();
            } catch {
              // ignore
            }
          }, dur * 1000);
        } catch {
          // ignore
        }
      },
      { once: true },
    );
  } catch {
    // ignore
  }
}

export const SOUNDCN_NAMES = Object.keys(SOUNDCN);
export const SND_NAMES = Object.keys(SND_SPRITES);
