/**
 * The experiment-2 overlay paints its close button on top of this iframe,
 * in the same corner as every inner viewer. Viewers report when they are up
 * so that button (and Esc) leaves the picture, not the deck.
 *
 * A focused program card is not a viewer. `open` stays false for card focus
 * alone. If a leftover "program" holder is the only thing keeping the report
 * open when a picture closes, drop it so the parent chrome comes back.
 */

const closers = new Set();
/** Stacked pictures. Closing one must not clear another that is still open. */
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
 * `viewer` is an inner picture only. The mobile overlay close button
 * still dismisses the deck when the only thing up is a focused card.
 */
export function notifyDeckStageViewer(open, holder = "viewer") {
  if (!inDeckStage()) return;
  const key = holder || "viewer";
  if (open) holders.add(key);
  else {
    holders.delete(key);
    if (key !== "program" && holders.size === 1 && holders.has("program")) {
      holders.delete("program");
    }
  }
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
