import { initEmbed } from "./embed.js";
import { snapshotNode } from "./paper-snapshot.js";
import { applyTranslations, getLocale } from "./scriptik.js";
import "./scroll.css";

const PAPER = "#2bb673";
const ARC = Math.PI * 1.12;
const FALLBACK_SEGS = 56;
const FALLBACK_START = -90;

initEmbed();
applyTranslations(getLocale());
initRoll();

function initRoll() {
  const root = document.querySelector("[data-scroll-root]");
  const card = document.querySelector("[data-roll-card]");
  const source = document.querySelector("[data-roll-source]");
  const flat = document.querySelector("[data-roll-flat]");
  const canvas = document.querySelector("[data-roll-canvas]");
  const segsRoot = document.querySelector("[data-roll-segs]");
  const track = document.querySelector("[data-scroll-track]");
  const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!root || !card || !source || !flat || !canvas || !segsRoot || !track) return;

  const flatPaper = flat.querySelector("[data-roll-paper]");
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!flatPaper || !ctx) return;

  flatPaper.innerHTML = source.innerHTML.trim();

  /** @type {HTMLCanvasElement | null} */
  let tex = null;
  let capturing = false;
  /** @type {{ el: HTMLElement, paper: HTMLElement }[]} */
  const segs = [];

  function sourceHtml() {
    return source.innerHTML.trim();
  }

  function clearSegs() {
    segsRoot.querySelectorAll("[data-roll-seg]").forEach((node) => node.remove());
    segs.length = 0;
  }

  function buildSegs() {
    clearSegs();
    const html = sourceHtml();
    for (let i = 0; i < FALLBACK_SEGS; i += 1) {
      const el = document.createElement("span");
      el.className = "roll-card__seg";
      el.setAttribute("data-roll-seg", "");
      el.innerHTML =
        '<span class="roll-card__window"><span class="roll-card__paper" data-roll-paper></span></span>';
      const paper = el.querySelector("[data-roll-paper]");
      if (!paper) continue;
      paper.innerHTML = html;
      segsRoot.append(el);
      segs.push({ el, paper });
    }
  }

  function metrics() {
    const cardH = card.offsetHeight;
    const cardW = card.offsetWidth;
    const radius = Math.max(28, Math.round(cardW * 0.132));
    const rollH = radius * 2;
    const stepDeg = (ARC * 180) / Math.PI / FALLBACK_SEGS;
    const stepRad = (stepDeg * Math.PI) / 180;
    const segH = 2 * radius * Math.sin(stepRad / 2);
    const paperH = flatPaper.scrollHeight;
    const flatH = Math.max(80, cardH - rollH);
    const maxOffset = Math.max(0, paperH - flatH + radius * ARC);
    return { cardH, cardW, radius, rollH, stepDeg, segH, paperH, flatH, maxOffset };
  }

  let m = metrics();

  function layout() {
    m = metrics();
    card.style.setProperty("--roll-h", `${m.rollH}px`);
    card.style.setProperty("--radius", `${m.radius}px`);
    card.style.setProperty("--seg-h", `${Math.max(2, m.segH * 1.35)}px`);
    track.style.height = reduceMq.matches ? "1px" : `${Math.ceil(m.maxOffset)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(m.cardW * dpr));
    const h = Math.max(1, Math.round(m.rollH * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  /**
   * Smooth cylinder: each destination row is a 1px paper slice, lit continuously.
   * @param {number} offset
   */
  function paint(offset) {
    const y = -offset;
    flatPaper.style.transform = `translate3d(0, ${y}px, 0)`;
    if (reduceMq.matches) return;

    const dpr = canvas.width / Math.max(1, m.cardW);
    const w = m.cardW;
    const r = m.radius;
    const destH = m.rollH;
    const srcW = tex ? tex.width : 0;
    const srcH = tex ? tex.height : 0;
    const srcScale = srcW ? srcW / Math.max(1, w) : 1;
    const source0 = offset + m.flatH;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!tex) {
      paintFallback(offset);
      return;
    }

    card.classList.remove("is-fallback");
    if (segs.length) clearSegs();

    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.rect(0, 0, w, destH);
    ctx.fill();

    const rows = Math.max(160, Math.ceil(destH * dpr));
    for (let i = 0; i < rows; i += 1) {
      const t0 = (i / rows) * ARC;
      const t1 = ((i + 1) / rows) * ARC;
      const y0 = r * (1 - Math.cos(t0));
      const y1 = r * (1 - Math.cos(t1));
      const sliceH = Math.max(0.35, y1 - y0);
      const srcY = (source0 + r * t0) * srcScale;
      const srcSlice = Math.max(1, (r * (t1 - t0)) * srcScale);

      if (tex && srcY + srcSlice > 0 && srcY < srcH) {
        ctx.drawImage(tex, 0, srcY, srcW, srcSlice, 0, y0, w, sliceH + 0.35);
      }

      const mid = (t0 + t1) / 2;
      const lit = Math.max(0, Math.cos(mid - 0.32));
      const highlight = Math.pow(lit, 1.35);
      const shade = 0.04 + (1 - highlight) * 0.46;
      ctx.fillStyle = `rgba(8, 42, 26, ${shade})`;
      ctx.fillRect(0, y0, w, sliceH + 0.4);
      if (highlight > 0.72) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(highlight - 0.72) * 0.22})`;
        ctx.fillRect(0, y0, w, sliceH + 0.4);
      }
    }
  }

  /** @param {number} offset */
  function paintFallback(offset) {
    card.classList.add("is-fallback");
    const y = -offset;
    if (!segs.length) buildSegs();
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      const mid = FALLBACK_START + (i + 0.5) * m.stepDeg;
      seg.el.style.transform =
        `translate3d(0, ${m.radius}px, 0) rotateX(${mid}deg) translate3d(0, 0, ${m.radius}px)`;
      seg.paper.style.transform = `translate3d(0, ${y - m.flatH - i * m.segH}px, 0)`;
    }
  }

  async function capture() {
    if (capturing || reduceMq.matches) return;
    capturing = true;
    const prev = flatPaper.style.transform;
    flatPaper.style.transform = "none";
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready.catch(() => {});
      }
      await Promise.all(
        [...flatPaper.querySelectorAll("img")].map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          });
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      tex = await snapshotNode(flatPaper);
    } finally {
      flatPaper.style.transform = prev;
      capturing = false;
    }
    layout();
    paint(root.scrollTop);
  }

  function applyMode() {
    const reduced = reduceMq.matches;
    card.classList.toggle("is-reduced", reduced);
    if (reduced) {
      clearSegs();
      card.classList.remove("is-fallback");
      flatPaper.style.transform = "";
      track.style.height = "1px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    layout();
    paint(root.scrollTop);
    capture();
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
    if (!reduceMq.matches) {
      paint(root.scrollTop);
      capture();
    }
  }

  applyMode();

  root.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", relayout);
  reduceMq.addEventListener("change", applyMode);
  document.addEventListener("kaik:translated", () => {
    applyTranslations(getLocale());
    relayout();
  });
  if (document.fonts?.ready) {
    document.fonts.ready.then(relayout).catch(() => {});
  }
  window.addEventListener("load", relayout);
}
