import { initEmbed } from "./embed.js";
import { applyTranslations, getLocale } from "./scriptik.js";
import "./scroll.css";

const SEGMENTS = 20;
const ARC = 200;
const START = -90;

initEmbed();
applyTranslations(getLocale());
initRoll();

function initRoll() {
  const root = document.querySelector("[data-scroll-root]");
  const card = document.querySelector("[data-roll-card]");
  const source = document.querySelector("[data-roll-source]");
  const flat = document.querySelector("[data-roll-flat]");
  const curl = document.querySelector("[data-roll-curl]");
  const track = document.querySelector("[data-scroll-track]");
  const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!root || !card || !source || !flat || !curl || !track) return;

  const flatPaper = flat.querySelector("[data-roll-paper]");
  if (!flatPaper) return;

  function sourceHtml() {
    return source.innerHTML.trim();
  }

  flatPaper.innerHTML = sourceHtml();

  /** @type {{ el: HTMLElement, paper: HTMLElement, shade: HTMLElement }[]} */
  const segs = [];

  function clearSegs() {
    curl.querySelectorAll("[data-roll-seg]").forEach((node) => node.remove());
    segs.length = 0;
  }

  function buildSegs() {
    clearSegs();
    if (reduceMq.matches) return;
    const html = sourceHtml();
    for (let i = 0; i < SEGMENTS; i += 1) {
      const el = document.createElement("span");
      el.className = "roll-card__seg";
      el.setAttribute("data-roll-seg", "");
      el.innerHTML =
        '<span class="roll-card__window"><span class="roll-card__paper" data-roll-paper></span></span><span class="roll-card__shade"></span>';
      const paper = el.querySelector("[data-roll-paper]");
      const shade = el.querySelector(".roll-card__shade");
      if (!paper || !shade) continue;
      paper.innerHTML = html;
      curl.append(el);
      segs.push({ el, paper, shade });
    }
  }

  function metrics() {
    const cardH = card.offsetHeight;
    const cardW = card.offsetWidth;
    const radius = Math.max(26, cardW * 0.118);
    const stepDeg = ARC / SEGMENTS;
    const stepRad = (stepDeg * Math.PI) / 180;
    const segH = 2 * radius * Math.sin(stepRad / 2);
    const reserve = radius * 2.05;
    const paperH = flatPaper.scrollHeight;
    const flatH = Math.max(80, cardH - reserve);
    const maxOffset = Math.max(0, paperH - flatH + radius);
    return { cardH, cardW, radius, stepDeg, segH, reserve, paperH, flatH, maxOffset };
  }

  let m = metrics();

  function layout() {
    m = metrics();
    card.style.setProperty("--roll-reserve", `${m.reserve}px`);
    card.style.setProperty("--radius", `${m.radius}px`);
    card.style.setProperty("--rod-d", `${Math.max(20, m.radius * 0.72)}px`);
    card.style.setProperty("--seg-h", `${m.segH}px`);
    track.style.height = reduceMq.matches ? "1px" : `${Math.ceil(m.maxOffset)}px`;
  }

  /** @param {number} offset */
  function paint(offset) {
    const y = -offset;
    flatPaper.style.transform = `translate3d(0, ${y}px, 0)`;

    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      const mid = START + (i + 0.5) * m.stepDeg;
      const lit = Math.max(0, Math.cos(((mid + 18) * Math.PI) / 180));
      const shade = 0.05 + (1 - lit) * 0.5;
      seg.el.style.transform =
        `translate3d(0, ${m.radius}px, 0) rotateX(${mid}deg) translate3d(0, 0, ${m.radius}px)`;
      seg.paper.style.transform = `translate3d(0, ${y - m.flatH - i * m.segH}px, 0)`;
      seg.shade.style.opacity = String(shade);
    }
  }

  function applyMode() {
    const reduced = reduceMq.matches;
    card.classList.toggle("is-reduced", reduced);
    if (reduced) {
      clearSegs();
      flatPaper.style.transform = "";
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
