import { openLightboxGallery } from "./author-lightbox.js";
import { openProjectViewer, projectViewerKey } from "./project-viewer.js";

const STRIP = "[data-program-strip]";
const TRACK = "[data-program-track]";
const PREV = "[data-program-strip-prev]";
const NEXT = "[data-program-strip-next]";
const NAV = "[data-program-strip-prev], [data-program-strip-next], .program-card__cap";
const AXIS_PX = 8;
const TAP_PX = AXIS_PX;
const FINE = window.matchMedia("(hover: hover) and (pointer: fine)");
const MOBILE = window.matchMedia("(max-width: 900px)");
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
const EASE_OUT = "transform 320ms cubic-bezier(0.23, 1, 0.32, 1)";

function nativePan() {
  return MOBILE.matches || document.documentElement.classList.contains("is-mobile");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function cardOf(root) {
  return root.closest("[data-card]");
}

function cardOpen(root) {
  return Boolean(cardOf(root)?.classList.contains("is-program-open"));
}

function isSvgHref(href) {
  try {
    return new URL(href, document.baseURI).pathname.toLowerCase().endsWith(".svg");
  } catch {
    return /\.svg(?:$|[?#])/i.test(String(href));
  }
}

function fromImg(img) {
  const attr = img.getAttribute("src") || "";
  const resolved = img.src || "";
  const current = img.currentSrc || "";
  // Authored `.svg` wins over `currentSrc` (srcset / decode can pick a raster).
  const src = isSvgHref(attr) || isSvgHref(resolved) ? resolved || attr : current || resolved || attr;
  return {
    src,
    width: img.naturalWidth || Number(img.getAttribute("width")) || 1920,
    height: img.naturalHeight || Number(img.getAttribute("height")) || 1080,
    ink: img.classList.contains("program-card__mark") || isSvgHref(src) || isSvgHref(attr),
  };
}

function collectMedia(track) {
  const items = [];
  const seen = new Set();
  track.querySelectorAll(".program-card__shot").forEach((shot) => {
    const img = shot.querySelector("img");
    if (!img || seen.has(img)) return;
    seen.add(img);
    const item = fromImg(img);
    if (item.src) items.push({ el: shot, ...item });
  });
  track.querySelectorAll("img.program-card__mark").forEach((img) => {
    if (seen.has(img) || img.closest(".program-card__shot")) return;
    seen.add(img);
    const item = fromImg(img);
    if (item.src) items.push({ el: img, ...item });
  });
  return items;
}

function mediaFromEvent(event, track) {
  const shot = event.target.closest?.(".program-card__shot");
  if (shot && track.contains(shot)) return shot;
  const mark = event.target.closest?.("img.program-card__mark");
  if (mark && track.contains(mark)) return mark;
  return null;
}

function bindStrip(root) {
  const track = root.querySelector(TRACK);
  const prev = root.querySelector(PREV);
  const next = root.querySelector(NEXT);
  if (!track) return;

  let x = 0;
  let swipe = null;
  let press = null;
  let didSlide = false;
  let booted = false;
  const hideWait = new WeakMap();

  const viewW = () => root.clientWidth || 1;
  const minX = () => Math.min(0, viewW() - track.scrollWidth);
  const overflowing = () => track.scrollWidth > viewW() + 1;

  const paint = () => {
    if (nativePan()) {
      track.style.transform = "";
      return;
    }
    track.style.transform = `translate3d(${x}px,0,0)`;
  };

  const clearHideWait = (btn) => {
    const wait = hideWait.get(btn);
    if (!wait) return;
    btn.removeEventListener("transitionend", wait.onEnd);
    clearTimeout(wait.timer);
    hideWait.delete(btn);
  };

  const setNavGone = (btn, gone) => {
    if (!btn) return;
    if (gone) {
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("is-gone");
      if (btn.hidden || hideWait.has(btn)) return;
      if (!booted) {
        btn.hidden = true;
        return;
      }
      const finish = () => {
        hideWait.delete(btn);
        btn.hidden = true;
      };
      const onEnd = (event) => {
        if (event.target !== btn || event.propertyName !== "opacity") return;
        btn.removeEventListener("transitionend", onEnd);
        clearTimeout(timer);
        finish();
      };
      // Match `--nav-out` (120ms); keep a short buffer so hide never sticks mid-fade.
      const timer = setTimeout(() => {
        btn.removeEventListener("transitionend", onEnd);
        finish();
      }, REDUCE.matches ? 0 : 180);
      hideWait.set(btn, { onEnd, timer });
      btn.addEventListener("transitionend", onEnd);
      return;
    }
    clearHideWait(btn);
    btn.disabled = false;
    btn.setAttribute("aria-disabled", "false");
    const needsIn = btn.hidden || btn.classList.contains("is-gone");
    btn.hidden = false;
    if (needsIn && booted && !REDUCE.matches) {
      btn.classList.add("is-gone");
      void btn.offsetWidth;
      requestAnimationFrame(() => {
        btn.classList.remove("is-gone");
      });
      return;
    }
    btn.classList.remove("is-gone");
  };

  const syncNav = () => {
    const overflow = overflowing();
    root.classList.toggle("is-overflow", overflow);
    if (nativePan()) {
      setNavGone(prev, true);
      setNavGone(next, true);
      return;
    }
    const atStart = x >= -1;
    const atEnd = x <= minX() + 1;
    setNavGone(prev, !overflow || atStart);
    setNavGone(next, !overflow || atEnd);
  };

  const rubber = (raw) => {
    const lo = minX();
    const hi = 0;
    if (raw >= lo && raw <= hi) return raw;
    const factor = Math.max(48, viewW() * 0.42);
    if (raw > hi) {
      const over = raw - hi;
      return hi + over / (1 + over / factor);
    }
    const over = lo - raw;
    return lo - over / (1 + over / factor);
  };

  const apply = (nextX, animate, mode = "clamp") => {
    if (nativePan()) {
      track.style.transition = "none";
      track.style.transform = "";
      syncNav();
      return;
    }
    x = mode === "rubber" && !REDUCE.matches ? rubber(nextX) : clamp(nextX, minX(), 0);
    if (animate && !REDUCE.matches) {
      track.style.transition = EASE_OUT;
    } else {
      track.style.transition = "none";
    }
    paint();
    syncNav();
  };

  const step = (dir) => {
    apply(x + dir * viewW() * 0.72, true);
  };

  const onPrev = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overflowing() || prev?.disabled) return;
    step(1);
  };

  const onNext = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!overflowing() || next?.disabled) return;
    step(-1);
  };

  const bindNavPress = (btn) => {
    if (!btn) return;
    const down = (event) => {
      event.stopPropagation();
      btn.classList.add("is-pressed");
    };
    const up = () => btn.classList.remove("is-pressed");
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("lostpointercapture", up);
  };

  prev?.addEventListener("click", onPrev);
  next?.addEventListener("click", onNext);
  bindNavPress(prev);
  bindNavPress(next);

  const onPointerDown = (event) => {
    if (event.target.closest?.(NAV)) return;
    if (event.button && event.button !== 0) return;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      scroll: root.scrollLeft,
    };
    didSlide = false;
    if (nativePan()) return;
    if (!cardOpen(root)) return;
    if (!overflowing()) return;
    track.style.transition = "none";
    swipe = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: x,
      axis: null,
      lastX: event.clientX,
      lastT: event.timeStamp,
      vel: 0,
      captured: false,
    };
  };

  const onPointerMove = (event) => {
    if (press && event.pointerId === press.id && !press.moved) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_PX) {
        press.moved = true;
      }
      if (nativePan() && Math.abs(root.scrollLeft - press.scroll) > TAP_PX) {
        press.moved = true;
      }
    }
    if (nativePan() || !swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (!swipe.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
      swipe.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (swipe.axis !== "x") return;
      root.classList.add("is-swiping");
      try {
        root.setPointerCapture(event.pointerId);
        swipe.captured = true;
      } catch {
        swipe.captured = false;
      }
    }
    if (swipe.axis !== "x") return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    didSlide = true;
    const dt = event.timeStamp - swipe.lastT;
    if (dt > 0) {
      swipe.vel = ((event.clientX - swipe.lastX) / dt) * 1000;
      swipe.lastX = event.clientX;
      swipe.lastT = event.timeStamp;
    }
    apply(swipe.origin + dx, false, "rubber");
  };

  const onPointerUp = (event) => {
    if (press && event.pointerId === press.id) {
      // Keep `press` until click so a scroll-swipe does not open the lightbox.
    } else {
      press = null;
    }
    if (!swipe || event.pointerId !== swipe.id) return;
    const drifted = swipe.axis === "x";
    const vel = swipe.vel;
    if (swipe.captured) {
      try {
        root.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    swipe = null;
    root.classList.remove("is-swiping");
    const lo = minX();
    if (x > 0 || x < lo) {
      apply(clamp(x, lo, 0), true);
      return;
    }
    if (!drifted) {
      apply(x, false);
      return;
    }
    const coast = REDUCE.matches ? 0 : clamp(vel * 0.18, -420, 420);
    apply(x + coast, true);
  };

  const wheelPanDx = (event) => {
    const dx = event.deltaX;
    const dy = event.deltaY;
    if (event.shiftKey && Math.abs(dx) < Math.abs(dy)) return dy;
    if (Math.abs(dx) > Math.abs(dy)) return dx;
    return 0;
  };

  const onWheel = (event) => {
    if (nativePan() || !cardOpen(root) || !overflowing()) return;
    const dx = wheelPanDx(event);
    if (!dx) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    apply(x - dx, false);
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove, { passive: false });
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", (event) => {
    if (press && event.pointerId === press.id) press = null;
    onPointerUp(event);
  });
  root.addEventListener("dragstart", (event) => event.preventDefault());
  root.addEventListener("wheel", onWheel, { passive: false });

  root.addEventListener("click", (event) => {
    if (event.target.closest?.(NAV)) return;
    const scrolled =
      nativePan() && press && Math.abs(root.scrollLeft - press.scroll) > TAP_PX;
    const moved = Boolean(press?.moved) || didSlide || scrolled;
    press = null;
    didSlide = false;
    if (moved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const media = mediaFromEvent(event, track);
    if (!media) return;
    const items = collectMedia(track);
    const index = items.findIndex((item) => item.el === media);
    const project = projectViewerKey(media);
    if (!project && (!items.length || index < 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const lightbox = () => {
      if (!items.length || index < 0) return;
      openLightboxGallery(
        items.map(({ src, width, height, ink }) => ({ src, width, height, ink })),
        index,
        media,
      );
    };
    // A slide marked `data-project-viewer` opens that student's deck instead.
    if (project) {
      openProjectViewer(project, media).then((opened) => {
        if (!opened) lightbox();
      });
      return;
    }
    lightbox();
  });

  let lastView = 0;
  let lastTrack = 0;
  const syncMode = () => {
    const native = nativePan();
    root.classList.toggle("is-native-pan", native);
    if (!native) return;
    x = 0;
    track.style.transition = "none";
    track.style.transform = "";
    setNavGone(prev, true);
    setNavGone(next, true);
  };
  const refresh = () => {
    syncMode();
    const vw = viewW();
    const tw = track.scrollWidth;
    if (booted && vw === lastView && tw === lastTrack) return;
    lastView = vw;
    lastTrack = tw;
    if (nativePan()) {
      syncNav();
      booted = true;
      return;
    }
    apply(x, false);
    booted = true;
  };

  root.addEventListener("scroll", () => {
    if (!nativePan() || !press) return;
    if (Math.abs(root.scrollLeft - press.scroll) > TAP_PX) {
      press.moved = true;
      didSlide = true;
    }
  }, { passive: true });

  const ro = new ResizeObserver(refresh);
  ro.observe(root);
  ro.observe(track);
  track.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", refresh, { once: true });
  });

  refresh();
  root.classList.toggle("is-fine", FINE.matches);
  FINE.addEventListener?.("change", () => {
    root.classList.toggle("is-fine", FINE.matches);
  });
  MOBILE.addEventListener("change", refresh);
}

export function initProgramStrips(scope = document) {
  scope.querySelectorAll(STRIP).forEach(bindStrip);
}
