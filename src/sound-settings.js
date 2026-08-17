import { playUISound } from "./lib/ui-sounds.js";
import { playSound } from "./lib/sound-engine.ts";
import { beltHandle1Sound } from "./lib/belt-handle-1.ts";
import { beltHandle2Sound } from "./lib/belt-handle-2.ts";
import { clothBeltSound } from "./lib/cloth-belt.ts";
import { clothBelt2Sound } from "./lib/cloth-belt-2.ts";
import { drop003Sound } from "./lib/drop-003.ts";
import { playWikiSound } from "./lib/wiki-sounds.js";
import { playSndSound } from "./lib/snd-sounds.js";
import { t } from "./scriptik.js";

const DESLOP = [
  ["press", "sound.press"],
  ["click", "sound.click"],
  ["tap", "sound.tap"],
  ["hover", "sound.hover"],
  ["select", "sound.select"],
  ["toggle", "sound.toggle"],
  ["tick", "sound.tick"],
];

const SOUNDCN = [
  ["belt-handle-1", "sound.beltHandle1", beltHandle1Sound],
  ["belt-handle-2", "sound.beltHandle2", beltHandle2Sound],
  ["cloth-belt", "sound.clothBelt", clothBeltSound],
  ["cloth-belt-2", "sound.clothBelt2", clothBelt2Sound],
  ["drop-003", "sound.drop003", drop003Sound],
];

const WIKI = [
  ["click", "sound.wikiClick"],
  ["pop", "sound.wikiPop"],
  ["toggle", "sound.wikiToggle"],
  ["tick", "sound.wikiTick"],
  ["whoosh", "sound.wikiWhoosh"],
  ["success", "sound.wikiSuccess"],
  ["confirm", "sound.wikiConfirm"],
  ["error", "sound.wikiError"],
  ["warning", "sound.wikiWarning"],
];

const SND = [
  ["tap", "sound.sndTap"],
  ["button", "sound.sndButton"],
  ["select", "sound.sndSelect"],
  ["toggle_on", "sound.sndToggleOn"],
  ["toggle_off", "sound.sndToggleOff"],
  ["swipe", "sound.sndSwipe"],
  ["notification", "sound.sndNotification"],
  ["caution", "sound.sndCaution"],
  ["celebration", "sound.sndCelebration"],
  ["disabled", "sound.sndDisabled"],
  ["transition_up", "sound.sndTransitionUp"],
  ["transition_down", "sound.sndTransitionDown"],
];

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function playCn(asset) {
  if (reduced()) return;
  playSound(asset.dataUri).catch(() => {});
}

export function initSoundSettings() {
  const root = document.createElement("div");
  root.className = "sound-settings";
  root.dataset.soundSettings = "";
  root.innerHTML = `
    <button type="button" class="sound-settings__fab" data-sound-open aria-expanded="false" aria-controls="sound-settings-panel">
      <span data-i18n="sound.settings">${t("sound.settings")}</span>
    </button>
    <div class="sound-settings__panel" id="sound-settings-panel" hidden data-sound-panel>
      <div class="sound-settings__head">
        <p class="sound-settings__title" data-i18n="sound.title">${t("sound.title")}</p>
        <button type="button" class="sound-settings__close" data-sound-close data-i18n="sound.close">${t("sound.close")}</button>
      </div>
      <p class="sound-settings__hint" data-i18n="sound.hint">${t("sound.hint")}</p>
      <h3 class="sound-settings__group" data-i18n="sound.deslop">${t("sound.deslop")}</h3>
      <ul class="sound-settings__list">
        ${DESLOP.map(
          ([name, key]) => `
            <li>
              <button type="button" class="sound-settings__item" data-sound-play="${name}">
                <span class="sound-settings__name">${name}</span>
                <span class="sound-settings__desc" data-i18n="${key}">${t(key)}</span>
              </button>
            </li>
          `,
        ).join("")}
      </ul>
      <h3 class="sound-settings__group" data-i18n="sound.soundcn">${t("sound.soundcn")}</h3>
      <ul class="sound-settings__list">
        ${SOUNDCN.map(
          ([name, key]) => `
            <li>
              <button type="button" class="sound-settings__item" data-sound-cn="${name}">
                <span class="sound-settings__name">${name}</span>
                <span class="sound-settings__desc" data-i18n="${key}">${t(key)}</span>
              </button>
            </li>
          `,
        ).join("")}
      </ul>
      <h3 class="sound-settings__group" data-i18n="sound.wiki">${t("sound.wiki")}</h3>
      <ul class="sound-settings__list">
        ${WIKI.map(
          ([name, key]) => `
            <li>
              <button type="button" class="sound-settings__item" data-sound-wiki="${name}">
                <span class="sound-settings__name">${name}</span>
                <span class="sound-settings__desc" data-i18n="${key}">${t(key)}</span>
              </button>
            </li>
          `,
        ).join("")}
      </ul>
      <h3 class="sound-settings__group" data-i18n="sound.snd">${t("sound.snd")}</h3>
      <ul class="sound-settings__list">
        ${SND.map(
          ([name, key]) => `
            <li>
              <button type="button" class="sound-settings__item" data-sound-snd="${name}">
                <span class="sound-settings__name">${name}</span>
                <span class="sound-settings__desc" data-i18n="${key}">${t(key)}</span>
              </button>
            </li>
          `,
        ).join("")}
      </ul>
    </div>
  `;
  document.body.append(root);

  const openBtn = root.querySelector("[data-sound-open]");
  const closeBtn = root.querySelector("[data-sound-close]");
  const panel = root.querySelector("[data-sound-panel]");

  function setOpen(open) {
    panel.hidden = !open;
    openBtn.setAttribute("aria-expanded", String(open));
    root.classList.toggle("is-open", open);
  }

  openBtn.addEventListener("click", () => {
    playUISound("click");
    setOpen(panel.hidden);
  });
  closeBtn.addEventListener("click", () => {
    playUISound("press");
    setOpen(false);
  });

  root.querySelectorAll("[data-sound-play]").forEach((btn) => {
    btn.addEventListener("click", () => {
      playUISound(btn.getAttribute("data-sound-play"));
    });
  });

  const cnSounds = new Map(SOUNDCN.map(([name, , asset]) => [name, asset]));
  root.querySelectorAll("[data-sound-cn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const asset = cnSounds.get(btn.getAttribute("data-sound-cn"));
      if (asset) playCn(asset);
    });
  });

  root.querySelectorAll("[data-sound-wiki]").forEach((btn) => {
    btn.addEventListener("click", () => {
      playWikiSound(btn.getAttribute("data-sound-wiki"));
    });
  });

  root.querySelectorAll("[data-sound-snd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (reduced()) return;
      playSndSound(btn.getAttribute("data-sound-snd")).catch(() => {});
    });
  });
}
