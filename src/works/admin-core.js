import { randomBytes } from "node:crypto";
import { sanitizeSvg } from "../letters/svg.js";
import { hydrateWorksCatalog, normalizeName, normalizeNick, normalizeWorkType } from "./taxonomy.js";

export function shortId() {
  return randomBytes(4).toString("hex");
}

const pendingUploads = new Map();

export function rememberPendingUpload(buffer) {
  const sha = `local_${randomBytes(16).toString("hex")}`;
  pendingUploads.set(sha, Buffer.from(buffer));
  return sha;
}

export function takePendingUpload(sha) {
  const key = String(sha || "");
  const buffer = pendingUploads.get(key);
  if (buffer) pendingUploads.delete(key);
  return buffer;
}

export function extFrom(name, mime) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  if (String(mime).includes("svg")) return ".svg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg") return ".jpg";
  if (String(mime).includes("woff2")) return ".woff2";
  if (String(mime).includes("woff")) return ".woff";
  if (String(mime).includes("font") || String(mime).includes("otf")) return ".otf";
  if (String(mime).includes("ttf")) return ".ttf";
  return ".bin";
}

export function mimeFromName(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "woff2") return "font/woff2";
  if (ext === "woff") return "font/woff";
  if (ext === "ttf") return "font/ttf";
  if (ext === "otf") return "font/otf";
  return "application/octet-stream";
}

export function decodeUpload(file) {
  const mime = String(file?.mime || "");
  const data = String(file?.data || "");
  const filename = String(file?.filename || "file");
  if (mime.includes("svg") || data.trim().startsWith("<")) {
    const svg = sanitizeSvg(data);
    return { buffer: Buffer.from(svg, "utf8"), ext: ".svg" };
  }
  const raw = data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("Empty file");
  return { buffer, ext: extFrom(filename, mime) };
}

export function sizeFromSvg(svg) {
  const view = String(svg).match(/viewBox=["']([\d.\s,-]+)["']/i);
  if (view) {
    const parts = view[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  const w = Number(String(svg).match(/\bwidth=["']([\d.]+)/i)?.[1]);
  const h = Number(String(svg).match(/\bheight=["']([\d.]+)/i)?.[1]);
  if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  return { width: 0, height: 0 };
}

export function fieldsFromBody(item, previous = {}) {
  const type = normalizeWorkType(item.type ?? previous.type);
  const author = normalizeName(item.author !== undefined ? item.author : previous.author);
  const nick = normalizeNick(item.nick !== undefined ? item.nick : previous.nick);
  const stream = String(item.stream !== undefined ? item.stream : previous.stream || "").trim();
  if (!stream) throw new Error("Each work needs a stream");
  const width = Number(item.width ?? previous.width) || 0;
  const height = Number(item.height ?? previous.height) || 0;
  return { type, author, nick, stream, width, height };
}

// `uploads` may mix new files (data/sha) with `{ keep: "<existing name>" }`
// entries that reference files the work already owns — used for per-slide
// replace/remove/reorder without re-uploading untouched slides.
export function uploadsToFiles(id, uploads, existing = []) {
  const files = [];
  const blobs = [];
  let width = 0;
  let height = 0;
  const kept = new Set(
    uploads.filter((upload) => upload?.keep).map((upload) => String(upload.keep)),
  );
  const nameFor = (index, ext) => {
    const plain = `${id}_${index}${ext}`;
    return kept.has(plain) ? `${id}_${index}_${shortId()}${ext}` : plain;
  };
  for (const [index, upload] of uploads.entries()) {
    if (upload?.keep) {
      const name = String(upload.keep);
      if (!existing.includes(name) || files.includes(name)) throw new Error("Unknown file");
      files.push(name);
      continue;
    }
    if (upload?.sha && !upload?.data) {
      const file = nameFor(index, extFrom(upload.filename, upload.mime));
      files.push(file);
      blobs.push({ name: file, sha: String(upload.sha) });
      continue;
    }
    const decoded = decodeUpload(upload);
    const file = nameFor(index, decoded.ext);
    files.push(file);
    blobs.push({ name: file, buffer: decoded.buffer });
    if (!width && decoded.ext === ".svg") {
      const size = sizeFromSvg(decoded.buffer.toString("utf8"));
      width = size.width;
      height = size.height;
    }
  }
  return { files, blobs, width, height };
}

export function withMeta(catalog) {
  return hydrateWorksCatalog(catalog);
}

export function stampCatalog(catalog) {
  return {
    ...catalog,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}
