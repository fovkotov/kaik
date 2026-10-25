/**
 * The experiment-2 overlay paints its close button on top of this iframe,
 * in the same corner as every inner viewer. Viewers report when they are up
 * so that button (and Esc) leaves the picture, not the deck.
 */

const closers = new Set();
let reported = false;

function inDeckStage() {
  return (
    document.documentElement.classList.contains("deck-stage") &&
    window.parent &&
    window.parent !== window
  );
}

export function notifyDeckStageViewer(open) {
  if (!inDeckStage()) return;
  const next = Boolean(open);
  if (next === reported) return;
  reported = next;
  window.parent.postMessage({ type: "kaik:deck-stage-viewer", open: next }, "*");
}

export function bindDeckStageViewerClose(close) {
  closers.add(close);
}

window.addEventListener("message", (event) => {
  if (!document.documentElement.classList.contains("deck-stage")) return;
  if (event.origin !== window.location.origin) return;
  if (event.source !== window.parent) return;
  if (event.data?.type !== "kaik:deck-stage-viewer-close") return;
  for (const close of closers) close();
});
