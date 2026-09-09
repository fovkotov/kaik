/**
 * /experiment grid playground — a fixed panel of sliders and selects that
 * drive the works grid live: track count, gaps, row height, spans per work
 * kind, thresholds, ordering, captions / arrows behaviour.
 *
 * CSS-only knobs write `--tw-*` custom properties on <html> (or data
 * attributes on the feed root); layout-rule knobs re-render the feed.
 * State persists in storage and can be shared as `#g=<base64url json>`.
 */

import { safeStorage } from "./embed.js";
import { isMobile } from "./tweaks.js";
import { KIND_LETTER, KIND_TALL_FINAL, TYPE_FINAL, TYPE_FONT, TYPE_LETTERING } from "./works/taxonomy.js";

const STORAGE_KEY = "kaik-experiment-grid-v1";
const OPEN_KEY = `${STORAGE_KEY}:open`;
const HASH_KEY = "g";

/**
 * `css`  → custom property on <html>; `unit` appended.
 * `attr` → data attribute on the feed root.
 * `rerender` → feed.update() (span rules, order, filters).
 */
const CONTROLS = [
  { group: "Сетка" },
  { key: "cols", label: "Колонки", type: "range", min: 2, max: 14, step: 1, def: 6, css: "--tw-cols", rerender: true },
  { key: "colsM", label: "Колонки на мобилке", type: "range", min: 1, max: 4, step: 1, def: 2, css: "--tw-cols-m", rerender: true },
  { key: "gapX", label: "Зазор по X", type: "range", min: 0, max: 80, step: 1, def: 8, unit: "px", css: "--tw-gap-x" },
  { key: "gapY", label: "Зазор по Y", type: "range", min: 0, max: 80, step: 1, def: 10, unit: "px", css: "--tw-gap-y" },
  {
    key: "rows",
    label: "Ряды",
    type: "select",
    def: "fixed",
    attr: "data-rows",
    options: [
      ["fixed", "фиксированные (× колонки)"],
      ["natural", "по пропорции картинки"],
    ],
  },
  { key: "rowRatio", label: "Высота ряда, × ширины колонки", type: "range", min: 0.4, max: 2.5, step: 0.005, def: 1.215, css: "--tw-row" },
  {
    key: "flow",
    label: "Заполнение дыр",
    type: "select",
    def: "dense",
    css: "--tw-flow",
    options: [
      ["dense", "плотно (dense)"],
      ["row", "по порядку"],
    ],
  },
  { key: "pad", label: "Отступ страницы по бокам", type: "range", min: 0, max: 160, step: 1, def: 16, unit: "px", css: "--tw-pad" },
  { key: "padTop", label: "Отступ сверху", type: "range", min: 0, max: 200, step: 1, def: 24, unit: "px", css: "--tw-pad-top" },
  { key: "bg", label: "Фон страницы", type: "color", def: "#f5f5f5", css: "--tw-bg" },

  { group: "Ячейка" },
  { key: "cellPad", label: "Внутренний отступ", type: "range", min: 0, max: 80, step: 1, def: 0, unit: "px", css: "--tw-cell-pad" },
  {
    key: "fit",
    label: "Картинка в ячейке",
    type: "select",
    def: "contain",
    css: "--tw-fit",
    options: [
      ["contain", "вписать целиком"],
      ["cover", "залить ячейку"],
    ],
  },
  { key: "radius", label: "Скругление", type: "range", min: 0, max: 48, step: 1, def: 0, unit: "px", css: "--tw-radius" },
  {
    key: "cellBg",
    label: "Плашка ячейки",
    type: "select",
    def: "transparent",
    css: "--tw-cell-bg",
    options: [
      ["transparent", "нет"],
      ["#ffffff", "белая"],
      ["#ececec", "светло-серая"],
      ["#e0e0e0", "серая"],
      ["#111111", "чёрная"],
    ],
  },
  { key: "lift", label: "Подъём на ховере", type: "range", min: 0, max: 24, step: 1, def: 4, unit: "px", css: "--tw-lift" },
  { key: "fontK", label: "Кегль шрифтовой ячейки, × колонки", type: "range", min: 0.15, max: 1.2, step: 0.01, def: 0.46, css: "--tw-font-k" },

  { group: "Правила размещения" },
  { key: "letterMax", label: "Буква — если пропорция ≤", type: "range", min: 0.3, max: 3, step: 0.01, def: 1.25, rerender: true },
  { key: "tallMax", label: "Портретный финал — если пропорция <", type: "range", min: 0.2, max: 2, step: 0.01, def: 0.95, rerender: true },
  { key: "letterCols", label: "Буква: колонки", type: "range", min: 1, max: 6, step: 1, def: 1, rerender: true },
  { key: "letterRows", label: "Буква: ряды", type: "range", min: 1, max: 4, step: 1, def: 1, rerender: true },
  { key: "letteringCols", label: "Леттеринг: колонки", type: "range", min: 1, max: 8, step: 1, def: 2, rerender: true },
  { key: "letteringRows", label: "Леттеринг: ряды", type: "range", min: 1, max: 4, step: 1, def: 1, rerender: true },
  { key: "finalCols", label: "Финал: колонки", type: "range", min: 1, max: 8, step: 1, def: 2, rerender: true },
  { key: "finalRows", label: "Финал: ряды", type: "range", min: 1, max: 4, step: 1, def: 1, rerender: true },
  { key: "tallCols", label: "Портретный финал: колонки", type: "range", min: 1, max: 8, step: 1, def: 2, rerender: true },
  { key: "tallRows", label: "Портретный финал: ряды", type: "range", min: 1, max: 4, step: 1, def: 2, rerender: true },
  { key: "fontCols", label: "Шрифт: колонки", type: "range", min: 1, max: 8, step: 1, def: 2, rerender: true },
  { key: "fontRows", label: "Шрифт: ряды", type: "range", min: 1, max: 4, step: 1, def: 1, rerender: true },

  { group: "Контент" },
  {
    key: "order",
    label: "Порядок",
    type: "select",
    def: "date",
    rerender: true,
    options: [
      ["date", "по дате"],
      ["type", "по типу (финалы первыми)"],
      ["shuffle", "перемешать"],
    ],
  },
  { key: "showLettering", label: "Леттеринг и буквы", type: "toggle", def: true, rerender: true },
  { key: "showFinal", label: "Финальные проекты", type: "toggle", def: true, rerender: true },
  { key: "showFont", label: "Шрифты", type: "toggle", def: true, rerender: true },
  {
    key: "caption",
    label: "Подписи",
    type: "select",
    def: "hover",
    attr: "data-caption",
    options: [
      ["hover", "по ховеру"],
      ["always", "всегда"],
      ["never", "никогда"],
    ],
  },
  {
    key: "arrows",
    label: "Стрелки слайдера",
    type: "select",
    def: "hover",
    attr: "data-arrows",
    options: [
      ["hover", "по ховеру"],
      ["always", "всегда"],
      ["never", "никогда"],
    ],
  },
  {
    key: "dots",
    label: "Точки слайдера",
    type: "select",
    def: "hover",
    attr: "data-dots",
    options: [
      ["hover", "по ховеру"],
      ["always", "всегда"],
      ["never", "никогда"],
    ],
  },
];

const FIELDS = CONTROLS.filter((c) => c.key);

function defaults() {
  const state = {};
  FIELDS.forEach((c) => {
    state[c.key] = c.def;
  });
  state.seed = 7;
  return state;
}

function sanitize(raw) {
  const state = defaults();
  if (!raw || typeof raw !== "object") return state;
  FIELDS.forEach((c) => {
    const v = raw[c.key];
    if (v === undefined) return;
    if (c.type === "range") {
      const n = Number(v);
      if (Number.isFinite(n)) state[c.key] = Math.min(c.max, Math.max(c.min, n));
    } else if (c.type === "select") {
      if (c.options.some(([value]) => value === v)) state[c.key] = v;
    } else if (c.type === "toggle") {
      state[c.key] = Boolean(v);
    } else if (c.type === "color") {
      if (/^#[0-9a-f]{6}$/i.test(String(v))) state[c.key] = String(v).toLowerCase();
    }
  });
  if (Number.isFinite(Number(raw.seed))) state.seed = Number(raw.seed);
  return state;
}

function encodeState(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(text) {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function readHashState() {
  const match = window.location.hash.match(new RegExp(`[#&]${HASH_KEY}=([^&]+)`));
  return match ? decodeState(match[1]) : null;
}

function rulesFrom(state) {
  return {
    letterMaxRatio: state.letterMax,
    tallFinalMaxRatio: state.tallMax,
    spans: {
      [KIND_LETTER]: [state.letterCols, state.letterRows],
      [TYPE_LETTERING]: [state.letteringCols, state.letteringRows],
      [TYPE_FINAL]: [state.finalCols, state.finalRows],
      [KIND_TALL_FINAL]: [state.tallCols, state.tallRows],
      [TYPE_FONT]: [state.fontCols, state.fontRows],
    },
  };
}

function typesFrom(state) {
  const types = [];
  if (state.showLettering) types.push(TYPE_LETTERING);
  if (state.showFinal) types.push(TYPE_FINAL);
  if (state.showFont) types.push(TYPE_FONT);
  return types;
}

function formatValue(control, value) {
  if (control.type !== "range") return String(value);
  const digits = control.step < 0.1 ? 3 : control.step < 1 ? 2 : 0;
  return `${Number(value).toFixed(digits)}${control.unit || ""}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function initGridTweaks({ feed, feedRoot, mount }) {
  if (!feed || !feedRoot || !mount) return null;
  const storage = safeStorage();
  const root = document.documentElement;

  let state = sanitize(readHashState() || safeParse(storage.getItem(STORAGE_KEY)));
  let rerenderTimer = 0;
  const inputs = new Map();
  const outputs = new Map();

  function safeParse(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  function applyCss(control) {
    const v = state[control.key];
    if (control.css) root.style.setProperty(control.css, control.unit ? `${v}${control.unit}` : String(v));
    if (control.attr) feedRoot.setAttribute(control.attr, String(v));
  }

  function feedOptions() {
    return {
      rules: rulesFrom(state),
      order: state.order,
      types: typesFrom(state),
      maxCols: isMobile() ? state.colsM : state.cols,
      seed: state.seed,
    };
  }

  function scheduleRerender() {
    window.clearTimeout(rerenderTimer);
    rerenderTimer = window.setTimeout(() => {
      rerenderTimer = 0;
      feed.update(feedOptions());
    }, 80);
  }

  function persist() {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function applyAll({ render = true } = {}) {
    FIELDS.forEach(applyCss);
    if (render) feed.update(feedOptions());
  }

  function syncInputs() {
    FIELDS.forEach((c) => {
      const input = inputs.get(c.key);
      if (!input) return;
      if (c.type === "toggle") input.checked = Boolean(state[c.key]);
      else input.value = String(state[c.key]);
      const out = outputs.get(c.key);
      if (out) out.textContent = formatValue(c, state[c.key]);
    });
  }

  function set(control, value) {
    state[control.key] = value;
    const out = outputs.get(control.key);
    if (out) out.textContent = formatValue(control, value);
    applyCss(control);
    if (control.rerender) scheduleRerender();
    persist();
  }

  /* ---- panel ---- */

  const panel = document.createElement("aside");
  panel.className = "tweaks";
  panel.setAttribute("aria-label", "Настройки сетки");

  const head = document.createElement("div");
  head.className = "tweaks__head";
  const title = document.createElement("span");
  title.className = "tweaks__title";
  title.textContent = "Сетка";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tweaks__close";
  closeBtn.setAttribute("aria-label", "Свернуть панель");
  closeBtn.textContent = "×";
  head.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "tweaks__body";

  CONTROLS.forEach((control) => {
    if (control.group) {
      const h = document.createElement("h3");
      h.className = "tweaks__group";
      h.textContent = control.group;
      body.append(h);
      return;
    }
    const row = document.createElement("label");
    row.className = `tweaks__row tweaks__row--${control.type}`;
    const name = document.createElement("span");
    name.className = "tweaks__label";
    name.textContent = control.label;
    row.append(name);

    if (control.type === "range") {
      const out = document.createElement("output");
      out.className = "tweaks__value";
      out.textContent = formatValue(control, state[control.key]);
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = String(control.step);
      input.value = String(state[control.key]);
      input.addEventListener("input", () => set(control, Number(input.value)));
      input.addEventListener("dblclick", () => {
        input.value = String(control.def);
        set(control, control.def);
      });
      row.append(out, input);
      inputs.set(control.key, input);
      outputs.set(control.key, out);
    } else if (control.type === "select") {
      const select = document.createElement("select");
      control.options.forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      });
      select.value = state[control.key];
      select.addEventListener("change", () => set(control, select.value));
      row.append(select);
      inputs.set(control.key, select);
    } else if (control.type === "toggle") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(state[control.key]);
      input.addEventListener("change", () => set(control, input.checked));
      row.prepend(input);
      inputs.set(control.key, input);
    } else if (control.type === "color") {
      const input = document.createElement("input");
      input.type = "color";
      input.value = state[control.key];
      input.addEventListener("input", () => set(control, input.value));
      row.append(input);
      inputs.set(control.key, input);
    }
    body.append(row);
  });

  const actions = document.createElement("div");
  actions.className = "tweaks__actions";
  const note = document.createElement("p");
  note.className = "tweaks__note";
  note.textContent = "Двойной клик по ползунку — сброс к умолчанию. Настройки сохраняются в браузере.";

  const mkBtn = (text, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tweaks__btn";
    btn.textContent = text;
    btn.addEventListener("click", onClick);
    return btn;
  };

  const flash = (btn, text) => {
    const was = btn.textContent;
    btn.textContent = text;
    window.setTimeout(() => {
      btn.textContent = was;
    }, 1200);
  };

  const shuffleBtn = mkBtn("Перемешать ещё", () => {
    state.seed = (Math.random() * 1e9) >>> 0;
    if (state.order !== "shuffle") {
      state.order = "shuffle";
      syncInputs();
    }
    persist();
    feed.update(feedOptions());
  });
  const linkBtn = mkBtn("Скопировать ссылку", async () => {
    const url = `${window.location.origin}${window.location.pathname}#${HASH_KEY}=${encodeState(state)}`;
    window.history.replaceState(null, "", `#${HASH_KEY}=${encodeState(state)}`);
    flash(linkBtn, (await copyText(url)) ? "Скопировано" : "Не удалось");
  });
  const jsonBtn = mkBtn("Скопировать JSON", async () => {
    flash(jsonBtn, (await copyText(JSON.stringify(state, null, 2))) ? "Скопировано" : "Не удалось");
  });
  const resetBtn = mkBtn("Сбросить всё", () => {
    state = defaults();
    syncInputs();
    persist();
    window.history.replaceState(null, "", window.location.pathname);
    applyAll();
  });
  actions.append(shuffleBtn, linkBtn, jsonBtn, resetBtn);

  panel.append(head, body, actions, note);

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "tweaks__fab";
  fab.textContent = "сетка";
  fab.setAttribute("aria-label", "Открыть настройки сетки");

  mount.append(panel, fab);

  const setOpen = (open) => {
    mount.classList.toggle("is-open", open);
    panel.hidden = !open;
    fab.hidden = open;
    storage.setItem(OPEN_KEY, open ? "1" : "0");
  };
  const stored = storage.getItem(OPEN_KEY);
  setOpen(stored === null ? !isMobile() : stored === "1");
  closeBtn.addEventListener("click", () => setOpen(false));
  fab.addEventListener("click", () => setOpen(true));

  /* keep spans inside the live track count when the layout flips mobile/desktop */
  const mq = window.matchMedia("(max-width: 900px)");
  mq.addEventListener("change", () => feed.update(feedOptions()));

  /* the panel must not steal arrow keys from the viewer */
  panel.addEventListener("keydown", (event) => event.stopPropagation());

  applyAll();
  persist();

  return {
    get state() {
      return { ...state };
    },
    set(partial) {
      state = sanitize({ ...state, ...partial });
      syncInputs();
      persist();
      applyAll();
    },
  };
}
