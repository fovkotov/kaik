import { normalizeChar } from "./shared.js";

export const KIND_LETTER = "letter";
export const KIND_WORD = "word";
export const KINDS = [KIND_LETTER, KIND_WORD];

/** How the form is built. */
export const CONSTRUCTIONS = ["modular", "stylized", "experimental"];

/** Historical / stylistic family. */
export const FAMILIES = ["gothic", "antiqua", "grotesque", "script", "display"];

export function normalizeKind(value) {
  return value === KIND_WORD ? KIND_WORD : KIND_LETTER;
}

export function normalizeTag(value, allowed) {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return allowed.includes(key) ? key : "";
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function inferTextFromFilename(filename) {
  return normalizeText(
    String(filename || "")
      .replace(/^.*[/\\]/, "")
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " "),
  );
}

export function entryKind(item) {
  return normalizeKind(item?.kind);
}

export function isLetter(item) {
  return entryKind(item) === KIND_LETTER;
}

export function isWord(item) {
  return entryKind(item) === KIND_WORD;
}

export function entryLabel(item) {
  if (isWord(item)) return normalizeText(item?.text) || item?.char || "";
  return item?.char || "";
}

/** Fill missing fields on old catalog rows without rewriting the file. */
export function normalizeEntry(item) {
  if (!item || typeof item !== "object") return null;
  const kind = normalizeKind(item.kind);
  const text = kind === KIND_WORD ? normalizeText(item.text) : "";
  const char =
    kind === KIND_LETTER
      ? normalizeChar(item.char)
      : normalizeChar(item.char) || normalizeChar(text);
  return {
    ...item,
    kind,
    char,
    text,
    construction: normalizeTag(item.construction, CONSTRUCTIONS),
    family: normalizeTag(item.family, FAMILIES),
  };
}
