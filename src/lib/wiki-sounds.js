/**
 * Procedural UI sounds from userinterface.wiki (MIT).
 * Source: https://github.com/raphaelsalaja/userinterface-wiki/blob/main/lib/sounds.ts
 * Copyright (c) 2026 Raphael Salaja
 */

import { getScrollRoot } from "../embed.js";
import {
  bindGestureUnlock,
  createUnlockedContext,
  isDesktopChromiumGesture,
  isDiscreteUnlock,
  reviveAudioContext,
} from "./gesture-audio.js";

let audioContext = null;
let masterGain = null;
let keepAliveNode = null;
let outputVolume = 1;
let pendingPlays = [];
let stateHooked = false;

function createContext() {
  return createUnlockedContext();
}

function dropContext() {
  stateHooked = false;
  try {
    keepAliveNode?.stop();
  } catch {
    // already stopped
  }
  keepAliveNode = null;
  masterGain = null;
  const prev = audioContext;
  audioContext = null;
  if (prev && prev.state !== "closed") {
    try {
      void prev.close();
    } catch {
      // ignore
    }
  }
}

function flushPending() {
  if (!isWikiAudioRunning()) return;
  const batch = pendingPlays.splice(0);
  for (const play of batch) {
    try {
      play();
    } catch {
      // Web Audio failures are silent.
    }
  }
}

function hookState(ctx) {
  if (!ctx || stateHooked) return;
  stateHooked = true;
  ctx.addEventListener("statechange", () => {
    if (ctx.state === "closed") {
      stateHooked = false;
      return;
    }
    if (ctx.state === "running") flushPending();
  });
}

function enqueuePlay(play) {
  pendingPlays.push(play);
  if (audioContext) hookState(audioContext);
}

function attachGraph(ctx) {
  masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);
  startKeepAlive(ctx);
  resumeNow(ctx);
  primeOutput(ctx);
  hookState(ctx);
  return ctx;
}

function startKeepAlive(ctx) {
  if (keepAliveNode) return;
  const silent = ctx.createGain();
  silent.gain.value = 0;
  silent.connect(ctx.destination);
  try {
    const src = ctx.createConstantSource();
    src.offset.value = 0;
    src.connect(silent);
    src.start();
    keepAliveNode = src;
  } catch {
    const osc = ctx.createOscillator();
    osc.frequency.value = 20;
    osc.connect(silent);
    osc.start();
    keepAliveNode = osc;
  }
}

function primeOutput(ctx) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.02));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
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

function ensureContext() {
  if (audioContext && audioContext.state === "closed") dropContext();
  if (audioContext) {
    resumeNow(audioContext);
    return audioContext;
  }
  audioContext = createContext();
  return attachGraph(audioContext);
}

function getAudioContext() {
  return ensureContext();
}

function getDestination() {
  const ctx = getAudioContext();
  if (outputVolume === 1) return masterGain || ctx.destination;
  const tap = ctx.createGain();
  tap.gain.value = outputVolume;
  tap.connect(masterGain || ctx.destination);
  return tap;
}

/**
 * Call from a user gesture. iOS recreates the context in the same turn as
 * touchstart/touchend + silent HTMLAudio. Desktop resumes (or creates) on
 * wheel/pointer/key — never HTMLAudio-first, so Chrome can start oscillators
 * in that wheel turn.
 */
export function warmWikiAudio(event) {
  if (reduced()) return;
  try {
    reviveAudioContext({
      get: () => audioContext,
      set: (ctx) => {
        audioContext = ctx;
      },
      create: () => attachGraph(createContext()),
      drop: dropContext,
      resume: (ctx) => {
        const wasCold = ctx.state !== "running";
        resumeNow(ctx);
        if (wasCold) primeOutput(ctx);
        hookState(ctx);
        flushPending();
      },
      event,
    });
  } catch {
    // Web Audio failures are silent.
  }
}

export function isWikiAudioRunning() {
  return Boolean(audioContext && audioContext.state === "running");
}

export function whenWikiAudioRunning(fn) {
  if (typeof fn !== "function") return false;
  if (isWikiAudioRunning()) {
    fn();
    return true;
  }
  enqueuePlay(fn);
  warmWikiAudio();
  return false;
}

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const sounds = {
  click: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.008, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 50);
    }
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 4000 + Math.random() * 1000;
    filter.Q.value = 3;

    const gain = ctx.createGain();
    gain.gain.value = 0.5 + Math.random() * 0.15;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(getDestination());
    noise.start(t);
  },

  pop: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.04);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(getDestination());
    osc.start(t);
    osc.stop(t + 0.05);
  },

  toggle: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.012, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 80);
    }
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2500;
    filter.Q.value = 4;

    const gain = ctx.createGain();
    gain.gain.value = 0.4;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(getDestination());
    noise.start(t);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.03);
    oscGain.gain.setValueAtTime(0.15, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(oscGain);
    oscGain.connect(getDestination());
    osc.start(t);
    osc.stop(t + 0.04);
  },

  tick: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.004, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 20);
    }
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 3000;

    const gain = ctx.createGain();
    gain.gain.value = 0.3;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(getDestination());
    noise.start(t);
  },

  whoosh: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.sin((i / data.length) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(1500, t + 0.08);
    filter.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.value = 0.15;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(getDestination());
    noise.start(t);
  },

  success: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99];
    const spacing = 0.08;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = "triangle";
      osc.frequency.value = freq;
      osc2.type = "sine";
      osc2.frequency.value = freq * 2;

      filter.type = "lowpass";
      filter.frequency.value = 3000;

      const start = t + i * spacing;
      const duration = 0.15;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(filter);
      filter.connect(getDestination());

      osc.start(start);
      osc2.start(start);
      osc.stop(start + duration);
      osc2.stop(start + duration);
    });

    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = "sine";
    shimmer.frequency.value = 1046.5;
    shimmerGain.gain.setValueAtTime(0, t + 0.24);
    shimmerGain.gain.linearRampToValueAtTime(0.15, t + 0.26);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(getDestination());
    shimmer.start(t + 0.24);
    shimmer.stop(t + 0.45);
  },

  confirm: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.015, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 100);
    }
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000;
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.value = 0.4;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(getDestination());
    noise.start(t);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    oscGain.gain.setValueAtTime(0.25, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(oscGain);
    oscGain.connect(getDestination());
    osc.start(t);
    osc.stop(t + 0.06);
  },

  error: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const distortion = ctx.createWaveShaper();

    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      curve[i] = Math.tanh(x * 2);
    }
    distortion.curve = curve;

    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(180, t);
    osc1.frequency.exponentialRampToValueAtTime(80, t + 0.25);

    osc2.type = "square";
    osc2.frequency.setValueAtTime(190, t);
    osc2.frequency.exponentialRampToValueAtTime(85, t + 0.25);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
    gain.gain.setValueAtTime(0.3, t + 0.08);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;

    osc1.connect(distortion);
    osc2.connect(distortion);
    distortion.connect(gain);
    gain.connect(filter);
    filter.connect(getDestination());

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.3);
    osc2.stop(t + 0.3);
  },

  warning: () => {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    [0, 0.15].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = "triangle";
      osc.frequency.value = i === 0 ? 880 : 698.46;

      filter.type = "bandpass";
      filter.frequency.value = 1200;
      filter.Q.value = 1;

      const start = t + delay;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.01);
      gain.gain.setValueAtTime(0.3, start + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(getDestination());

      osc.start(start);
      osc.stop(start + 0.12);
    });
  },
};

function runSound(play, volume) {
  const prev = outputVolume;
  outputVolume = volume;
  try {
    play();
  } catch {
    // Web Audio failures are silent, matching ui-sounds.js.
  } finally {
    outputVolume = prev;
  }
}

function canStartInThisTurn(event) {
  if (!event?.isTrusted) return false;
  if (isDiscreteUnlock(event.type) || isDesktopChromiumGesture(event.type)) return true;
  return Boolean(navigator.userActivation?.isActive);
}

export function playWikiSound(name, options = {}) {
  if (reduced()) return;
  const play = sounds[name];
  if (!play) return;
  const volume = options.volume ?? 1;
  if (volume <= 0) return;
  try {
    // Recreate/resume in this turn — never await resume() before oscillators.
    warmWikiAudio(options.event);
    if (isWikiAudioRunning() || canStartInThisTurn(options.event)) {
      runSound(play, volume);
      return;
    }
    if (options.queue) {
      enqueuePlay(() => runSound(play, volume));
      return;
    }
    runSound(play, volume);
  } catch {
    // Web Audio failures are silent, matching ui-sounds.js.
  }
}

bindGestureUnlock((event) => {
  warmWikiAudio(event);
}, [getScrollRoot()]);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") warmWikiAudio();
});
window.addEventListener("pageshow", () => warmWikiAudio());
window.addEventListener("focus", () => warmWikiAudio());
