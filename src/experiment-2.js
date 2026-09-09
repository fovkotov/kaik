import { initEmbed } from "./embed.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";

const TAB_WORKSHOPS = "lettering";
const TAB_FINAL = "final";

const hero = document.querySelector("[data-lettering-hero]");
const canvas = document.querySelector("[data-lettering-canvas]");
const fallback = document.querySelector("[data-lettering-fallback]");
const action = document.querySelector("[data-lettering-action]");
const credit = document.querySelector("[data-lettering-credit]");
const reviewHero = document.querySelector("[data-review-hero]");
const reviewVideo = document.querySelector("[data-review-video]");
const reviewPlay = document.querySelector("[data-review-play]");
const panel = document.querySelector("[data-works-panel]");

const REVIEW_VIDEO_ID = "K06Djv3prto";
const grid = document.querySelector("[data-works-grid]");
const empty = document.querySelector("[data-works-empty]");
const tabs = [...document.querySelectorAll("[data-tab]")];

const COARSE = window.matchMedia("(pointer: coarse)");
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let catalog = [];
let workshopWorks = [];
let activeTab = TAB_WORKSHOPS;
let activeLettering = null;
let shader = null;
let viewer = null;

/* ---------- helpers ---------- */

function isMobile() {
  return COARSE.matches || window.innerWidth <= 760;
}

function imageFiles(item) {
  return (item?.files || []).filter((file) => !/\.(?:ttf|otf|woff2?)$/i.test(file));
}

function shufflePick(items, excludeId = "") {
  if (!items.length) return null;
  const pool = items.filter((item) => item.id !== excludeId);
  const source = pool.length ? pool : items;
  return source[Math.floor(Math.random() * source.length)];
}

/** Name, @nick and stream as spans; muted parts get `.is-muted`. */
function metaNodes(item) {
  const nodes = [];
  if (item.author) {
    const name = document.createElement("span");
    name.textContent = item.author;
    nodes.push(name);
  }
  if (item.nick) {
    const nick = document.createElement("span");
    nick.className = "is-muted";
    nick.textContent = `@${item.nick}`;
    nodes.push(nick);
  }
  if (item.stream) {
    const stream = document.createElement("span");
    stream.className = "is-muted";
    stream.textContent = `поток ${item.stream}`;
    nodes.push(stream);
  }
  if (!nodes.length) {
    const anon = document.createElement("span");
    anon.className = "is-muted";
    anon.textContent = "автор не указан";
    nodes.push(anon);
  }
  return nodes;
}

function altFor(item) {
  const kind = item.type === TAB_FINAL ? "Финальный проект" : "Работа воркшопа";
  return item.author ? `${kind}, ${item.author}` : kind;
}

/* ---------- tabs + grid ---------- */

function setTab(next) {
  if (next !== TAB_WORKSHOPS && next !== TAB_FINAL) return;
  activeTab = next;
  tabs.forEach((tab) => {
    const on = tab.dataset.tab === next;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;
  });
  panel.setAttribute("aria-labelledby", `tab-${next}`);
  const showHero = next === TAB_WORKSHOPS;
  hero.hidden = !showHero;
  shader?.setActive(showHero);
  reviewHero.hidden = showHero;
  if (showHero) stopReview();
  renderGrid();
}

/* ---------- final review video ---------- */

function playReview() {
  if (reviewHero.classList.contains("is-playing")) return;
  const frame = document.createElement("iframe");
  frame.src = `https://www.youtube-nocookie.com/embed/${REVIEW_VIDEO_ID}?autoplay=1&rel=0&playsinline=1`;
  frame.title = "Финальный просмотр 1 потока";
  frame.allow = "autoplay; fullscreen; picture-in-picture; clipboard-write";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  reviewVideo.append(frame);
  reviewHero.classList.add("is-playing");
}

/** Leaving the tab: drop the embed so audio stops and the play plate comes back. */
function stopReview() {
  reviewVideo.querySelector("iframe")?.remove();
  reviewHero.classList.remove("is-playing");
}

function cardFor(item) {
  const cover = imageFiles(item)[0];
  const card = document.createElement("button");
  card.type = "button";
  card.className = "work-card";
  card.dataset.workId = item.id;

  const art = document.createElement("span");
  art.className = "work-card__art";
  const image = document.createElement("img");
  image.src = workFileUrl(cover);
  image.alt = altFor(item);
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  art.append(image);

  const meta = document.createElement("span");
  meta.className = "work-card__meta";
  meta.append(...metaNodes(item));

  card.append(art, meta);
  card.addEventListener("click", () => viewer?.open(item, card));
  return card;
}

function renderGrid() {
  const works = catalog.filter((item) => item.type === activeTab && imageFiles(item).length);
  const fragment = document.createDocumentFragment();
  works.forEach((item) => fragment.append(cardFor(item)));
  grid.replaceChildren(fragment);
  empty.hidden = works.length > 0;
}

/* ---------- hero ---------- */

function setHero(item) {
  const file = imageFiles(item)[0];
  if (!file) return;
  activeLettering = item;
  const url = workFileUrl(file);
  fallback.src = url;
  fallback.alt = altFor(item);
  credit.replaceChildren(...metaNodes(item));
  shader?.setImage(url);
}

function nextHero() {
  const next = shufflePick(workshopWorks, activeLettering?.id);
  if (next) setHero(next);
}

function compile(gl, kind, source) {
  const shaderObject = gl.createShader(kind);
  gl.shaderSource(shaderObject, source);
  gl.compileShader(shaderObject);
  if (!gl.getShaderParameter(shaderObject, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shaderObject) || "Shader compile failed");
  }
  return shaderObject;
}

function createMesh(columns = 34, rows = 20) {
  const vertices = [];
  const indices = [];
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= columns; x += 1) {
      vertices.push(x / columns, y / rows, x / columns, 1 - y / rows);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const a = y * (columns + 1) + x;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

function createLetteringShader() {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;

  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    uniform vec2 u_center;
    uniform vec2 u_size;
    uniform vec2 u_velocity;
    varying vec2 v_uv;

    void main() {
      vec2 local = a_position - 0.5;
      float xArc = local.y * abs(local.y);
      float yArc = local.x * abs(local.x);
      local.x += xArc * u_velocity.y * 0.34;
      local.y -= yArc * u_velocity.x * 0.24;
      local += vec2(local.y * u_velocity.x, local.x * u_velocity.y) * 0.045;
      gl_Position = vec4(u_center + local * u_size, 0.0, 1.0);
      v_uv = a_uv;
    }
  `;
  /* Ink on the light page: black at 75% alpha, premultiplied. */
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    /* Must match the vertex shader's default highp or the program fails to link. */
    uniform highp vec2 u_velocity;
    varying vec2 v_uv;

    void main() {
      vec2 uv = v_uv;
      float wave = sin((uv.y * 2.0 + uv.x) * 3.14159265) * 0.008;
      uv.x += wave * u_velocity.y;
      uv.y -= wave * u_velocity.x;
      vec4 source = texture2D(u_texture, uv);
      gl_FragColor = vec4(0.0, 0.0, 0.0, source.a * 0.75);
    }
  `;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Shader link failed");
  }
  gl.useProgram(program);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const mesh = createMesh();
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const position = gl.getAttribLocation(program, "a_position");
  const uv = gl.getAttribLocation(program, "a_uv");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  const uniforms = {
    center: gl.getUniformLocation(program, "u_center"),
    size: gl.getUniformLocation(program, "u_size"),
    velocity: gl.getUniformLocation(program, "u_velocity"),
  };
  let imageSize = { width: 1, height: 1 };
  let hasImage = false;
  let currentCenter = { x: 0.5, y: 0.5 };
  let targetCenter = { x: 0.5, y: 0.5 };
  let currentVelocity = { x: 0, y: 0 };
  let targetVelocity = { x: 0, y: 0 };
  let lastPointer = { x: 0.5, y: 0.5, time: performance.now() };
  let frame = 0;
  let active = true;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function draw() {
    frame = 0;
    if (!active) return;
    resize();
    currentCenter.x += (targetCenter.x - currentCenter.x) * 0.11;
    currentCenter.y += (targetCenter.y - currentCenter.y) * 0.11;
    currentVelocity.x += (targetVelocity.x - currentVelocity.x) * 0.12;
    currentVelocity.y += (targetVelocity.y - currentVelocity.y) * 0.12;
    targetVelocity.x *= 0.9;
    targetVelocity.y *= 0.9;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (hasImage) {
      const cssWidth = canvas.clientWidth || 1;
      const cssHeight = canvas.clientHeight || 1;
      const sourceAspect = imageSize.width / imageSize.height;
      let displayWidth = cssWidth * 0.68;
      let displayHeight = displayWidth / sourceAspect;
      const maxHeight = cssHeight * 0.62;
      if (displayHeight > maxHeight) {
        displayHeight = maxHeight;
        displayWidth = displayHeight * sourceAspect;
      }
      gl.uniform2f(uniforms.center, currentCenter.x * 2 - 1, 1 - currentCenter.y * 2);
      gl.uniform2f(uniforms.size, (displayWidth / cssWidth) * 2, (displayHeight / cssHeight) * 2);
      gl.uniform2f(uniforms.velocity, currentVelocity.x, currentVelocity.y);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    }
    frame = requestAnimationFrame(draw);
  }

  function onPointerMove(event) {
    const rect = hero.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const now = performance.now();
    const elapsed = Math.max(16, now - lastPointer.time);
    targetVelocity.x = Math.max(-1, Math.min(1, ((x - lastPointer.x) * 260) / elapsed));
    targetVelocity.y = Math.max(-1, Math.min(1, ((y - lastPointer.y) * 260) / elapsed));
    targetCenter = { x, y };
    lastPointer = { x, y, time: now };
  }

  function onPointerLeave() {
    targetCenter = { x: 0.5, y: 0.5 };
    targetVelocity = { x: 0, y: 0 };
  }

  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerleave", onPointerLeave, { passive: true });
  frame = requestAnimationFrame(draw);

  return {
    setImage(url) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        imageSize = { width: image.naturalWidth || 1, height: image.naturalHeight || 1 };
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        hasImage = true;
      };
      image.src = url;
    },
    /** Hidden tab: stop the RAF loop; back on the tab: resume. */
    setActive(on) {
      active = Boolean(on);
      if (active && !frame) frame = requestAnimationFrame(draw);
    },
  };
}

function setupHero() {
  if (REDUCE.matches || COARSE.matches) {
    hero.classList.add("is-static");
    return;
  }
  try {
    shader = createLetteringShader();
    if (!shader) hero.classList.add("is-static");
  } catch (error) {
    console.warn("Experiment 2 shader unavailable", error);
    hero.classList.add("is-static");
  }
}

/* ---------- fullscreen viewer (site lightbox mechanics) ---------- */

const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
const MANY_SLIDES = 12;

function createViewer(root) {
  const track = root.querySelector("[data-viewer-track]");
  const pager = root.querySelector("[data-viewer-dots]");
  const caption = root.querySelector("[data-viewer-caption]");
  const counter = root.querySelector("[data-viewer-counter]");
  const chrome = "[data-viewer-close], [data-viewer-dots], [data-viewer-dot]";
  const navSel = "[data-viewer-prev], [data-viewer-next]";

  let items = [];
  let slides = [];
  let dots = [];
  let index = 0;
  let pending = 0;
  let shift = 0;
  let velocity = 0;
  let stopSpring = null;
  let open = false;
  let swipe = null;
  let samples = [];
  let ignoreClickUntil = 0;
  let returnFocus = null;

  const count = () => items.length || 1;
  const wrap = (i) => ((i % count()) + count()) % count();
  const widthOf = () => track?.clientWidth || root.clientWidth || window.innerWidth || 1;

  function wrapDelta(i, current, n, offset) {
    let d = i - current;
    d -= n * Math.round(d / n);
    if (n % 2 === 0 && Math.abs(d) === n / 2) d = offset > 0 ? -n / 2 : n / 2;
    return d;
  }

  function sampleVel(list) {
    if (list.length < 2) return 0;
    const a = list[0];
    const b = list[list.length - 1];
    const dt = b.t - a.t;
    if (dt < 8) return 0;
    return ((b.x - a.x) / dt) * 1000;
  }

  function shortestSteps(from, to) {
    let delta = to - from;
    const n = count();
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    return delta;
  }

  function paint(offset) {
    if (!isMobile()) {
      slides.forEach((slide) => {
        slide.style.transform = "translate3d(0,0,0)";
      });
      return;
    }
    const w = widthOf();
    const n = slides.length;
    slides.forEach((slide, i) => {
      const x = wrapDelta(i, index, n, offset) * w + offset;
      slide.style.transform = `translate3d(${x}px,0,0)`;
      slide.style.opacity = "";
    });
  }

  function syncDots(active = index) {
    const current = wrap(active);
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
    dots.forEach((dot, i) => {
      const on = i === current;
      dot.classList.toggle("is-active", on);
      dot.setAttribute("aria-current", on ? "true" : "false");
    });
    if (counter) counter.textContent = `${current + 1} / ${count()}`;
  }

  function cancelSpring() {
    if (!stopSpring) return;
    stopSpring();
    stopSpring = null;
  }

  function springTo(dest, vel, onDone) {
    cancelSpring();
    if (REDUCE.matches) {
      shift = dest;
      paint(shift);
      onDone();
      return;
    }
    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    const zeta = Math.abs(vel) > 800 ? 0.86 : 1;
    let x = shift;
    let v = vel;
    let last = performance.now();
    let raf = 0;
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const acc = -omega * omega * (x - dest) - 2 * zeta * omega * v;
      v += acc * dt;
      x += v * dt;
      shift = x;
      velocity = v;
      paint(shift);
      if (Math.abs(x - dest) < 0.5 && Math.abs(v) < 12) {
        shift = dest;
        velocity = 0;
        paint(shift);
        stopSpring = null;
        onDone();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    stopSpring = () => cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  function finishIndex(next) {
    index = wrap(next);
    pending = index;
    shift = 0;
    velocity = 0;
    slides.forEach((slide, i) => {
      slide.style.transition = "none";
      if (!isMobile()) {
        slide.style.opacity = i === index ? "1" : "0";
        slide.style.zIndex = i === index ? "1" : "0";
      } else {
        slide.style.opacity = "";
        slide.style.zIndex = "";
      }
    });
    paint(0);
    syncDots();
  }

  function adoptPending() {
    if (pending === index) return;
    const steps = shortestSteps(index, pending);
    shift += steps * widthOf();
    index = pending;
    paint(shift);
  }

  function committedSteps(vel = 0) {
    const w = widthOf();
    if (Math.abs(shift) > w * COMMIT_RATIO) return shift < 0 ? 1 : -1;
    if (Math.abs(vel) > FLICK_VEL) return vel < 0 ? 1 : -1;
    return 0;
  }

  function settleShift(dest, vel, nextIndex) {
    pending = wrap(nextIndex);
    syncDots(nextIndex);
    springTo(dest, vel, () => finishIndex(nextIndex));
  }

  function goTo(next, vel = 0) {
    if (!open) return;
    const target = wrap(next);
    pending = target;
    if (!isMobile()) {
      finishIndex(target);
      return;
    }
    const steps = shortestSteps(index, target);
    if (!steps && Math.abs(shift) < 0.5) {
      finishIndex(target);
      return;
    }
    settleShift(-steps * widthOf(), vel, target);
  }

  const go = (step) => goTo(pending + step);

  function suppressClick() {
    ignoreClickUntil = performance.now() + 450;
  }

  function buildSlides(item) {
    track.replaceChildren();
    slides = items.map((src, i) => {
      const slide = document.createElement("div");
      slide.className = "viewer__slide";
      if (i === 0) slide.classList.add("is-active");
      const image = document.createElement("img");
      image.alt = i === 0 ? altFor(item) : "";
      image.draggable = false;
      image.decoding = "async";
      image.src = src;
      slide.append(image);
      track.append(slide);
      return slide;
    });
  }

  function buildDots() {
    pager.replaceChildren();
    dots = items.map((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "viewer__dot";
      dot.setAttribute("data-viewer-dot", "");
      dot.setAttribute("aria-label", `${i + 1} / ${items.length}`);
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        goTo(i);
      });
      pager.append(dot);
      return dot;
    });
  }

  function setOpen(next) {
    open = next;
    document.documentElement.classList.toggle("is-viewer-open", next);
    root.hidden = !next;
    root.setAttribute("aria-hidden", next ? "false" : "true");
    if (next) root.removeAttribute("inert");
    else root.setAttribute("inert", "");
  }

  function close() {
    if (!open) return;
    cancelSpring();
    swipe = null;
    setOpen(false);
    root.classList.remove("is-dragging");
    root.querySelectorAll(".viewer__hit.is-aiming").forEach((hit) => hit.classList.remove("is-aiming"));
    const target = returnFocus;
    returnFocus = null;
    requestAnimationFrame(() => target?.focus?.({ preventScroll: true }));
  }

  function openWork(item, shot = null) {
    items = imageFiles(item).map((file) => workFileUrl(file));
    if (!items.length) return;
    returnFocus = shot;
    buildSlides(item);
    buildDots();
    caption.replaceChildren(...metaNodes(item));
    root.classList.toggle("is-single", items.length === 1);
    root.classList.toggle("is-many", items.length > MANY_SLIDES);
    root.classList.toggle("is-mobile", isMobile());
    cancelSpring();
    index = 0;
    pending = 0;
    shift = 0;
    velocity = 0;
    setOpen(true);
    finishIndex(0);
    root.querySelector("[data-viewer-close]")?.focus({ preventScroll: true });
  }

  /* chrome */
  root.querySelector("[data-viewer-close]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  const bindHit = (sel, step) => {
    root.querySelector(sel)?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < ignoreClickUntil) return;
      go(step);
    });
  };
  bindHit("[data-viewer-prev]", -1);
  bindHit("[data-viewer-next]", 1);

  const aimHit = (hit, event) => {
    if (!FINE.matches || isMobile()) return;
    const arrow = hit.querySelector(".viewer__arrow");
    if (!arrow) return;
    arrow.style.left = `${event.clientX}px`;
    arrow.style.top = `${event.clientY}px`;
    hit.classList.add("is-aiming");
  };
  root.querySelectorAll(navSel).forEach((hit) => {
    hit.addEventListener("pointerenter", (event) => aimHit(hit, event));
    hit.addEventListener("pointermove", (event) => aimHit(hit, event));
    hit.addEventListener("pointerleave", () => hit.classList.remove("is-aiming"));
  });

  root.querySelector("[data-viewer-mid]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("dragstart", (event) => event.preventDefault());

  /* mobile swipe */
  root.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.(chrome)) return;
      if (!isMobile()) return;
      if (event.pointerType === "mouse" && !COARSE.matches) return;
      cancelSpring();
      adoptPending();
      samples = [{ x: shift, t: event.timeStamp || performance.now() }];
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: shift, axis: null };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!open || !swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (!swipe.axis) {
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < TAP_PX) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.05) {
          swipe.axis = "x";
          suppressClick();
          root.classList.add("is-dragging");
        } else {
          swipe.axis = "y";
        }
      }
      if (swipe.axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      shift = swipe.origin + dx;
      velocity = 0;
      samples.push({ x: shift, t: event.timeStamp || performance.now() });
      if (samples.length > 5) samples.shift();
      if (samples.length >= 2) velocity = sampleVel(samples);
      paint(shift);
      syncDots(index + committedSteps(0));
    },
    { passive: false },
  );

  const endPointer = (event, cancelled) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const axis = swipe.axis;
    swipe = null;
    root.classList.remove("is-dragging");
    if (axis !== "x") {
      if (Math.abs(shift) > 0.5) settleShift(0, 0, index);
      return;
    }
    suppressClick();
    if (cancelled) {
      settleShift(0, 0, index);
      return;
    }
    const steps = committedSteps(sampleVel(samples) || velocity);
    settleShift(-steps * widthOf(), sampleVel(samples) || velocity, index + steps);
  };
  window.addEventListener("pointerup", (event) => endPointer(event, false));
  window.addEventListener("pointercancel", (event) => endPointer(event, true));

  root.addEventListener(
    "touchmove",
    (event) => {
      if (open && swipe?.axis === "x" && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  root.addEventListener("wheel", (event) => open && event.preventDefault(), { passive: false });

  window.addEventListener(
    "keydown",
    (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    },
    true,
  );

  new ResizeObserver(() => {
    if (!open || !slides.length) return;
    root.classList.toggle("is-mobile", isMobile());
    finishIndex(pending);
  }).observe(root);

  return { open: openWork, close };
}

/* ---------- boot ---------- */

async function boot() {
  initEmbed();
  setupHero();
  viewer = createViewer(document.querySelector("[data-viewer]"));

  tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
  document.querySelector(".works-tabs")?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const i = tabs.findIndex((tab) => tab.classList.contains("is-on"));
    const next = tabs[(i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  });
  action.addEventListener("click", nextHero);
  reviewPlay.addEventListener("click", playReview);

  const data = await loadWorksCatalog({ bust: true });
  catalog = data.items || [];
  workshopWorks = catalog.filter((item) => item.type === TAB_WORKSHOPS && imageFiles(item).length);
  setTab(TAB_WORKSHOPS);
  const first = shufflePick(workshopWorks);
  if (first) setHero(first);
}

boot();
