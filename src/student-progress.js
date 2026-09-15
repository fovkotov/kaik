/**
 * Student progress card — one source for both the flying deck (`index.html`)
 * and the split list (`list.html`).
 *
 * The face is the 2×2 preview from Figma 271:1730; each tile opens that
 * student's long sheet (251:468 / 251:970 / 252:1629 / 251:39) with the course
 * review on YouTube, weeks 1–4 and the final project, which hands off to the
 * shared experiment-2 deck in `project-viewer.js`.
 *
 * Everything renders from `STUDENTS` into `[data-progress-mount]`, so the two
 * pages can never drift apart.
 */

import { bindLightboxShot, openLightboxGallery } from "./author-lightbox.js";
import { initImgSliders } from "./img-slider.js";
import { publicUrl } from "./public-url.js";
import { openProjectViewer, projectSlidesFor } from "./project-viewer.js";
import { t } from "./scriptik.js";
import { loadWorksCatalog } from "./works/catalog.js";
import { subscribeWorksCatalog } from "./works/live.js";

const MOUNT = "[data-progress-mount]";
const CARD = "[data-work-card]";
const VIDEO = "[data-progress-video]";
const REVIEW_ID = "K06Djv3prto";

/** Figma 251:468 — the sheet content column every lettering export is cut to. */
const COL_W = 613;

const P = (file) => publicUrl(`assets/cards/progress/${file}`);
const W = (student, file) => publicUrl(`assets/cards/work/${student}/${file}`);
const FINAL = (file) => publicUrl(`works/files/${file}`);

/** Full-bleed photo. `ar` is the Figma aspect of the box, not of the file. */
const photo = (src, ar, w, h) => ({ kind: "photo", src, ar, w, h });
/** Two photos side by side; `flex` splits the row when the halves differ. */
const row = (...items) => ({ kind: "row", items });
/** Lettering sheet — SVG (or a flattened collage) that keeps its own height. */
const art = (src, w, h) => ({ kind: "art", src, w, h });
/** Nested column with its own Figma gap. */
const stack = (gap, items) => ({ kind: "stack", gap, items });

const STUDENTS = [
  {
    id: "alena",
    nick: "alenapichh",
    /** Figma 271:1761 — top-left tile. */
    tile: {
      at: [11, 258],
      thumb: [9, 44, 87, 116, P("thumb-alena.webp")],
      week1: [102, 44],
      week6: [118.56, 237],
      art: [8.902, 143, 266.099, 139.288, P("card-alena.svg")],
      arrow: [141, 47, 134, 185, -2.09, -0.26, P("arrow-alena.svg")],
    },
    start: 2610,
    cover: FINAL("wrk_9977bb38_10.webp"),
    weeks: [
      {
        n: 1,
        gap: 2,
        blocks: [
          photo(W("alena", "w1-hero.webp"), "3024 / 4032", 1226, 1636),
          row(
            photo(W("alena", "w1-a.webp"), "3024 / 4032", 611, 815),
            photo(W("alena", "w1-b.webp"), "3024 / 4032", 611, 815),
          ),
        ],
      },
      {
        n: 2,
        gap: 2,
        blocks: [
          photo(W("alena", "w2-a.webp"), "3024 / 4032", 1226, 1635),
          photo(W("alena", "w2-b.webp"), "3024 / 4032", 1226, 1635),
        ],
      },
      {
        n: 3,
        gap: 52,
        blocks: [
          art(W("alena", "w3-1.svg"), COL_W, 138),
          art(W("alena", "w3-2.svg"), COL_W, 104),
          art(W("alena", "w3-3.svg"), COL_W, 298),
        ],
      },
      {
        n: 4,
        gap: 52,
        blocks: [
          art(W("alena", "w4-1.svg"), COL_W, 169),
          art(W("alena", "w4-2.svg"), COL_W, 215),
          art(W("alena", "w4-3.svg"), COL_W, 240),
          art(W("alena", "w4-4.svg"), COL_W, 134),
          art(W("alena", "w4-5.svg"), COL_W, 231),
          art(W("alena", "w4-6.svg"), COL_W, 65),
          art(W("alena", "w4-7.svg"), COL_W, 177),
          art(W("alena", "w4-8.svg"), COL_W, 124),
          art(W("alena", "w4-9.svg"), COL_W, 206),
          art(W("alena", "w4-10.svg"), COL_W, 228),
        ],
      },
    ],
  },
  {
    id: "roma",
    nick: "rameoky",
    /** Figma 271:1906 — top-right tile. */
    tile: {
      at: [299.875, 258],
      thumb: [9, 44, 87, 116, P("thumb-roma.webp")],
      week1: [102, 44],
      week6: [118.56, 170],
      art: [3, 181, 278, 101, P("card-roma.svg")],
      arrow: [141, 47, 134, 120, -2.09, -0.41, P("arrow-roma.svg")],
    },
    start: 1710,
    cover: FINAL("wrk_4d695bf9_7.webp"),
    weeks: [
      {
        n: 1,
        gap: 2,
        blocks: [photo(W("roma", "w1-a.webp"), "1920 / 2560", 1226, 1636)],
      },
      {
        n: 2,
        gap: 2,
        blocks: [
          row(
            photo(W("roma", "w2-a.webp"), "1920 / 2560", 611, 815),
            photo(W("roma", "w2-b.webp"), "1920 / 2560", 611, 815),
          ),
        ],
      },
      {
        n: 3,
        gap: 0,
        blocks: [
          photo(W("roma", "w3-hero.webp"), "3024 / 4032", 1226, 1635),
          art(W("roma", "w3-collage-1.webp"), 1226, 791),
          art(W("roma", "w3-collage-2.webp"), 1226, 876),
          stack(16, [
            art(W("roma", "w3-01.svg"), COL_W, 286),
            art(W("roma", "w3-02.svg"), COL_W, 287),
            art(W("roma", "w3-03.svg"), COL_W, 261),
            art(W("roma", "w3-04.svg"), COL_W, 265),
            art(W("roma", "w3-05.svg"), COL_W, 230),
            art(W("roma", "w3-06.svg"), COL_W, 265),
            art(W("roma", "w3-07.svg"), COL_W, 271),
            art(W("roma", "w3-08.svg"), COL_W, 251),
          ]),
        ],
      },
      {
        n: 4,
        gap: 16,
        blocks: [
          art(W("roma", "w4-09.svg"), COL_W, 286),
          art(W("roma", "w4-10.svg"), COL_W, 226),
          art(W("roma", "w4-11.svg"), COL_W, 368),
          art(W("roma", "w4-12.svg"), COL_W, 156),
        ],
      },
    ],
  },
  {
    id: "yan",
    nick: "l200kmhinthewronglane",
    /** Figma 271:1982 — bottom-left tile. */
    tile: {
      at: [11, 547],
      thumb: [8, 41, 55, 73, P("thumb-yan.webp")],
      week1: [67, 41],
      week6: [117.56, 104],
      art: [4.555, 116, 275.446, 167.655, P("card-yan.svg")],
      arrow: [100, 45, 174, 57, -1.61, -0.85, P("arrow-yan.svg")],
    },
    start: 1024,
    cover: FINAL("wrk_47e05e10_0.webp"),
    weeks: [
      {
        n: 1,
        gap: 2,
        blocks: [
          photo(W("yan", "w1-a.webp"), "3024 / 4032", 1200, 1600),
          row(
            photo(W("yan", "w1-b.webp"), "3024 / 4032", 1200, 1600),
            photo(W("yan", "w1-c.webp"), "3024 / 4032", 1200, 1600),
          ),
          /* Figma 252:2285 — a 391-wide landscape frame beside a 220-wide portrait. */
          row(
            { ...photo(W("yan", "w1-d.webp"), "391 / 293", 1600, 1200), flex: 391 },
            { ...photo(W("yan", "w1-e.webp"), "3024 / 4032", 1200, 1600), flex: 220 },
          ),
          row(
            photo(W("yan", "w1-f.webp"), "3024 / 4032", 1200, 1600),
            photo(W("yan", "w1-g.webp"), "3024 / 4032", 1200, 1600),
          ),
        ],
      },
      {
        n: 2,
        gap: 2,
        blocks: [
          photo(W("yan", "w2-a.webp"), "3024 / 4032", 1200, 1600),
          row(
            photo(W("yan", "w2-b.webp"), "3024 / 4032", 1200, 1600),
            photo(W("yan", "w2-c.webp"), "3024 / 4032", 1200, 1600),
          ),
          photo(W("yan", "w2-d.webp"), "4032 / 3024", 1600, 1200),
          row(
            photo(W("yan", "w2-f.webp"), "3024 / 4032", 1200, 1600),
            photo(W("yan", "w2-a.webp"), "3024 / 4032", 1200, 1600),
          ),
        ],
      },
      {
        n: 3,
        gap: 52,
        blocks: [
          art(W("yan", "w3-1.svg"), COL_W, 192),
          art(W("yan", "w3-2.svg"), COL_W, 218),
          art(W("yan", "w3-3.svg"), COL_W, 298),
          art(W("yan", "w3-4.svg"), COL_W, 279),
          art(W("yan", "w3-5.svg"), COL_W, 222),
        ],
      },
      {
        n: 4,
        gap: 52,
        blocks: [
          art(W("yan", "w4-1.svg"), COL_W, 330),
          art(W("yan", "w4-2.svg"), COL_W, 345),
          art(W("yan", "w4-3.svg"), COL_W, 270),
          art(W("yan", "w4-4.svg"), COL_W, 189),
          art(W("yan", "w4-5.svg"), COL_W, 186),
        ],
      },
    ],
  },
  {
    id: "alyona",
    nick: "alenuchotam",
    /** Figma 271:1965 — bottom-right tile. */
    tile: {
      at: [299.875, 547],
      thumb: [9.125, 44, 64, 86, P("thumb-alyona.webp")],
      week1: [79.125, 44],
      week6: [118.56, 137],
      art: [9.431, 139.522, 265.693, 140.245, P("card-alyona.svg")],
      arrow: [114.125, 47, 161, 87, -1.74, -0.56, P("arrow-alyona.svg")],
    },
    start: 2210,
    cover: FINAL("wrk_e6dd2cde_0.webp"),
    weeks: [
      {
        n: 1,
        gap: 2,
        blocks: [
          photo(W("alyona", "w1-a.webp"), "891 / 1280", 891, 1280),
          row(
            photo(W("alyona", "w1-b.webp"), "891 / 1280", 611, 875),
            photo(W("alyona", "w1-c.webp"), "891 / 1280", 611, 851),
          ),
          photo(W("alyona", "w1-d.webp"), "929 / 1280", 929, 1280),
        ],
      },
      {
        n: 2,
        gap: 2,
        blocks: [
          photo(W("alyona", "w2-a.webp"), "1175 / 1280", 1175, 1280),
          photo(W("alyona", "w2-b.webp"), "1280 / 917", 1226, 878),
          row(
            photo(W("alyona", "w2-c.webp"), "891 / 1280", 611, 889),
            photo(W("alyona", "w2-d.webp"), "891 / 1280", 611, 891),
          ),
        ],
      },
      {
        n: 3,
        gap: 16,
        blocks: [
          art(W("alyona", "w3-1.svg"), COL_W, 119),
          art(W("alyona", "w3-2.svg"), COL_W, 188),
          art(W("alyona", "w3-3.svg"), COL_W, 524),
          art(W("alyona", "w3-4.svg"), COL_W, 205),
        ],
      },
      {
        n: 4,
        gap: 52,
        blocks: [
          art(W("alyona", "w4-1.svg"), COL_W, 218),
          art(W("alyona", "w4-2.svg"), COL_W, 115),
          art(W("alyona", "w4-3.svg"), COL_W, 291),
          art(W("alyona", "w4-4.svg"), COL_W, 229),
          art(W("alyona", "w4-5.svg"), COL_W, 183),
          art(W("alyona", "w4-6.svg"), COL_W, 306),
          art(W("alyona", "w4-7.svg"), COL_W, 92),
        ],
      },
    ],
  },
];

export const PROGRESS_STUDENT_IDS = STUDENTS.map((student) => student.id);

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tileHtml(student) {
  const { at, thumb, week1, week6, arrow } = student.tile;
  const [ax, ay, aw, ah, artSrc] = student.tile.art;
  const [tl, tt, tw, th, thumbSrc] = thumb;
  const [rl, rt, rw, rh, rx, ry, arrowSrc] = arrow;
  return `<div
        class="progress-card__sheet"
        data-work-open="${esc(student.id)}"
        role="button"
        tabindex="0"
        data-i18n-aria="progress.open.${esc(student.id)}"
        aria-label="${esc(t(`progress.open.${student.id}`))}"
        style="--l: ${at[0]}; --t: ${at[1]}"
      >
        <p class="progress-card__who">
          <span data-i18n="name.progress.${esc(student.id)}">${esc(t(`name.progress.${student.id}`))}</span>
          <span class="progress-card__ig">@${esc(student.nick)}</span>
        </p>
        <div class="progress-card__thumb" style="--l: ${tl}; --t: ${tt}; --w: ${tw}; --h: ${th}">
          <img src="${esc(thumbSrc)}" alt="" width="400" height="533" loading="lazy" decoding="async" draggable="false" />
        </div>
        <p class="progress-card__week" style="--l: ${week1[0]}; --t: ${week1[1]}" data-i18n="progress.week1">${esc(t("progress.week1"))}</p>
        <p class="progress-card__week progress-card__week--end" style="--cx: ${week6[0]}; --t: ${week6[1]}" data-i18n="progress.week6">${esc(t("progress.week6"))}</p>
        <div class="progress-card__arrow" style="--l: ${rl}; --t: ${rt}; --w: ${rw}; --h: ${rh}; --ax: ${rx}%; --ay: ${ry}%">
          <img src="${esc(arrowSrc)}" alt="" draggable="false" />
        </div>
        <div class="progress-card__art" style="--l: ${ax}; --t: ${ay}; --w: ${aw}; --h: ${ah}">
          <img src="${esc(artSrc)}" alt="" draggable="false" />
        </div>
        <span class="progress-card__expand" aria-hidden="true">
          <img src="${esc(P("expand.svg"))}" alt="" width="15" height="14" draggable="false" />
        </span>
      </div>`;
}

function faceHtml() {
  return `<div class="work-card__face">
      <div class="progress-card">
        <p class="progress-card__title" data-i18n="progress.title">${esc(t("progress.title"))}</p>
        <div class="progress-card__illust" aria-hidden="true">
          <img src="${esc(P("illust.svg"))}" alt="" width="352" height="189" draggable="false" />
        </div>
        ${STUDENTS.map(tileHtml).join("\n        ")}
      </div>
    </div>`;
}

function navHtml() {
  const chevron = esc(publicUrl("assets/cards/work/nav-chevron.svg"));
  const mute = esc(publicUrl("assets/cards/work/sound-off.svg"));
  const unmute = esc(publicUrl("assets/cards/work/sound-on.svg"));
  return `<div class="work-card__nav" data-work-student-nav>
      <button type="button" class="work-card__nav-btn work-card__nav-btn--prev" data-work-student-prev data-i18n-aria="work.prev" aria-label="${esc(t("work.prev"))}">
        <img class="work-card__nav-chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
      </button>
      <button type="button" class="work-card__nav-btn work-card__nav-btn--next" data-work-student-next data-i18n-aria="work.next" aria-label="${esc(t("work.next"))}">
        <img class="work-card__nav-chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
      </button>
      <div class="work-card__nav-end">
        <button type="button" class="work-card__nav-btn work-card__sound" data-progress-sound aria-pressed="false" data-i18n-aria="format.sound.on" aria-label="${esc(t("format.sound.on"))}">
          <img class="work-card__nav-chevron work-card__sound-icon work-card__sound-icon--off" src="${mute}" alt="" width="20" height="20" draggable="false" />
          <img class="work-card__nav-chevron work-card__sound-icon work-card__sound-icon--on" src="${unmute}" alt="" width="20" height="20" draggable="false" />
        </button>
        <button type="button" class="work-card__close article-close" data-article-close hidden data-i18n-aria="work.close" aria-label="${esc(t("work.close"))}">
          <img class="article-close__icon" src="${esc(publicUrl("assets/frame-2136141284.svg"))}" alt="" width="24" height="24" />
        </button>
      </div>
    </div>`;
}

function blockHtml(block) {
  if (block.kind === "row") {
    return `<div class="work-card__photos">${block.items.map(blockHtml).join("")}</div>`;
  }
  if (block.kind === "stack") {
    return `<div class="work-card__marks" style="--gap: ${block.gap}">${block.items.map(blockHtml).join("")}</div>`;
  }
  if (block.kind === "art") {
    return `<div class="work-card__mark">
              <img src="${esc(block.src)}" alt="" width="${block.w}" height="${block.h}" loading="lazy" decoding="async" draggable="false" />
            </div>`;
  }
  const grow = block.flex ? `; flex-grow: ${block.flex}` : "";
  return `<div class="work-card__photo" data-progress-shot style="--ar: ${block.ar}${grow}">
              <img src="${esc(block.src)}" alt="" width="${block.w}" height="${block.h}" loading="lazy" decoding="async" draggable="false" />
            </div>`;
}

function weekHtml(week) {
  return `<section class="work-card__week">
          <h2 class="work-card__week-head">
            <span class="work-card__week-title" data-i18n="work.week${week.n}">${esc(t(`work.week${week.n}`))}</span>
          </h2>
          <div class="work-card__marks" style="--gap: ${week.gap}">${week.blocks.map(blockHtml).join("")}</div>
        </section>`;
}

function finalCoverHtml(student, slide) {
  const src = slide?.src || student.cover;
  const w = slide?.width || 1600;
  const h = slide?.height || 900;
  return `<div class="work-card__photo work-card__photo--final" style="--ar: 16 / 9" data-progress-final="${esc(student.nick)}" data-project-viewer="${esc(student.nick)}" role="button" tabindex="0">
            <img src="${esc(src)}" alt="" width="${w}" height="${h}" loading="lazy" decoding="async" draggable="false" />
          </div>`;
}

function finalSliderHtml(student, slides) {
  const chevron = esc(publicUrl("assets/cards/history/chevron.svg"));
  const many = slides.length > 12 ? " works-feed__slider--many" : "";
  const figures = slides
    .map(
      (slide, i) =>
        `<figure class="img-slider__slide${i === 0 ? " is-active" : ""}" data-img-slider-slide>
          <img src="${esc(slide.src)}" alt="" width="${slide.width || 1600}" height="${slide.height || 900}" loading="${i ? "lazy" : "eager"}" decoding="async" draggable="false" />
        </figure>`,
    )
    .join("");
  return `<div class="img-slider work-card__final${many}" data-img-slider data-progress-final="${esc(student.nick)}" data-project-viewer="${esc(student.nick)}">
            ${figures}
            <button type="button" class="img-slider__nav img-slider__nav--prev" data-img-slider-prev data-i18n-aria="history.prev" aria-label="${esc(t("history.prev"))}">
              <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
            </button>
            <button type="button" class="img-slider__nav img-slider__nav--next" data-img-slider-next data-i18n-aria="history.next" aria-label="${esc(t("history.next"))}">
              <img class="img-slider__chevron" src="${chevron}" alt="" width="20" height="20" draggable="false" />
            </button>
          </div>`;
}

function fillFinal(slot, items) {
  const nick = slot.getAttribute("data-progress-final") || "";
  const student = STUDENTS.find((s) => s.nick === nick);
  if (!student) return;
  const slides = projectSlidesFor(items, nick);
  const key = slides.map((s) => s.src).join("\n") || student.cover;
  if (slot.getAttribute("data-final-key") === key) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = slides.length > 1 ? finalSliderHtml(student, slides) : finalCoverHtml(student, slides[0]);
  const next = wrap.firstElementChild;
  next.setAttribute("data-final-key", key);
  slot.replaceWith(next);
  if (slides.length > 1) initImgSliders(next.parentElement);
  else bindFinal(next);
}

function hydrateFinals(scope) {
  const paint = async () => {
    const catalog = await loadWorksCatalog();
    scope.querySelectorAll("[data-progress-final]").forEach((slot) => {
      fillFinal(slot, catalog.items || []);
    });
  };
  paint();
  subscribeWorksCatalog(paint);
}

function sheetHtml(student) {
  return `<div class="work-card__full work-card__full--${esc(student.id)}" data-work-full="${esc(student.id)}">
        <div class="work-card__intro">
          <header class="work-card__head">
            <p class="work-card__who">
              <span data-i18n="name.progress.${esc(student.id)}">${esc(t(`name.progress.${student.id}`))}</span>
              <a class="work-card__ig" data-work-ig href="https://www.instagram.com/${esc(student.nick)}/" target="_top" rel="noopener">@${esc(student.nick)}</a>
            </p>
            <p class="work-card__blurb" data-i18n="work.review">${esc(t("work.review"))}</p>
          </header>
          <div class="work-card__video" data-progress-video data-video-start="${student.start}">
            <div class="work-card__frame" data-progress-frame></div>
          </div>
        </div>
        ${student.weeks.map(weekHtml).join("\n        ")}
        <section class="work-card__week">
          <h2 class="work-card__week-head">
            <span class="work-card__week-title" data-i18n="work.final.ready">${esc(t("work.final.ready"))}</span>
          </h2>
          ${finalCoverHtml(student)}
        </section>
      </div>`;
}

function embedUrl(start) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    start: String(start),
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${REVIEW_ID}?${params}`;
}

/** Commands only reach the player once it exists, so keep the frame around. */
function tellPlayer(frame, func) {
  frame?.contentWindow?.postMessage(
    JSON.stringify({ event: "command", func, args: [] }),
    "*",
  );
}

function soundBtn(root) {
  return root.querySelector("[data-progress-sound]");
}

function syncSound(root, on) {
  const btn = soundBtn(root);
  if (!btn) return;
  const key = on ? "format.sound.off" : "format.sound.on";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("data-i18n-aria", key);
  btn.setAttribute("aria-label", t(key));
}

/**
 * One player at a time. Opening a student builds their iframe; leaving tears
 * it down so a backgrounded review never keeps streaming.
 */
function setVideoActive(media, on) {
  const frame = media.querySelector("iframe");
  if (!on) {
    frame?.remove();
    media.classList.remove("is-playing");
    return;
  }
  if (frame) return;
  const next = document.createElement("iframe");
  next.className = "work-card__embed";
  next.src = embedUrl(media.getAttribute("data-video-start") || "0");
  next.title = t("work.review");
  next.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  next.setAttribute("allowfullscreen", "");
  next.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  next.loading = "lazy";
  (media.querySelector("[data-progress-frame]") || media).append(next);
  media.classList.add("is-playing");
}

function bindSound(mount) {
  const btn = soundBtn(mount);
  btn?.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  btn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const card = mount.closest(CARD) || mount;
    const id = card.getAttribute("data-work-student") || "";
    const frame = card.querySelector(`[data-work-full="${id}"] iframe`);
    if (!frame) return;
    const on = btn.getAttribute("aria-pressed") !== "true";
    tellPlayer(frame, on ? "unMute" : "mute");
    syncSound(mount, on);
  });
}

/** An open sheet is the only place a photo tap means "show me this bigger". */
function sheetOpen(el) {
  return Boolean(el.closest(".is-program-open, .is-list-open"));
}

/** Every photo in a sheet shares one gallery, so prev/next walks the weeks. */
function bindShots(sheet) {
  const shots = [...sheet.querySelectorAll("[data-progress-shot]")];
  const items = shots.map((shot) => {
    const img = shot.querySelector("img");
    return {
      src: img?.currentSrc || img?.src || "",
      width: Number(img?.getAttribute("width")) || 1600,
      height: Number(img?.getAttribute("height")) || 1200,
    };
  });
  shots.forEach((shot, index) => {
    if (shot.tabIndex < 0) shot.tabIndex = 0;
    shot.setAttribute("role", "button");
    bindLightboxShot(shot, () => (sheetOpen(shot) && items.length ? { items, index } : null));
  });
}

/**
 * Same press-vs-scroll gate the collage shots use: a swipe scrolls the sheet,
 * a tap runs `go`. The final cover needs its own because it always routes to
 * the project viewer, never to the image lightbox.
 */
function bindTap(el, go) {
  let press = null;

  const clear = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", clear);
    press = null;
  };

  const onMove = (event) => {
    if (!press || event.pointerId !== press.id || press.moved) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) press.moved = true;
  };

  const onUp = (event) => {
    if (!press || event.pointerId !== press.id) return;
    onMove(event);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", clear);
    // Keep `press` until click so a scroll-swipe cannot fire the tap.
  };

  el.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button && event.button !== 0) return;
      clear();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", clear);
    },
    true,
  );

  el.addEventListener(
    "click",
    (event) => {
      const moved = Boolean(press?.moved);
      clear();
      if (moved || !sheetOpen(el)) return;
      event.preventDefault();
      event.stopPropagation();
      go();
    },
    true,
  );

  el.addEventListener("keydown", (event) => {
    if (event.target !== el) return;
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    event.stopPropagation();
    go();
  });
}

/** The final cover hands off to the shared experiment-2 deck. */
function bindFinal(final) {
  if (!final || final.hasAttribute("data-img-slider")) return;
  const img = final.querySelector("img");
  bindTap(final, () => {
    openProjectViewer(final.getAttribute("data-project-viewer"), final).then((opened) => {
      const src = img?.currentSrc || img?.src || "";
      if (opened || !src) return;
      openLightboxGallery([{ src, width: 1600, height: 900 }], 0, final);
    });
  });
}

/**
 * The card owns the open state (`is-work-open` + `data-work-student`); the
 * players just follow it. Works the same whether program-modal (deck) or
 * list.js drives the attributes.
 */
function watchCard(card, mount) {
  let last = "";
  const sync = () => {
    const open = card.classList.contains("is-work-open");
    const current = card.getAttribute("data-work-student") || "";
    card.querySelectorAll(VIDEO).forEach((media) => {
      const id = media.closest("[data-work-full]")?.getAttribute("data-work-full") || "";
      setVideoActive(media, open && id === current);
    });
    const key = open ? current : "";
    if (key !== last) {
      last = key;
      syncSound(mount, false);
    }
  };
  new MutationObserver(sync).observe(card, {
    attributes: true,
    attributeFilter: ["class", "data-work-student"],
  });
  sync();
}

export function initStudentProgress(scope = document) {
  const mounts = [...scope.querySelectorAll(MOUNT)];
  if (!mounts.length) return;

  mounts.forEach((mount) => {
    mount.classList.add("work-card");
    mount.innerHTML = `${faceHtml()}
    ${navHtml()}
    ${STUDENTS.map(sheetHtml).join("\n    ")}`;

    bindSound(mount);
    mount.querySelectorAll("[data-work-full]").forEach((sheet) => {
      bindShots(sheet);
      bindFinal(sheet.querySelector("[data-progress-final]"));
    });

    const card = mount.closest(CARD);
    if (card) watchCard(card, mount);
  });

  hydrateFinals(scope);

  document.addEventListener("kaik:translated", () => {
    mounts.forEach((mount) => {
      const btn = soundBtn(mount);
      syncSound(mount, btn?.getAttribute("aria-pressed") === "true");
    });
  });
}
