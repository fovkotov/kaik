import { initEmbed } from "./embed.js";
import { applyTranslations, getLocale } from "./scriptik.js";
import "./scroll2.css";

const SEGMENTS = 18;
const ARC = 168;
const START = -8;
const COVER_SPAN = 220;

initEmbed();
applyTranslations(getLocale());
initPen();

function initPen() {
  const root = document.querySelector("[data-scroll-root]");
  const card = document.querySelector("[data-pen-card]");
  const source = document.querySelector("[data-roll-source]");
  const cover = document.querySelector("[data-pen-cover]");
  const bark = document.querySelector("[data-pen-bark]");
  const flat = document.querySelector("[data-pen-flat]");
  const curl = document.querySelector("[data-pen-curl]");
  const track = document.querySelector("[data-scroll-track]");
  const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!root || !card || !source || !cover || !bark || !flat || !curl || !track) return;

  const flatPaper = flat.querySelector("[data-roll-paper]");
  const coverPaper = cover.querySelector("[data-roll-paper]");
  if (!flatPaper || !coverPaper) return;

  function sourceHtml() {
    return source.innerHTML.trim();
  }

  flatPaper.innerHTML = sourceHtml();
  coverPaper.innerHTML = sourceHtml();

  /** @type {{ el: HTMLElement, paper: HTMLElement }[]} */
  const segs = [];

  function clearSegs() {
    curl.querySelectorAll("[data-pen-seg]").forEach((node) => node.remove());
    segs.length = 0;
  }

  function buildSegs() {
    clearSegs();
    if (reduceMq.matches) return;
    const html = sourceHtml();
    for (let i = 0; i < SEGMENTS; i += 1) {
      const el = document.createElement("span");
      el.className = "pen-card__seg";
      el.setAttribute("data-pen-seg", "");
      el.innerHTML =
        '<span class="pen-card__face"><span class="pen-card__paper" data-roll-paper></span></span><span class="pen-card__back"></span>';
      const paper = el.querySelector("[data-roll-paper]");
      if (!paper) continue;
      paper.innerHTML = html;
      curl.append(el);
      segs.push({ el, paper });
    }
  }

  function metrics() {
    const cardH = card.offsetHeight;
    const cardW = card.offsetWidth;
    const rollH = Math.max(72, Math.round(cardW * 0.22));
    const step = rollH / SEGMENTS;
    const paperH = flatPaper.scrollHeight;
    const flatH = Math.max(80, cardH - rollH);
    const maxOffset = Math.max(0, paperH - flatH + rollH + COVER_SPAN);
    return { cardH, cardW, rollH, step, paperH, flatH, maxOffset };
  }

  let m = metrics();

  function layout() {
    m = metrics();
    card.style.setProperty("--roll-h", `${m.rollH}px`);
    card.style.setProperty("--seg-h", `${m.step}px`);
    track.style.height = reduceMq.matches ? "1px" : `${Math.ceil(m.maxOffset)}px`;
  }

  /** @param {number} offset */
  function paint(offset) {
    const coverT = Math.min(1, offset / COVER_SPAN);
    const open = coverT * -135;
    cover.style.transform = `rotateY(${open}deg)`;
    bark.style.opacity = String(Math.min(1, coverT * 1.15));
    const tilt = 8 + coverT * 7;
    const inset = 220 - coverT * 180;
    card.style.transform = `rotate3d(0, 1, 0.15, ${tilt}deg)`;
    card.style.boxShadow = `inset ${inset}px 0 50px rgba(0,0,0,.28), ${18 - coverT * 10}px ${10 + coverT * 8}px ${50 + coverT * 30}px rgba(0,0,0,.18)`;

    const sheetY = -Math.max(0, offset - COVER_SPAN);
    flatPaper.style.transform = `translate3d(0, ${sheetY}px, 0)`;
    coverPaper.style.transform = "translate3d(0, 0, 0)";

    const stepDeg = ARC / SEGMENTS;
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      const mid = START + (i + 0.5) * stepDeg;
      seg.el.style.top = `${i * m.step}px`;
      seg.el.style.transform = `rotateX(${mid}deg)`;
      seg.paper.style.transform = `translate3d(0, ${sheetY - m.flatH - i * m.step}px, 0)`;
    }
  }

  function applyMode() {
    const reduced = reduceMq.matches;
    card.classList.toggle("is-reduced", reduced);
    if (reduced) {
      clearSegs();
      flatPaper.style.transform = "";
      cover.style.transform = "";
      bark.style.opacity = "0";
      card.style.transform = "";
      card.style.boxShadow = "";
      track.style.height = "1px";
      return;
    }
    buildSegs();
    applyTranslations(getLocale());
    layout();
    paint(root.scrollTop);
  }

  let ticking = false;
  function onScroll() {
    if (reduceMq.matches) return;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      paint(root.scrollTop);
    });
  }

  function relayout() {
    layout();
    if (!reduceMq.matches) paint(root.scrollTop);
  }

  applyMode();

  root.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", relayout);
  reduceMq.addEventListener("change", applyMode);
  document.addEventListener("kaik:translated", relayout);
  if (document.fonts?.ready) {
    document.fonts.ready.then(relayout).catch(() => {});
  }
  window.addEventListener("load", relayout);
}
