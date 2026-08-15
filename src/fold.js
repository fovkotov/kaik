import { PROGRAM_HTML } from "./program-content.js";
import { t } from "./scriptik.js";
import "./program.css";

export const FOLD = {
  flaps: 2,

  widthPct: 0.78,
  topH: 0.7,
  flapAH: 0.48,
  flapBH: 0.48,
  topPct: 18,
  sheetZ: -3,
  overlap: -1,

  perspective: 900,
  perspX: 50,
  perspY: 100,

  aX: 78,
  aY: -6,
  aZ: -10,
  aTx: 0,
  aTy: 0,
  aTz: 12,
  aOx: 50,
  aOy: 0,
  aOpenX: 0,
  aOpenY: 0,
  aOpenZ: 0,
  aMs: 850,

  bX: 86,
  bY: 8,
  bZ: 8,
  bTx: 0,
  bTy: 0,
  bTz: 8,
  bOx: 50,
  bOy: 0,
  bOpenX: 0,
  bOpenY: 0,
  bOpenZ: 0,
  bMs: 850,
  bDelay: 0,

  heightMs: 800,
  ease: "cubic-bezier(0.22, 1, 0.32, 1)",

  paper: "#2bb673",
  paperBack: "#1c7a4c",
  fontPx: 14,
  padEm: 0.85,
};

export const FOLD_DEFAULTS = { ...FOLD };
const STORAGE_KEY = "kaik-fold-tweaks-v3";

export const FOLD_FIELDS = [
  {
    group: "Лист",
    items: [
      { key: "flaps", label: "число сгибов", min: 1, max: 2, step: 1 },
      { key: "widthPct", label: "ширина (× карточки)", min: 0.3, max: 1.2, step: 0.01 },
      { key: "topH", label: "высота верха (× ширины листа)", min: 0.2, max: 1.4, step: 0.01 },
      { key: "flapAH", label: "высота створки A (× ширины)", min: 0.15, max: 1.2, step: 0.01 },
      { key: "flapBH", label: "высота створки B (× ширины)", min: 0.15, max: 1.2, step: 0.01 },
      { key: "topPct", label: "отступ сверху карточки (%)", min: 0, max: 50, step: 0.5 },
      { key: "sheetZ", label: "поворот всего листа Z (°)", min: -20, max: 20, step: 0.1 },
      { key: "overlap", label: "нахлёст стыка (px)", min: -4, max: 4, step: 0.5 },
    ],
  },
  {
    group: "Камера",
    items: [
      { key: "perspective", label: "perspective (px)", min: 200, max: 2800, step: 10 },
      { key: "perspX", label: "perspective-origin X (%)", min: 0, max: 100, step: 1 },
      { key: "perspY", label: "perspective-origin Y (% высоты верха, 100 = стык)", min: 0, max: 200, step: 1 },
    ],
  },
  {
    group: "Створка A — закрыта",
    items: [
      { key: "aX", label: "rotateX к нам (°)", min: -180, max: 180, step: 0.5 },
      { key: "aY", label: "rotateY (°)", min: -80, max: 80, step: 0.5 },
      { key: "aZ", label: "rotateZ (°)", min: -45, max: 45, step: 0.1 },
      { key: "aTx", label: "translateX (px)", min: -40, max: 40, step: 0.5 },
      { key: "aTy", label: "translateY (px)", min: -40, max: 40, step: 0.5 },
      { key: "aTz", label: "translateZ (px)", min: -80, max: 80, step: 0.5 },
      { key: "aOx", label: "transform-origin X (%)", min: 0, max: 100, step: 1 },
      { key: "aOy", label: "transform-origin Y (%)", min: 0, max: 100, step: 1 },
    ],
  },
  {
    group: "Створка A — открыта",
    items: [
      { key: "aOpenX", label: "rotateX (°)", min: -180, max: 180, step: 0.5 },
      { key: "aOpenY", label: "rotateY (°)", min: -80, max: 80, step: 0.5 },
      { key: "aOpenZ", label: "rotateZ (°)", min: -45, max: 45, step: 0.1 },
      { key: "aMs", label: "длительность (ms)", min: 0, max: 2500, step: 10 },
    ],
  },
  {
    group: "Створка B — закрыта",
    items: [
      { key: "bX", label: "rotateX к нам (°)", min: -180, max: 180, step: 0.5 },
      { key: "bY", label: "rotateY (°)", min: -80, max: 80, step: 0.5 },
      { key: "bZ", label: "rotateZ (°)", min: -45, max: 45, step: 0.1 },
      { key: "bTx", label: "translateX (px)", min: -40, max: 40, step: 0.5 },
      { key: "bTy", label: "translateY (px)", min: -40, max: 40, step: 0.5 },
      { key: "bTz", label: "translateZ (px)", min: -80, max: 80, step: 0.5 },
      { key: "bOx", label: "transform-origin X (%)", min: 0, max: 100, step: 1 },
      { key: "bOy", label: "transform-origin Y (%)", min: 0, max: 100, step: 1 },
    ],
  },
  {
    group: "Створка B — открыта",
    items: [
      { key: "bOpenX", label: "rotateX (°)", min: -180, max: 180, step: 0.5 },
      { key: "bOpenY", label: "rotateY (°)", min: -80, max: 80, step: 0.5 },
      { key: "bOpenZ", label: "rotateZ (°)", min: -45, max: 45, step: 0.1 },
      { key: "bMs", label: "длительность (ms)", min: 0, max: 2500, step: 10 },
      { key: "bDelay", label: "задержка относительно A (ms)", min: 0, max: 1200, step: 10 },
    ],
  },
  {
    group: "Анимация",
    items: [
      { key: "heightMs", label: "рост высоты листа (ms)", min: 0, max: 2500, step: 10 },
      {
        key: "ease",
        label: "easing",
        type: "select",
        options: [
          { value: "linear", label: "linear" },
          { value: "ease", label: "ease" },
          { value: "ease-in", label: "ease-in" },
          { value: "ease-out", label: "ease-out" },
          { value: "cubic-bezier(0.22, 1.12, 0.32, 1)", label: "out back" },
          { value: "cubic-bezier(0.22, 1, 0.32, 1)", label: "out expo-ish (текущий)" },
          { value: "cubic-bezier(0.65, 0, 0.35, 1)", label: "inOut cubic" },
          { value: "cubic-bezier(0.55, 0.06, 0.72, 0.19)", label: "in cubic (закрытие)" },
        ],
      },
    ],
  },
  {
    group: "Бумага",
    items: [
      { key: "paper", label: "лицо", type: "color" },
      { key: "paperBack", label: "оборот", type: "color" },
      { key: "fontPx", label: "кегль (px)", min: 10, max: 28, step: 1 },
      { key: "padEm", label: "внутренние поля (em)", min: 0.2, max: 2.4, step: 0.05 },
    ],
  },
];

function loadFold() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === "object") Object.assign(FOLD, data);
  } catch {
    // ignore
  }
}

export function saveFold() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(FOLD));
  } catch {
    // ignore
  }
}

export function resetFold() {
  Object.assign(FOLD, FOLD_DEFAULTS);
  applyFoldParams();
  saveFold();
}

function fillStrips(sheet) {
  const source = document.querySelector("[data-program-source]");
  const html = source?.innerHTML.trim() || PROGRAM_HTML;
  sheet.querySelectorAll("[data-sheet-strip]").forEach((el) => {
    if (el.innerHTML.trim()) return;
    el.innerHTML = html;
  });
}

function foldedSegs(sheet) {
  const w = sheet.offsetWidth || 1;
  return {
    top: w * FOLD.topH,
    a: w * FOLD.flapAH,
    b: sheet.classList.contains("is-single") ? 0 : w * FOLD.flapBH,
  };
}

function contentHeight(sheet) {
  const strip = sheet.querySelector("[data-sheet-strip]");
  return strip?.scrollHeight || 0;
}

function applySegs(sheet, a, b) {
  sheet.style.setProperty("--seg-a", `${a}px`);
  sheet.style.setProperty("--seg-b", `${b}px`);
}

export function applyFoldParams() {
  const p = FOLD;
  document.querySelectorAll("[data-sheet]").forEach((el) => {
    el.classList.toggle("is-single", p.flaps < 2);
    const vars = {
      "--fold-w": p.widthPct,
      "--fold-top-h": p.topH,
      "--fold-flap-a-h": p.flapAH,
      "--fold-flap-b-h": p.flapBH,
      "--fold-top": p.topPct,
      "--fold-sheet-z": p.sheetZ,
      "--fold-overlap": p.overlap,
      "--fold-perspective": p.perspective,
      "--fold-persp-x": p.perspX,
      "--fold-persp-y": p.perspY,
      "--fold-a-x": p.aX,
      "--fold-a-y": p.aY,
      "--fold-a-z": p.aZ,
      "--fold-a-tx": p.aTx,
      "--fold-a-ty": p.aTy,
      "--fold-a-tz": p.aTz,
      "--fold-a-ox": p.aOx,
      "--fold-a-oy": p.aOy,
      "--fold-a-open-x": p.aOpenX,
      "--fold-a-open-y": p.aOpenY,
      "--fold-a-open-z": p.aOpenZ,
      "--fold-a-ms": p.aMs,
      "--fold-b-x": p.bX,
      "--fold-b-y": p.bY,
      "--fold-b-z": p.bZ,
      "--fold-b-tx": p.bTx,
      "--fold-b-ty": p.bTy,
      "--fold-b-tz": p.bTz,
      "--fold-b-ox": p.bOx,
      "--fold-b-oy": p.bOy,
      "--fold-b-open-x": p.bOpenX,
      "--fold-b-open-y": p.bOpenY,
      "--fold-b-open-z": p.bOpenZ,
      "--fold-b-ms": p.bMs,
      "--fold-b-delay": p.bDelay,
      "--fold-height-ms": p.heightMs,
      "--fold-font": p.fontPx,
      "--fold-pad": p.padEm,
    };
    Object.entries(vars).forEach(([name, value]) => {
      el.style.setProperty(name, String(value));
    });
    el.style.setProperty("--fold-ease", p.ease);
    el.style.setProperty("--fold-paper", p.paper);
    el.style.setProperty("--fold-paper-back", p.paperBack);
    fillStrips(el);
    if (!el.classList.contains("is-open") && !el.classList.contains("is-flying")) {
      const segs = foldedSegs(el);
      applySegs(el, segs.a, segs.b);
    }
  });
}

function syncAria(el, open) {
  const key = open ? "fold.close" : "fold.open";
  el.setAttribute("aria-expanded", open ? "true" : "false");
  el.setAttribute("data-i18n-aria", key);
  el.setAttribute("aria-label", t(key));
}

export function initFold() {
  loadFold();
  applyFoldParams();

  const layer = document.querySelector("[data-sheet-layer]");
  const backdrop = document.querySelector("[data-sheet-backdrop]");
  if (!layer || !backdrop) return;

  const FLY_MS = 980;
  const FLY_EASE = "cubic-bezier(0.22, 1, 0.32, 1)";

  /** @type {"idle" | "opening" | "open" | "closing"} */
  let phase = "idle";
  /** @type {HTMLElement | null} */
  let active = null;
  /** @type {HTMLElement | null} */
  let host = null;
  /** @type {HTMLElement | null} */
  let ghost = null;
  let flyTimer = 0;

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function layoutBox(el) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = el.getBoundingClientRect();
    return {
      left: r.left + (r.width - w) / 2,
      top: r.top + (r.height - h) / 2,
      width: w,
      height: h,
    };
  }

  function modalPos(width) {
    const frame = document.documentElement;
    const vw = Number.parseFloat(frame.style.getPropertyValue("--frame-w")) || window.innerWidth;
    return { left: (vw - width) / 2, top: 0 };
  }

  function setOpen(sheet, open) {
    sheet.classList.toggle("is-open", open);
    syncAria(sheet, open);
  }

  function pin(sheet, pos, rot, withTransition) {
    sheet.style.setProperty("--fly-l", `${pos.left}px`);
    sheet.style.setProperty("--fly-t", `${pos.top}px`);
    sheet.style.setProperty("--fly-rot", `${rot}deg`);
    sheet.style.setProperty("--fly-ms", withTransition ? `${FLY_MS}ms` : "0ms");
    sheet.style.setProperty("--fly-ease", FLY_EASE);
    const ms = withTransition ? String(FLY_MS) : "0";
    sheet.style.setProperty("--fold-a-ms", ms);
    sheet.style.setProperty("--fold-b-ms", ms);
    sheet.style.setProperty("--fold-b-delay", withTransition ? String(Math.round(FLY_MS * 0.08)) : "0");
    sheet.style.setProperty("--fold-height-ms", ms);
  }

  function clearFly(sheet) {
    ["--fly-l", "--fly-t", "--fly-rot", "--fly-ms", "--fly-ease"].forEach((name) => {
      sheet.style.removeProperty(name);
    });
    applyFoldParams();
  }

  function afterFly(sheet, fn) {
    window.clearTimeout(flyTimer);
    if (reduceMotion()) {
      fn();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      sheet.removeEventListener("transitionend", onEnd);
      fn();
    };
    const onEnd = (event) => {
      if (event.target !== sheet) return;
      if (event.propertyName !== "top" && event.propertyName !== "height") return;
      finish();
    };
    sheet.addEventListener("transitionend", onEnd);
    flyTimer = window.setTimeout(finish, FLY_MS);
  }

  function openHeights(sheet) {
    const folded = foldedSegs(sheet);
    const content = contentHeight(sheet);
    const rest = Math.max(folded.a + folded.b, content - folded.top);
    if (sheet.classList.contains("is-single")) {
      return { a: rest, b: 0 };
    }
    const a = rest / 2;
    return { a, b: rest - a };
  }

  function openSheet(sheet) {
    if (phase !== "idle") return;
    phase = "opening";
    window.clearTimeout(flyTimer);
    host = sheet.parentElement;
    active = sheet;
    fillStrips(sheet);

    const first = layoutBox(sheet);
    const cs = getComputedStyle(sheet);
    ghost = document.createElement("span");
    ghost.className = "sheet-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${first.width}px`;
    ghost.style.height = `${first.height}px`;
    ghost.style.top = cs.top;
    ghost.style.left = cs.left;
    ghost.style.marginLeft = cs.marginLeft;
    ghost.style.transform = cs.transform;
    host?.append(ghost);

    const next = openHeights(sheet);
    layer.hidden = false;
    sheet.classList.add("is-flying");
    layer.append(sheet);
    pin(sheet, first, FOLD.sheetZ, false);
    sheet.getBoundingClientRect();

    requestAnimationFrame(() => {
      layer.classList.add("is-on");
      pin(sheet, modalPos(first.width), 0, !reduceMotion());
      applySegs(sheet, next.a, next.b);
      setOpen(sheet, true);
    });

    afterFly(sheet, () => {
      if (phase !== "opening" || active !== sheet) return;
      phase = "open";
    });
  }

  function closeSheet() {
    const sheet = active;
    if (!sheet || !host || (phase !== "open" && phase !== "opening")) return;
    phase = "closing";
    window.clearTimeout(flyTimer);
    sheet.scrollTop = 0;

    const dest = ghost ? layoutBox(ghost) : layoutBox(host);
    const folded = foldedSegs(sheet);
    layer.classList.remove("is-on");

    requestAnimationFrame(() => {
      pin(sheet, dest, FOLD.sheetZ, !reduceMotion());
      applySegs(sheet, folded.a, folded.b);
      setOpen(sheet, false);
    });

    afterFly(sheet, () => {
      if (phase !== "closing" || active !== sheet) return;
      host.append(sheet);
      ghost?.remove();
      ghost = null;
      sheet.classList.remove("is-flying", "is-open");
      sheet.style.height = "";
      clearFly(sheet);
      layer.hidden = true;
      active = null;
      host = null;
      phase = "idle";
    });
  }

  document.querySelectorAll("[data-sheet]").forEach((el) => {
    syncAria(el, false);
    fillStrips(el);
    applySegs(el, foldedSegs(el).a, foldedSegs(el).b);

    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    el.addEventListener("click", (event) => {
      event.stopPropagation();
      if (phase !== "idle") return;
      openSheet(el);
    });
  });

  backdrop.addEventListener("click", () => {
    if (phase !== "open") return;
    closeSheet();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (phase !== "open") return;
    event.preventDefault();
    closeSheet();
  });

  document.addEventListener("kaik:translated", () => {
    document.querySelectorAll("[data-sheet]").forEach((el) => {
      syncAria(el, el.classList.contains("is-open"));
    });
  });
}

loadFold();
