import { isMobile } from "./tweaks.js";
import { openLightboxGallery } from "./author-lightbox.js";

const SLIDE = "[data-img-slider-slide]";
const PREV = "[data-img-slider-prev]";
const NEXT = "[data-img-slider-next]";
const IGNORE =
  "button, a, [data-img-slider-dot], [data-img-slider-dots], [data-img-slider-prev], [data-img-slider-next], [data-format-mute], [data-work-ig], [data-work-student-prev], [data-work-student-next], [data-fly-close], [data-article-close]";
const COARSE = window.matchMedia("(pointer: coarse)");

const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const COMMIT_RATIO = 0.22;
const FLICK_VEL = 500;
const SPRING_RESPONSE = 0.4;
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Only one gallery may track a swipe. Extra fingers / sibling sliders are ignored. */
let activeSlider = null;

function setSliderBusy(on) {
  document.documentElement.classList.toggle("is-img-slider-busy", on);
}

function claimSlider(root) {
  if (activeSlider && activeSlider !== root) return false;
  activeSlider = root;
  root.classList.add("is-armed");
  setSliderBusy(true);
  return true;
}

function releaseSlider(root) {
  if (activeSlider !== root) return;
  activeSlider = null;
  root.classList.remove("is-armed", "is-dragging");
  setSliderBusy(false);
}

function slideImages(slide) {
  return [...slide.querySelectorAll("img")].filter(
    (img) => !img.closest(".img-slider__nav") && !img.closest(".img-slider__dots"),
  );
}

/** Keep slides + nav in a clipped stage; dots sit below in flow. */
function ensureStage(root) {
  let stage = root.querySelector("[data-img-slider-stage]");
  if (stage) return stage;
  stage = document.createElement("div");
  stage.className = "img-slider__stage";
  stage.setAttribute("data-img-slider-stage", "");
  const kids = [...root.children].filter(
    (el) => !el.matches?.("[data-img-slider-dots], .img-slider__dots"),
  );
  kids.forEach((el) => stage.append(el));
  root.prepend(stage);
  return stage;
}

function galleryItems(slides) {
  return slides.map((slide) => {
    const img = slideImages(slide)[0];
    const width = img?.naturalWidth || Number(img?.getAttribute("width")) || 1920;
    const height = img?.naturalHeight || Number(img?.getAttribute("height")) || 1080;
    return {
      src: img?.currentSrc || img?.src || "",
      width,
      height,
    };
  }).filter((item) => item.src);
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

function sampleVel(samples) {
  if (samples.length < 2) return 0;
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dt = b.t - a.t;
  if (dt < 8) return 0;
  return ((b.x - a.x) / dt) * 1000;
}

function wrapDelta(i, index, count, offset) {
  let d = i - index;
  d -= count * Math.round(d / count);
  if (count % 2 === 0 && Math.abs(d) === count / 2) {
    d = offset > 0 ? -count / 2 : count / 2;
  }
  return d;
}

function bindSlider(root) {
  ensureStage(root);
  const slides = [...root.querySelectorAll(SLIDE)];
  if (slides.length < 2) return;

  let index = 0;
  let pending = 0;
  let shift = 0;
  let velocity = 0;
  let stopSpring = null;
  let gesture = null;
  let didSlide = false;
  /** Ignore the synthetic click that follows a swipe (iOS ghost click included). */
  let ignoreClickUntil = 0;
  /** Pointer down that may become a tap-to-next (no swipe / no scroll). */
  let press = null;
  let dots = [];

  const widthOf = () => root.clientWidth || 1;

  const wrapIndex = (next) => (next + slides.length) % slides.length;

  const syncSlides = (active = index) => {
    const current = wrapIndex(active);
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
  };

  const syncDots = (active = index) => {
    const current = wrapIndex(active);
    syncSlides(current);
    dots.forEach((dot, i) => {
      const on = i === current;
      dot.classList.toggle("is-active", on);
      dot.setAttribute("aria-current", on ? "true" : "false");
    });
  };

  const stackDesktop = () => {
    slides.forEach((slide) => {
      slide.style.transform = "translate3d(0,0,0)";
    });
  };

  const paint = (offset) => {
    if (!isMobile()) {
      stackDesktop();
      return;
    }
    const w = widthOf();
    const n = slides.length;
    slides.forEach((slide, i) => {
      const x = wrapDelta(i, index, n, offset) * w + offset;
      slide.style.transform = `translate3d(${x}px,0,0)`;
      slide.style.opacity = "";
    });
  };

  const shortestSteps = (from, to) => {
    let delta = to - from;
    const n = slides.length;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    return delta;
  };

  const finishIndex = (next) => {
    const target = wrapIndex(next);
    index = target;
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
  };

  const cancelSpring = () => {
    if (!stopSpring) return;
    stopSpring();
    stopSpring = null;
  };

  const springTo = (dest, vel, onDone) => {
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
  };

  const committedSteps = (vel = 0) => {
    const w = widthOf();
    if (Math.abs(shift) > w * COMMIT_RATIO) return shift < 0 ? 1 : -1;
    if (Math.abs(vel) > FLICK_VEL) return vel < 0 ? 1 : -1;
    return 0;
  };

  const settleShift = (dest, vel, nextIndex) => {
    pending = wrapIndex(nextIndex);
    syncDots(nextIndex);
    springTo(dest, vel, () => finishIndex(nextIndex));
  };

  const goTo = (next, vel = 0) => {
    const target = wrapIndex(next);
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
  };

  /** Keep the painted offset when adopting `pending` as the live index. */
  const adoptPending = () => {
    if (pending === index) return;
    const steps = shortestSteps(index, pending);
    shift += steps * widthOf();
    index = pending;
    paint(shift);
  };

  const commitFromRelease = (vel) => {
    const steps = committedSteps(vel);
    settleShift(-steps * widthOf(), vel, index + steps);
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
  }

  pager.replaceChildren();
  slides.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "img-slider__dot";
    dot.setAttribute("data-img-slider-dot", "");
    dot.setAttribute("aria-label", `${i + 1} / ${slides.length}`);
    dot.addEventListener("click", (event) => {
      holdFocus(event);
      goTo(i);
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
      goTo(pending + step);
    });
  };

  bindNav(PREV, -1);
  bindNav(NEXT, 1);

  /** Mobile only: article-style drag. Desktop swaps the stacked slide instantly. */
  const allowSwipe = (event) => {
    if (!isMobile()) return false;
    if (event.pointerType === "mouse") return false;
    return event.pointerType === "touch" || COARSE.matches;
  };

  const articleOpen = () => Boolean(root.closest(".is-program-open"));

  const releaseDeck = () => {
    document.dispatchEvent(new CustomEvent("kaik:cancel-deck-drag"));
  };

  const detachPointer = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const suppressClick = () => {
    ignoreClickUntil = performance.now() + 450;
    didSlide = true;
    if (press) press.moved = true;
  };

  const markPressMoved = (event) => {
    if (!press || event.pointerId !== press.id || press.moved) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (dx * dx + dy * dy > TAP_PX * TAP_PX) press.moved = true;
  };

  const endGesture = (event, cancelled) => {
    if (!gesture || (event && event.pointerId !== gesture.id)) return;
    const axis = gesture.axis;
    gesture = null;
    detachPointer();
    releaseSlider(root);
    if (axis === "y" && press && (!event || event.pointerId === press.id)) {
      press.moved = true;
    }
    if (axis !== "x") {
      // Vertical / cancelled axis: finish the slide we already adopted, don't
      // treat leftover spring offset as a new swipe (that skipped or stuck).
      if (Math.abs(shift) > 0.5) settleShift(0, 0, index);
      return;
    }
    suppressClick();
    if (cancelled) {
      settleShift(0, 0, index);
      return;
    }
    commitFromRelease(sampleVel(gestureSamples) || velocity);
  };

  let gestureSamples = [];

  const onMove = (event) => {
    markPressMoved(event);
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (!gesture.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.05) {
        gesture.axis = "x";
        suppressClick();
        root.classList.add("is-dragging");
        releaseDeck();
      } else {
        gesture.axis = "y";
        if (press) press.moved = true;
        releaseSlider(root);
        return;
      }
    }

    if (gesture.axis !== "x") return;

    event.preventDefault();
    event.stopPropagation();
    shift = gesture.origin + dx;
    velocity = 0;
    gestureSamples.push({ x: shift, t: event.timeStamp || performance.now() });
    if (gestureSamples.length > 5) gestureSamples.shift();
    if (gestureSamples.length >= 2) velocity = sampleVel(gestureSamples);
    paint(shift);
    syncDots(index + committedSteps(0));
  };

  const onUp = (event) => {
    if (gesture && event.pointerId === gesture.id) {
      endGesture(event, false);
      return;
    }
    if (press && event.pointerId === press.id) detachPointer();
  };

  const onCancel = (event) => {
    if (press && event.pointerId === press.id) press = null;
    if (gesture && event.pointerId === gesture.id) {
      endGesture(event, true);
      return;
    }
    detachPointer();
  };

  root.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

  root.addEventListener(
    "pointerdown",
    (event) => {
      if (event.isPrimary === false) return;
      if (event.button && event.button !== 0) return;
      if (event.target.closest?.(IGNORE)) return;
      event.stopPropagation();
      if (gesture && event.pointerId !== gesture.id) {
        event.preventDefault();
        return;
      }
      if (gesture) return;

      detachPointer();
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };

      if (allowSwipe(event) && claimSlider(root)) {
        cancelSpring();
        adoptPending();
        releaseDeck();
        didSlide = false;
        gestureSamples = [{ x: shift, t: event.timeStamp || performance.now() }];
        gesture = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          origin: shift,
          axis: null,
        };
      }

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    true,
  );

  root.addEventListener(
    "touchmove",
    (event) => {
      if (!gesture || gesture.axis !== "x") return;
      if (event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  root.addEventListener(
    "click",
    (event) => {
      const swiped = didSlide || performance.now() < ignoreClickUntil;
      const moved = press?.moved;
      didSlide = false;
      press = null;

      if (event.target.closest?.(IGNORE)) return;
      if (swiped || moved) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!articleOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      // Desktop: open the shared fullscreen lightbox (author-works chrome).
      // Mobile: keep tap-to-advance; drag/swipe handles the rest.
      if (!isMobile()) {
        const items = galleryItems(slides);
        if (items.length) openLightboxGallery(items, pending, root);
        return;
      }
      goTo(pending + 1);
    },
    true,
  );

  finishIndex(0);

  const images = slides.flatMap(slideImages);
  images.forEach((img) => {
    img.draggable = false;
    img.setAttribute("draggable", "false");
  });
  const refresh = () => {
    measureTrack(root);
    paint(shift);
  };
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
