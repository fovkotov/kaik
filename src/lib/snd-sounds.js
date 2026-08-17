/**
 * SND01 "sine" kit from snd.dev, used by the click demo on
 * userinterface.wiki/sounds-on-the-web.
 *
 * Audio may be used free of charge commercially and non-commercially.
 * Copyright remains with Yasuhiro Tsuchiya / Dentsu Inc. See https://snd.dev/
 */

import { getAudioContext } from "./sound-engine.ts";

const SPRITE_URL = "/sounds/snd01/audioSprite.ogg";

/** UI-relevant slices from SND01. Loops and typewriter variants omitted. */
export const SND01_SLICES = {
  tap: { start: 30, end: 30.04 },
  button: { start: 0, end: 0.1001814058956916 },
  select: { start: 16, end: 16.1 },
  toggle_on: { start: 42, end: 42.09972789115646 },
  toggle_off: { start: 40, end: 40.09972789115646 },
  swipe: { start: 18, end: 18.15 },
  notification: { start: 8, end: 8.30031746031746 },
  caution: { start: 2, end: 2.160544217687075 },
  celebration: { start: 4, end: 5 },
  disabled: { start: 6, end: 6.070113378684807 },
  transition_up: { start: 46, end: 46.10063492063492 },
  transition_down: { start: 44, end: 44.10018140589569 },
};

let spriteBuffer = null;
let spritePromise = null;

function loadSprite() {
  if (spriteBuffer) return Promise.resolve(spriteBuffer);
  if (spritePromise) return spritePromise;

  spritePromise = fetch(SPRITE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`snd sprite ${res.status}`);
      return res.arrayBuffer();
    })
    .then((bytes) => getAudioContext().decodeAudioData(bytes.slice(0)))
    .then((buffer) => {
      spriteBuffer = buffer;
      return buffer;
    })
    .catch((err) => {
      spritePromise = null;
      throw err;
    });

  return spritePromise;
}

export async function playSndSound(name) {
  const slice = SND01_SLICES[name];
  if (!slice) return;

  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const buffer = await loadSprite();
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = 0.7;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(0, slice.start, Math.max(0.04, slice.end - slice.start));
}
