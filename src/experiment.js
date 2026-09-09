import { initEmbed } from "./embed.js";
import { initGridTweaks } from "./experiment-tweaks.js";
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

/* Click on a work opens it fullscreen; the in-cell arrows only flip slides. */
const feed = initWorksFeed({ root: feedRoot, tapNext: false, openable: true });

function openCell(cell) {
  const item = feed?.catalog?.items.find((entry) => entry.id === cell.dataset.workId);
  if (!item || !viewer) return;
  const slides = [...cell.querySelectorAll("[data-img-slider-slide]")];
  const index = Math.max(
    0,
    slides.findIndex((slide) => slide.classList.contains("is-active")),
  );
  viewer.open(item, { index, returnFocus: cell });
}

feedRoot?.addEventListener("click", (event) => {
  if (event.target.closest?.("button, a")) return;
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

initGridTweaks({ feed, feedRoot, mount: document.querySelector("[data-tweaks]") });
