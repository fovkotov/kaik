import "./work-nav-arrow.css";
import { initEmbed } from "./embed.js";
import { initFormatVideo } from "./format-video.js";
import { initPreviewMedia } from "./preview-media.js";
import { initTickClicks } from "./tick-clicks.js";
import { initAuthorLightbox } from "./author-lightbox.js";
import { initImgSliders } from "./img-slider.js";
import { initProgramStrips } from "./program-strip.js";
import { initDropcaps } from "./letters/dropcap.js";
import { applyTranslations, getLocale, setLocale } from "./scriptik.js";
import { initWorksFeed } from "./works-feed.js";

const IGNORE =
  "a, button, [data-tweaks], [data-img-slider], [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next], [data-program-strip-prev], [data-program-strip-next], [data-author-lightbox], [data-author-work], [data-preview-media], [data-preview-hit], [data-format-mute], [data-work-ig], .work-card__who, [data-work-student-prev], [data-work-student-next], [data-work-open], input, textarea, select";

const MOVE_MS = 520;
const MOVE_EASE = "cubic-bezier(0.22, 1, 0.32, 1)";

function syncMobileClass() {
  document.documentElement.classList.toggle(
    "is-mobile",
    window.matchMedia("(max-width: 900px)").matches,
  );
}

function initLocale() {
  applyTranslations(getLocale());
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLocale(btn.getAttribute("data-lang"));
    });
  });
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tiltFor(card, index) {
  const raw = Number.parseFloat(card.getAttribute("data-base-rotate") || "");
  let deg = Number.isFinite(raw) ? raw : (index * 2.7) % 10 - 5;
  if (Math.abs(deg) < 2) deg = deg < 0 ? -2.4 : 2.8;
  return Math.max(-5, Math.min(5, deg));
}

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitTransition(el, ms) {
  if (reduceMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === el && event.propertyName === "transform") finish();
    };
    el.addEventListener("transitionend", onEnd);
    window.setTimeout(finish, ms + 40);
  });
}

function measure(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function invertFlip(el, from, to) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = to.width ? from.width / to.width : 1;
  const sy = to.height ? from.height / to.height : 1;
  el.style.transformOrigin = "0 0";
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  el.getBoundingClientRect();
  if (reduceMotion()) {
    el.style.transform = "";
    el.style.transition = "";
    el.style.transformOrigin = "";
    return Promise.resolve();
  }
  el.style.transition = `transform ${MOVE_MS}ms ${MOVE_EASE}`;
  el.style.transform = "none";
  return waitTransition(el, MOVE_MS).then(() => {
    el.style.transition = "";
    el.style.transform = "";
    el.style.transformOrigin = "";
  });
}

function initList() {
  const stack = document.querySelector("[data-list]");
  const stage = document.querySelector("[data-list-stage]");
  const left = document.querySelector("[data-list-left]");
  const closeBtn = document.querySelector("[data-fly-close]");
  if (!stack || !stage || !left) return;

  const cards = [...stack.querySelectorAll("[data-card]")];
  cards.forEach((card, index) => {
    card.style.setProperty("--list-rotate", `${tiltFor(card, index)}deg`);
  });

  /** @type {{ card: HTMLElement, spacer: HTMLElement, index: number } | null} */
  let open = null;
  let busy = false;

  function showClose(on) {
    if (!closeBtn) return;
    closeBtn.hidden = !on;
    closeBtn.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function applyOpenMetrics(card) {
    const box = stage.getBoundingClientRect();
    const w = Math.round(box.width) || left.clientWidth;
    const h = Math.round(box.height) || left.clientHeight;
    card.style.setProperty("--card-w", `${w}px`);
    card.style.setProperty("--card-h", `${h}px`);
  }

  function clearOpenMetrics(card) {
    card.style.removeProperty("--card-w");
    card.style.removeProperty("--card-h");
  }

  function setOpenChrome(card, on) {
    card.classList.toggle("is-list-open", on);
    card.classList.toggle("is-program-open", on);
    if (on) {
      applyOpenMetrics(card);
      card.setAttribute("data-expand-settled", "");
      card.querySelectorAll("[data-article-close]").forEach((btn) => {
        btn.hidden = false;
      });
    } else {
      clearOpenMetrics(card);
      card.removeAttribute("data-expand-settled");
      card.querySelectorAll("[data-article-close]").forEach((btn) => {
        btn.hidden = true;
      });
      card.scrollTop = 0;
    }
    left.classList.toggle("is-covered", on);
    document.documentElement.classList.toggle("is-list-open", on);
    showClose(on);
  }

  async function openCard(card) {
    if (busy || open?.card === card) return;
    if (open) await closeCard();
    if (busy || open) return;
    busy = true;

    const index = cards.indexOf(card);
    const from = measure(card);
    const spacer = document.createElement("div");
    spacer.className = "list-spacer";
    spacer.style.height = `${from.height}px`;
    spacer.setAttribute("aria-hidden", "true");
    card.after(spacer);

    card.classList.add("is-list-moving");
    stage.append(card);
    setOpenChrome(card, true);
    const to = measure(card);
    await invertFlip(card, from, to);
    card.classList.remove("is-list-moving");

    requestAnimationFrame(() => spacer.classList.add("is-closed"));
    open = { card, spacer, index };
    busy = false;
  }

  async function closeCard() {
    if (!open || busy) return;
    busy = true;
    const { card, spacer, index } = open;
    const from = measure(card);

    spacer.classList.remove("is-closed");
    const slotH = Number.parseFloat(spacer.style.height) || from.height;
    spacer.style.height = `${slotH}px`;
    spacer.getBoundingClientRect();

    card.classList.add("is-list-moving");
    setOpenChrome(card, false);
    if (spacer.parentNode) spacer.replaceWith(card);
    else if (cards[index + 1]?.parentNode === stack) stack.insertBefore(card, cards[index + 1]);
    else stack.append(card);

    const to = measure(card);
    await invertFlip(card, from, to);
    card.classList.remove("is-list-moving");
    card.style.setProperty("--list-rotate", `${tiltFor(card, index)}deg`);
    open = null;
    busy = false;
  }

  stack.addEventListener("click", (event) => {
    if (event.target.closest(IGNORE)) return;
    const card = event.target.closest("[data-card]");
    if (!card || !stack.contains(card)) return;
    openCard(card);
  });

  stage.addEventListener("click", (event) => {
    if (!open) return;
    const closeHit = event.target.closest("[data-article-close], [data-fly-illust-close]");
    if (closeHit) {
      event.preventDefault();
      event.stopPropagation();
      closeCard();
    }
  });

  closeBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    closeCard();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCard();
  });

  function bindNav(selector, findCard) {
    document.querySelectorAll(selector).forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = findCard();
        if (!card) return;
        if (open?.card === card) return;
        openCard(card);
      });
    });
  }

  bindNav("[data-program-nav], [data-i18n='nav.program']", () =>
    cards.find((el) => el.hasAttribute("data-program-card")),
  );
  bindNav("[data-work-nav], [data-i18n='nav.work']", () =>
    cards.find((el) => el.hasAttribute("data-works-card")) ||
    cards.find((el) => el.hasAttribute("data-work-card")),
  );

  return { openCard, closeCard };
}

syncMobileClass();
window.matchMedia("(max-width: 900px)").addEventListener("change", syncMobileClass);

initEmbed();
initLocale();
initTickClicks();
const listApi = initList();
initAuthorLightbox();
initImgSliders();
initProgramStrips();
initFormatVideo();
initPreviewMedia();
initWorksFeed();
initDropcaps();

const hash = window.location.hash.replace("#", "");
if (hash === "works") {
  const works = document.querySelector("[data-works-card]");
  if (works) listApi?.openCard(works);
}
