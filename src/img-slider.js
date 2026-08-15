const SLIDE = "[data-img-slider-slide]";
const PREV = "[data-img-slider-prev]";
const NEXT = "[data-img-slider-next]";

function slideImages(slide) {
  return [...slide.querySelectorAll("img")].filter(
    (img) => !img.closest(".img-slider__nav") && !img.closest(".img-slider__dots"),
  );
}

function displayedHeight(img, width) {
  const nw = img.naturalWidth || Number(img.getAttribute("width")) || 0;
  const nh = img.naturalHeight || Number(img.getAttribute("height")) || 0;
  if (!nw || !nh) return 0;
  return width * (nh / nw);
}

function measureTrack(root) {
  const width = root.clientWidth;
  if (!width) return;
  let maxH = 0;
  root.querySelectorAll(SLIDE).forEach((slide) => {
    slideImages(slide).forEach((img) => {
      maxH = Math.max(maxH, displayedHeight(img, width));
    });
  });
  if (maxH) root.style.setProperty("--slider-h", `${maxH}px`);
}

function whenReady(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

function bindSlider(root) {
  const slides = [...root.querySelectorAll(SLIDE)];
  if (slides.length < 2) return;

  let index = 0;
  const dots = [];

  const show = (next) => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
    dots.forEach((dot, i) => {
      const on = i === index;
      dot.classList.toggle("is-active", on);
      dot.setAttribute("aria-current", on ? "true" : "false");
    });
  };

  const holdFocus = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  let pager = root.querySelector("[data-img-slider-dots]");
  if (!pager) {
    pager = document.createElement("div");
    pager.className = "img-slider__dots";
    pager.setAttribute("data-img-slider-dots", "");
    pager.setAttribute("role", "tablist");
    root.append(pager);
  } else {
    pager.replaceChildren();
  }

  slides.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "img-slider__dot";
    dot.setAttribute("data-img-slider-dot", "");
    dot.setAttribute("aria-label", `${i + 1} / ${slides.length}`);
    dot.addEventListener("click", (event) => {
      holdFocus(event);
      show(i);
    });
    pager.append(dot);
    dots.push(dot);
  });

  const bindNav = (sel, step) => {
    const btn = root.querySelector(sel);
    if (!btn) return;
    btn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    btn.addEventListener("pointerup", (event) => {
      event.stopPropagation();
    });
    btn.addEventListener("click", (event) => {
      holdFocus(event);
      show(index + step);
    });
  };

  show(0);

  bindNav(PREV, -1);
  bindNav(NEXT, 1);

  let swipe = null;
  root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  root.addEventListener("pointerup", (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy)) return;
    show(index + (dx < 0 ? 1 : -1));
  });
  root.addEventListener("pointercancel", () => {
    swipe = null;
  });
  root.addEventListener("click", (event) => event.stopPropagation());

  const images = slides.flatMap(slideImages);
  const refresh = () => measureTrack(root);
  refresh();
  Promise.all(images.map(whenReady)).then(refresh);
  const ro = new ResizeObserver(refresh);
  ro.observe(root);
}

export function initImgSliders(scope = document) {
  scope.querySelectorAll("[data-img-slider]").forEach(bindSlider);
}

export function initHistorySlideshows() {
  initImgSliders();
}
