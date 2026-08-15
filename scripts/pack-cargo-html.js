/**
 * Pack dist/index.html into one self-contained file for Cargo Files.
 * Cargo has no folders — every upload gets its own CDN URL — so JS, CSS,
 * fonts, images and letter SVGs must live inside the HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const inputHtml = path.join(dist, "index.html");
const outputHtml = path.join(dist, "kaik.html");

const MIME = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function dataUri(abs) {
  const mime = mimeFor(abs);
  const buf = fs.readFileSync(abs);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function relFromDist(abs) {
  return path.relative(dist, abs).split(path.sep).join("/");
}

function cleanRef(ref) {
  return decodeURIComponent(String(ref).trim().split("#")[0].split("?")[0])
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

function lookupFile(files, ref) {
  if (!ref || /^(?:data:|https?:|mailto:|tel:|#|javascript:)/i.test(ref)) return null;
  const stripped = cleanRef(ref);
  const candidates = [
    stripped,
    path.posix.normalize(stripped),
    // Vite CSS lives in dist/assets/, so url(../fonts/x) means dist/fonts/x
    path.posix.normalize(`assets/${stripped}`),
  ];
  for (const key of candidates) {
    if (!key || key.startsWith("../") || key === "..") continue;
    if (files.has(key)) return files.get(key);
  }
  return null;
}

function inlineSheetAndScripts(html) {
  let next = html;

  next = next.replace(
    /<link\b[^>]*rel=["'](?:stylesheet|modulepreload)["'][^>]*>/gi,
    (tag) => {
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href || /^(?:data:|https?:|\/\/)/i.test(href)) return tag;
      if (/rel=["']modulepreload["']/i.test(tag)) return "";
      const abs = path.resolve(dist, cleanRef(href));
      if (!fs.existsSync(abs) || path.extname(abs) !== ".css") return tag;
      return `<style>\n${fs.readFileSync(abs, "utf8")}\n</style>`;
    },
  );

  next = next.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi, (tag, src) => {
    if (/^(?:data:|https?:|\/\/)/i.test(src)) return tag;
    const abs = path.resolve(dist, cleanRef(src));
    if (!fs.existsSync(abs)) return tag;
    const type = /type=["']module["']/i.test(tag) ? ' type="module"' : "";
    return `<script${type}>\n${fs.readFileSync(abs, "utf8")}\n</script>`;
  });

  return next;
}

function fetchShim(files) {
  const payload = {};
  for (const [key, uri] of files) {
    if (key.startsWith("letters/")) payload[key] = uri;
  }
  return `<script>
(function () {
  var FILES = ${JSON.stringify(payload)};
  var orig = window.fetch;
  window.fetch = function (input, init) {
    try {
      var raw = typeof input === "string" ? input : (input && input.url) || "";
      var path = raw.split("?")[0].split("#")[0];
      var i = path.indexOf("letters/");
      if (i >= 0) {
        var key = path.slice(i);
        var data = FILES[key];
        if (data) {
          var comma = data.indexOf(",");
          var meta = data.slice(0, comma);
          var b64 = data.slice(comma + 1);
          var mime = (meta.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
          var bin = atob(b64);
          var bytes = new Uint8Array(bin.length);
          for (var n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
          return Promise.resolve(new Response(bytes, { status: 200, headers: { "Content-Type": mime } }));
        }
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
})();
</script>`;
}

function rewriteRefs(html, files) {
  const lookup = (ref) => lookupFile(files, ref);

  let next = html.replace(
    /(\b(?:src|href|poster)\s*=\s*)(["'])([^"']+)\2/gi,
    (all, attr, quote, ref) => {
      const uri = lookup(ref);
      return uri ? `${attr}${quote}${uri}${quote}` : all;
    },
  );

  next = next.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, quote, ref) => {
    const uri = lookup(ref);
    return uri ? `url(${quote || ""}${uri}${quote || ""})` : all;
  });

  return next;
}

if (!fs.existsSync(inputHtml)) {
  console.error("dist/index.html not found — run vite build first");
  process.exit(1);
}

const files = new Map();
for (const abs of walk(dist)) {
  const rel = relFromDist(abs);
  if (!rel || rel === "index.html" || rel === "kaik.html" || rel === "host.html") continue;
  if (rel.endsWith(".html")) continue;
  files.set(rel, dataUri(abs));
}

let html = fs.readFileSync(inputHtml, "utf8");
html = inlineSheetAndScripts(html);
html = rewriteRefs(html, files);
html = html.replace(/<head([^>]*)>/i, `<head$1>\n${fetchShim(files)}`);

fs.writeFileSync(outputHtml, html);
const mb = (fs.statSync(outputHtml).size / (1024 * 1024)).toFixed(1);
console.log(`wrote ${path.relative(root, outputHtml)} (${mb} MB)`);
