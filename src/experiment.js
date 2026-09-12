import { initEmbed } from "./embed.js";
import { MOBILE_MQ } from "./tweaks.js";
import { initWorksFeed } from "./works-feed.js";
import { createWorksViewer } from "./works-viewer.js";

/* The slider CSS keys off `html.is-mobile` (set by the deck on `/`); mirror it here. */
const mobile = window.matchMedia(MOBILE_MQ);
function syncMobile() {
  document.documentElement.classList.toggle("is-mobile", mobile.matches);
}
syncMobile();
mobile.addEventListener("change", syncMobile);

initEmbed();

const feedRoot = document.querySelector("[data-works-feed]");
const viewer = createWorksViewer(document.querySelector("[data-viewer]"));

/* Click on a work opens it fullscreen; the in-cell arrows only flip slides;
   a font cell is a type tester — click the specimen and type. */
const feed = initWorksFeed({ root: feedRoot, tapNext: false, openable: true, fontTester: true });

function itemOf(cell) {
  return feed?.catalog?.items.find((entry) => entry.id === cell.dataset.workId) || null;
}

/** Works in the order the grid shows them — the viewer walks this list. */
function gridSequence() {
  return [...feedRoot.querySelectorAll("[data-work-open]")].map(itemOf).filter(Boolean);
}

/* Back from the viewer: land on the work you ended up on, not the one you opened. */
function landOn(work) {
  if (!work) return;
  const cell = feedRoot.querySelector(`[data-work-open][data-work-id="${CSS.escape(work.id)}"]`);
  if (!cell) return;
  cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  cell.focus({ preventScroll: true });
}

function openCell(cell) {
  const item = itemOf(cell);
  if (!item || !viewer) return;
  const slides = [...cell.querySelectorAll("[data-img-slider-slide]")];
  const index = Math.max(
    0,
    slides.findIndex((slide) => slide.classList.contains("is-active")),
  );
  viewer.open(item, { index, sequence: gridSequence(), returnFocus: cell, onClose: landOn });
}

feedRoot?.addEventListener("click", (event) => {
  if (event.target.closest?.("button, a, .works-feed__who")) return;
  const cell = event.target.closest?.("[data-work-open]");
  if (!cell) return;
  event.preventDefault();
  openCell(cell);
});

feedRoot?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const cell = event.target.closest?.("[data-work-open]");
  if (!cell || event.target !== cell) return;
  event.preventDefault();
  openCell(cell);
});
