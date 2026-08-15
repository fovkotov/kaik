const SLIDE = "[data-img-slider-slide]";
const PREV = "[data-img-slider-prev]";
const NEXT = "[data-img-slider-next]";

function slideImages(slide) {
  return [...slide.querySelectorAll("img")].filter(
    (img) => !img.closest(".img-slider__nav"),
  );
}

function displayedHeight(img, width) {
  const nw = img.naturalWidth || Number(img.getAttribute("width")) || 0;
  const nh = img.naturalHeight || Number(img.getAttribute("height")) || 0;
  if (!nw || !nh) return 0;
  if (nw <= width) return nh;
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
  const show = (next) => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
  };

  const holdFocus = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  show(0);

  root.querySelector(PREV)?.addEventListener("click", (event) => {
    holdFocus(event);
    show(index - 1);
  });
  root.querySelector(NEXT)?.addEventListener("click", (event) => {
    holdFocus(event);
    show(index + 1);
  });
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
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
