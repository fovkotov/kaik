/**
 * The experiment-2 overlay paints its close button on top of this iframe,
 * in the same corner as every inner viewer. Viewers report when they are up
 * so that button (and Esc) leaves the picture, not the deck.
 */

const closers = new Set();
/** Separate holders so a nested lightbox close does not clear a still-open card. */
const holders = new Set();
let reported = false;
let reportedViewer = false;

function inDeckStage() {
  return (
    document.documentElement.classList.contains("deck-stage") &&
    window.parent &&
    window.parent !== window
  );
}

/**
 * `open` is any fullscreen (focused card or inner viewer).
 * `viewer` is an inner picture only — the mobile overlay close button
 * still dismisses the deck when the only thing up is a focused card.
 */
export function notifyDeckStageViewer(open, holder = "viewer") {
  if (!inDeckStage()) return;
  const key = holder || "viewer";
  if (open) holders.add(key);
  else holders.delete(key);
  const next = holders.size > 0;
  const viewer = [...holders].some((name) => name !== "program");
  if (next === reported && viewer === reportedViewer) return;
  reported = next;
  reportedViewer = viewer;
  window.parent.postMessage({ type: "kaik:deck-stage-viewer", open: next, viewer }, "*");
}

export function bindDeckStageViewerClose(close) {
  closers.add(close);
}

export function closeDeckStageViewers() {
  for (const close of closers) close();
}

window.addEventListener("message", (event) => {
  if (!document.documentElement.classList.contains("deck-stage")) return;
  if (event.origin !== window.location.origin) return;
  if (event.source !== window.parent) return;
  if (event.data?.type !== "kaik:deck-stage-viewer-close") return;
  for (const close of closers) close();
});
