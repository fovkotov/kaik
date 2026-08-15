import { getScrollRoot, getViewportSize, safeSessionStorage } from "../embed.js";
import {
  allLetters,
  clickPool,
  letterById,
  lettersForChar,
  loadCatalog,
  pickVariant,
} from "./catalog.js";
import { firstGrapheme, normalizeChar } from "./shared.js";
import { svgToInline } from "./svg.js";

const LAST_KEY = "kaik-dropcap-last";
const svgCache = new Map();
const session = safeSessionStorage();

function lastMap() {
  try {
    return JSON.parse(session.getItem(LAST_KEY) || "{}");
  } catch {
    return {};
  }
}

function remember(slot, id) {
  const map = lastMap();
  map[slot] = id;
  session.setItem(LAST_KEY, JSON.stringify(map));
}

async function fetchSvg(entry) {
  if (svgCache.has(entry.id)) return svgCache.get(entry.id);
  const res = await fetch(`/letters/${entry.file}?t=${entry.createdAt || ""}`);
  if (!res.ok) throw new Error("SVG missing");
  const text = await res.text();
  svgCache.set(entry.id, text);
  return text;
}

function ensurePopover() {
  let el = document.querySelector("[data-dropcap-popover]");
  if (el) return el;

  el = document.createElement("div");
  el.className = "dropcap-popover";
  el.hidden = true;
  el.dataset.dropcapPopover = "";
  el.innerHTML = `
    <p class="dropcap-popover__author" data-pop-author></p>
    <p class="dropcap-popover__stream" data-pop-stream></p>
    <span class="dropcap-popover__arrow" aria-hidden="true"></span>
  `;
  document.body.append(el);
  return el;
}

function locale() {
  return document.documentElement.lang === "ru" ? "ru" : "en";
}

function copy() {
  return locale() === "ru"
    ? { stream: (s) => `поток ${s}` }
    : { stream: (s) => `stream ${s}` };
}

function placePopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  popover.classList.add("is-open");
  const width = popover.offsetWidth;
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    getViewportSize().width - width - 8,
  );
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + 8}px`;

  const arrow = popover.querySelector(".dropcap-popover__arrow");
  if (arrow) {
    const tip = Math.min(width - 12, Math.max(12, rect.left + rect.width / 2 - left));
    arrow.style.left = `${tip}px`;
  }
}

function hidePopover() {
  const popover = document.querySelector("[data-dropcap-popover]");
  if (!popover) return;
  popover.classList.remove("is-open");
  popover.hidden = true;
  delete popover.dataset.slot;
}

function showPopover(button, entry) {
  const popover = ensurePopover();
  popover.hidden = false;
  popover.querySelector("[data-pop-author]").textContent = entry.author;
  popover.querySelector("[data-pop-stream]").textContent = copy().stream(entry.stream);
  popover.dataset.slot = button.dataset.slot;
  placePopover(popover, button);
}

async function paintGlyph(button, entry) {
  const raw = await fetchSvg(entry);
  button.innerHTML = svgToInline(raw, entry.id);
  const svg = button.querySelector("svg");
  if (!svg) throw new Error("SVG empty");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMaxYMin meet");
  const box = svg.viewBox?.baseVal;
  const hostH = button.clientHeight || 72.5;
  svg.style.height = `${hostH}px`;
  svg.style.maxWidth = "none";
  svg.style.width =
    box?.height > 0 ? `${(hostH * box.width) / box.height}px` : "auto";
  button.dataset.letterId = entry.id;
  button.dataset.char = entry.char;
  button.setAttribute(
    "aria-label",
    locale() === "ru"
      ? `Буквица ${entry.char}, ${entry.author}, поток ${entry.stream}`
      : `Drop cap ${entry.char}, ${entry.author}, stream ${entry.stream}`,
  );
}

/** Paint the first variant whose SVG loads. Prefer `excludeId` only as a skip. */
async function paintFromPool(button, pool, excludeId) {
  if (!pool.length) return null;
  const remaining = pool.slice();
  let skip = excludeId;
  while (remaining.length) {
    const entry = pickVariant(remaining, skip);
    if (!entry) return null;
    try {
      await paintGlyph(button, entry);
      return entry;
    } catch {
      const idx = remaining.findIndex((item) => item.id === entry.id);
      if (idx >= 0) remaining.splice(idx, 1);
      skip = undefined;
    }
  }
  return null;
}

export async function initDropcaps() {
  const catalog = await loadCatalog();
  const hosts = [...document.querySelectorAll("[data-dropcap]")];
  if (!hosts.length) return;

  ensurePopover();

  let mountGen = 0;
  const mount = async () => {
    const gen = ++mountGen;
    await Promise.all(
      hosts.map(async (host, index) => {
        const isI18n = host.hasAttribute("data-i18n");
        const loc = document.documentElement.getAttribute("data-locale") || locale();
        const fromLocale =
          loc === "ru"
            ? host.getAttribute("data-dropcap-ru")
            : host.getAttribute("data-dropcap-en");
        const attr = fromLocale || host.getAttribute("data-dropcap");
        const explicit = attr && attr !== "true" ? normalizeChar(attr) : "";

        if (!explicit && (isI18n || !host.hasAttribute("data-dropcap-source"))) {
          const live = host.textContent;
          if (live) host.setAttribute("data-dropcap-source", live);
        }

        const source = host.getAttribute("data-dropcap-source") || host.textContent || "";
        const first = firstGrapheme(source);
        const char = explicit || normalizeChar(first);
        const matched = char ? lettersForChar(catalog, char) : [];
        const pool = matched.length ? matched : allLetters(catalog);
        if (!pool.length) {
          if (source) host.textContent = source;
          return;
        }

        const slot = host.id || `dropcap-${index}`;
        const painted = host.querySelector(".dropcap");
        const paintedChar = painted?.dataset.char;
        const last =
          paintedChar && (!char || paintedChar === char)
            ? painted?.dataset.letterId || lastMap()[slot]
            : undefined;

        const rest =
          char && (!explicit || normalizeChar(first) === char)
            ? source.slice(first.length)
            : source;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dropcap";
        button.dataset.slot = slot;

        if (gen !== mountGen) return;
        host.replaceChildren(button, document.createTextNode(rest));
        const entry = await paintFromPool(button, pool, last);
        if (gen !== mountGen) return;
        if (!entry) {
          host.textContent = source;
          return;
        }
        remember(slot, entry.id);

        const currentEntry = () => letterById(catalog, button.dataset.letterId);

        button.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "touch") return;
          const current = currentEntry();
          if (current) showPopover(button, current);
        });

        button.addEventListener("pointerleave", (event) => {
          if (event.pointerType === "touch") return;
          hidePopover();
        });

        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const prevId = button.dataset.letterId;
          const next = await paintFromPool(button, clickPool(catalog, char), prevId);
          if (!next || next.id === prevId) return;
          remember(slot, next.id);
          showPopover(button, next);
        });
      }),
    );
  };

  await mount();
  document.addEventListener("kaik:translated", () => {
    hidePopover();
    mount();
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".dropcap, [data-dropcap-popover]")) return;
    hidePopover();
  });

  window.addEventListener(
    "resize",
    () => {
      const popover = document.querySelector("[data-dropcap-popover]");
      const slot = popover?.dataset.slot;
      if (!popover || popover.hidden || !slot) return;
      const button = document.querySelector(`.dropcap[data-slot="${slot}"]`);
      if (button) placePopover(popover, button);
    },
    { passive: true },
  );

  getScrollRoot().addEventListener("scroll", hidePopover, { passive: true });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopover();
  });
}
