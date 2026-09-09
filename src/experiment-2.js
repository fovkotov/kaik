import { initEmbed } from "./embed.js";
import { loadWorksCatalog, workFileUrl } from "./works/catalog.js";

const hero = document.querySelector("[data-lettering-hero]");
const canvas = document.querySelector("[data-lettering-canvas]");
const fallback = document.querySelector("[data-lettering-fallback]");
const action = document.querySelector("[data-lettering-action]");
const credit = document.querySelector("[data-lettering-credit]");
const grid = document.querySelector("[data-works-grid]");
const empty = document.querySelector("[data-works-empty]");
const typeFilter = document.querySelector("[data-type-filter]");
const authorFilter = document.querySelector("[data-author-filter]");

let catalog = [];
let workshopWorks = [];
let activeLettering = null;
let shader = null;

function cleanAuthor(value) {
  return String(value || "").trim() || "автор не указан";
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

function setHero(item) {
  const file = imageFiles(item)[0];
  if (!file) return;
  activeLettering = item;
  const url = workFileUrl(file);
  fallback.src = url;
  fallback.alt = `Леттеринг, ${cleanAuthor(item.author)}`;
  credit.textContent = cleanAuthor(item.author);
  shader?.setImage(url);
}

function nextHero() {
  const next = shufflePick(workshopWorks, activeLettering?.id);
  if (next) setHero(next);
}

function uniqueAuthors(items) {
  return [...new Set(items.map((item) => cleanAuthor(item.author)).filter((name) => name !== "автор не указан"))].sort(
    (a, b) => a.localeCompare(b, "ru"),
  );
}

function syncAuthorOptions() {
  const selected = authorFilter.value;
  const pool = catalog.filter((item) => item.type === typeFilter.value);
  authorFilter.replaceChildren(new Option("все", ""));
  uniqueAuthors(pool).forEach((author) => authorFilter.add(new Option(author, author)));
  authorFilter.value = [...authorFilter.options].some((option) => option.value === selected) ? selected : "";
}

function tileFor(item, file, index) {
  const article = document.createElement("article");
  article.className = "work-tile";

  const image = document.createElement("img");
  image.src = workFileUrl(file);
  image.alt = `${typeFilter.value === "final" ? "Финальный проект" : "Работа воркшопа"}, ${cleanAuthor(item.author)}`;
  image.loading = "lazy";
  image.decoding = "async";

  const meta = document.createElement("p");
  meta.className = "work-tile__meta";
  const slide = item.files.length > 1 ? `<span>${index + 1}/${item.files.length}</span>` : "";
  meta.innerHTML = `<span>${cleanAuthor(item.author)}</span>${slide}`;

  article.append(image, meta);
  return article;
}

function renderGrid() {
  const type = typeFilter.value;
  const author = authorFilter.value;
  const works = catalog.filter(
    (item) => item.type === type && (!author || cleanAuthor(item.author) === author),
  );
  const fragment = document.createDocumentFragment();

  works.forEach((item) => {
    imageFiles(item).forEach((file, index) => {
      fragment.append(tileFor(item, file, index));
    });
  });

  grid.replaceChildren(fragment);
  empty.hidden = grid.childElementCount > 0;
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
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

function createLetteringShader() {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
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
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform vec2 u_velocity;
    varying vec2 v_uv;

    void main() {
      vec2 uv = v_uv;
      float wave = sin((uv.y * 2.0 + uv.x) * 3.14159265) * 0.008;
      uv.x += wave * u_velocity.y;
      uv.y -= wave * u_velocity.x;
      vec4 source = texture2D(u_texture, uv);
      gl_FragColor = vec4(vec3(0.96), source.a);
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
  let currentCenter = { x: 0.5, y: 0.5 };
  let targetCenter = { x: 0.5, y: 0.5 };
  let currentVelocity = { x: 0, y: 0 };
  let targetVelocity = { x: 0, y: 0 };
  let lastPointer = { x: 0.5, y: 0.5, time: performance.now() };
  let frame = 0;

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
    resize();
    currentCenter.x += (targetCenter.x - currentCenter.x) * 0.11;
    currentCenter.y += (targetCenter.y - currentCenter.y) * 0.11;
    currentVelocity.x += (targetVelocity.x - currentVelocity.x) * 0.12;
    currentVelocity.y += (targetVelocity.y - currentVelocity.y) * 0.12;
    targetVelocity.x *= 0.9;
    targetVelocity.y *= 0.9;

    const cssWidth = canvas.clientWidth || 1;
    const cssHeight = canvas.clientHeight || 1;
    const sourceAspect = imageSize.width / imageSize.height;
    let displayWidth = cssWidth * 0.68;
    let displayHeight = displayWidth / sourceAspect;
    const maxHeight = cssHeight * 0.58;
    if (displayHeight > maxHeight) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * sourceAspect;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.center, currentCenter.x * 2 - 1, 1 - currentCenter.y * 2);
    gl.uniform2f(uniforms.size, (displayWidth / cssWidth) * 2, (displayHeight / cssHeight) * 2);
    gl.uniform2f(uniforms.velocity, currentVelocity.x, currentVelocity.y);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
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
      };
      image.src = url;
    },
    destroy() {
      cancelAnimationFrame(frame);
      hero.removeEventListener("pointermove", onPointerMove);
      hero.removeEventListener("pointerleave", onPointerLeave);
    },
  };
}

function setupHero() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  if (reduceMotion || coarsePointer) {
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

async function boot() {
  initEmbed();
  setupHero();
  const data = await loadWorksCatalog({ bust: true });
  catalog = data.items || [];
  workshopWorks = catalog.filter((item) => item.type === "lettering" && imageFiles(item).length);
  syncAuthorOptions();
  renderGrid();
  const first = shufflePick(workshopWorks);
  if (first) setHero(first);
}

action.addEventListener("click", nextHero);
typeFilter.addEventListener("change", () => {
  syncAuthorOptions();
  renderGrid();
});
authorFilter.addEventListener("change", renderGrid);

boot();
