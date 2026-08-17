/**
 * Mobile text enter: pixel-point animate-text `micro-scale-fade` (whole target)
 * plus a micro translateY so copy arrives from below — not a slide.
 * Does not split text nodes (hanging-preposition walker / SF Rounded stay intact).
 */

import { MOBILE_MQ, isMobile } from "./tweaks.js";

const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Showcase runtime scales portable 600ms by 0.72. */
const DURATION_MS = 432;
const FROM_SCALE = 0.96;
/** Micro rise — not a slide. Spec has no y; direction is the “from below” ask. */
const FROM_Y_PX = 12;
const STAGGER_MS = 40;
const ORIGIN = "50% 55%";

const FACE_SEL = [
  ".format-card__label",
  ".format-card__note",
  ".author-card__title",
  ".author-card__name",
  ".program-card__title",
  ".progress-card__title",
  ".works-card__title",
  ".exercises-card__title",
  ".exercises-card__text",
  ".preview-card__title",
  ".faq-card__title",
  ".history-card__kicker",
  ".history-card__title",
].join(", ");

const EXPAND_SEL = [
  ".program-card__week-title",
  ".program-card__name",
  ".program-card__when",
  ".program-card__kind",
  ".faq-card__q",
  ".faq-card__a",
  ".history-card__text",
  ".history-card__caption",
  ".history-card__book-cap",
  ".progress-card__who",
].join(", ");

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fromTransform(el) {
  const kick = el.classList.contains("history-card__kicker");
  const origin = kick ? "translateX(-50%) " : "";
  return {
    from: `${origin}translate3d(0, ${FROM_Y_PX}px, 0) scale(${FROM_SCALE})`,
    to: `${origin}translate3d(0, 0, 0) scale(1)`,
  };
}

function playUnit(el, delayMs) {
  if (!el || el.dataset.msfDone === "1") return;
  el.dataset.msfDone = "1";
  if (reduceMotion() || !isMobile()) {
    el.style.opacity = "";
    el.style.transform = "";
    return;
  }

  const display = getComputedStyle(el).display;
  if (display === "inline") el.style.display = "inline-block";
  el.style.transformOrigin = ORIGIN;

  const { from, to } = fromTransform(el);
  const anim = el.animate(
    [
      { opacity: 0, transform: from },
      { opacity: 1, transform: to },
    ],
    {
      delay: delayMs,
      duration: DURATION_MS,
      easing: EASING,
      fill: "forwards",
    },
  );

  anim.finished
    .then(() => {
      el.style.opacity = "";
      el.style.transform = "";
      el.style.display = "";
      el.style.transformOrigin = "";
      anim.cancel();
    })
    .catch(() => {});
}

function playGroup(card, selector) {
  if (!card || !isMobile()) return;
  const units = [...card.querySelectorAll(selector)].filter((el) => el.dataset.msfDone !== "1");
  if (reduceMotion()) {
    units.forEach((el) => playUnit(el, 0));
    return;
  }
  units.forEach((el, i) => playUnit(el, i * STAGGER_MS));
}

export function revealCardFace(card) {
  playGroup(card, FACE_SEL);
}

export function revealCardExpand(card) {
  playGroup(card, EXPAND_SEL);
}

export function initTextAppear() {
  if (typeof document === "undefined") return;
  window.matchMedia(MOBILE_MQ).addEventListener("change", () => {
    if (!isMobile()) {
      document.querySelectorAll("[data-msf-done]").forEach((el) => {
        el.style.opacity = "";
        el.style.transform = "";
        el.style.display = "";
        el.style.transformOrigin = "";
      });
    }
  });
}
