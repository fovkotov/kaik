/** Inner face scrolls when expand-host must not itself be the scroller. */
export function focusScrollRoot(card) {
  if (!(card instanceof HTMLElement)) return card;
  if (card.hasAttribute("data-works-card")) {
    return card.querySelector(".works-card") || card;
  }
  if (card.hasAttribute("data-expand-host") && card.hasAttribute("data-program-card")) {
    return card.querySelector(".program-card") || card;
  }
  return card;
}
