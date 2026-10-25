/**
 * The experiment-2 page paints its filter row and schedule chip above this
 * iframe. Viewers report when they are up so that chrome (and the overlay
 * close button) leaves the picture, not the deck.
 *
 * A focused card reports the "program" holder on a phone. `viewer` stays
 * false for that, so desktop chrome hides only for a real picture. Closing
 * a picture while the card is still focused must keep the program holder —
 * the phone chrome stays hidden until the card itself closes. A leftover
 * program holder with no focused card is dropped so the chrome can return.
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
 * `viewer` is an inner picture only. Card focus uses the "program" holder
 * and leaves `viewer` false, so the overlay close button still dismisses
 * the deck when the only thing up is a focused card.
 */
export function notifyDeckStageViewer(open, holder = "viewer") {
  if (!inDeckStage()) return;
  const key = holder || "viewer";
  if (open) holders.add(key);
  else {
    holders.delete(key);
    const cardFocused = document.documentElement.classList.contains("is-focus-frozen");
    if (key !== "program" && holders.size === 1 && holders.has("program") && !cardFocused) {
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
