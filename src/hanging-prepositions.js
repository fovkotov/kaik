/**
 * Glue short Russian prepositions/particles to the next word with NBSP
 * so they cannot hang at the end of a line (висячие предлоги).
 *
 * Runtime text-node walker — do not hand-edit copy. Skips script/style/
 * form fields, code, SVG, URLs, attributes, and spaces that are already NBSP.
 */

export const NBSP = "\u00A0";

/** Glue-after particles (1–3 letters, plus «через»). Case variants are derived. */
export const HANGING_PARTICLES = [
  "в",
  "во",
  "на",
  "по",
  "из",
  "от",
  "до",
  "за",
  "к",
  "ко",
  "о",
  "об",
  "обо",
  "со",
  "у",
  "и",
  "а",
  "но",
  "да",
  "не",
  "ни",
  "ли",
  "же",
  "бы",
  "то",
  "я",
  "мы",
  "вы",
  "он",
  "она",
  "для",
  "без",
  "при",
  "над",
  "под",
  "про",
  "через",
];

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "INPUT",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
  "SVG",
  "MATH",
]);

const SKIP_SELECTOR =
  "script, style, textarea, input, noscript, code, pre, kbd, samp, svg, math";

function particleAlts(list) {
  const set = new Set();
  for (const particle of list) {
    set.add(particle);
    set.add(particle.charAt(0).toUpperCase() + particle.slice(1));
    set.add(particle.toUpperCase());
  }
  return [...set].sort((a, b) => b.length - a.length);
}

const PARTICLE_RE = new RegExp(
  `(?<=^|[^\\p{L}\\p{N}])(${particleAlts(HANGING_PARTICLES).join("|")})( +)(?=[\\p{L}\\p{N}«„“"'(])`,
  "gu",
);

const URL_RE = /https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi;

function glueChunk(chunk) {
  PARTICLE_RE.lastIndex = 0;
  return chunk.replace(PARTICLE_RE, (_match, particle) => particle + NBSP);
}

export function glueHangingText(text) {
  if (!text || !text.includes(" ")) return text;

  URL_RE.lastIndex = 0;
  if (!URL_RE.test(text)) return glueChunk(text);

  URL_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  let match;
  while ((match = URL_RE.exec(text))) {
    out += glueChunk(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  out += glueChunk(text.slice(last));
  return out;
}

function isSkippedParent(el) {
  if (!el) return true;
  if (SKIP_TAGS.has(el.nodeName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest?.(SKIP_SELECTOR)) return true;
  if (el.closest?.("[contenteditable=true]")) return true;
  return false;
}

function applyToTextNode(node) {
  const value = node.nodeValue;
  if (!value || !value.includes(" ")) return;
  if (isSkippedParent(node.parentElement)) return;
  const next = glueHangingText(value);
  if (next !== value) node.nodeValue = next;
}

export function glueHangingPrepositions(root = document.body) {
  if (!root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    applyToTextNode(root);
    return;
  }

  if (
    root.nodeType !== Node.ELEMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE && isSkippedParent(root)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes(" ")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (isSkippedParent(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  nodes.forEach(applyToTextNode);
}

let started = false;

export function initHangingPrepositions() {
  if (started || typeof document === "undefined") return;
  started = true;

  const run = () => glueHangingPrepositions(document.body);
  run();

  document.addEventListener("kaik:translated", run);

  const observer = new MutationObserver((mutations) => {
    observer.disconnect();
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        applyToTextNode(mutation.target);
      } else if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => glueHangingPrepositions(node));
      }
    }
    observe();
  });

  function observe() {
    if (!document.body) return;
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  observe();
}
