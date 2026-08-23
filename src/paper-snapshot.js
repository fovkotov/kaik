function absolutize(url) {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function collectFontFaces() {
  const chunks = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        chunks.push(
          rule.cssText.replace(/url\(\s*(['"]?)(\/[^'")]+)\1\s*\)/g, (_, q, path) => {
            const abs = absolutize(path);
            return `url(${q}${abs}${q})`;
          }),
        );
      }
    }
  }
  return chunks.join("\n");
}

function inlineComputed(source, dest) {
  const from = [source, ...source.querySelectorAll("*")];
  const to = [dest, ...dest.querySelectorAll("*")];
  const count = Math.min(from.length, to.length);
  for (let i = 0; i < count; i += 1) {
    const cs = getComputedStyle(from[i]);
    let css = "";
    for (let j = 0; j < cs.length; j += 1) {
      const prop = cs.item(j);
      css += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    to[i].setAttribute("style", css);
  }
}

async function inlineImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      const abs = absolutize(src);
      try {
        const res = await fetch(abs);
        const blob = await res.blob();
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        img.setAttribute("src", data);
      } catch {
        img.setAttribute("src", abs);
      }
    }),
  );
}

function isMostlyBlank(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const { width, height } = canvas;
  if (!width || !height) return true;
  const sample = ctx.getImageData(0, 0, Math.min(width, 24), Math.min(height, 24));
  let ink = 0;
  for (let i = 0; i < sample.data.length; i += 4) {
    const a = sample.data[i + 3];
    if (a < 8) continue;
    const r = sample.data[i];
    const g = sample.data[i + 1];
    const b = sample.data[i + 2];
    if (Math.abs(r - 43) + Math.abs(g - 182) + Math.abs(b - 115) > 24) ink += 1;
  }
  return ink < 6;
}

/**
 * Rasterize a live in-document node (styles already applied) to a canvas.
 * @param {HTMLElement} node
 * @returns {Promise<HTMLCanvasElement | null>}
 */
export async function snapshotNode(node) {
  const width = Math.max(1, Math.round(node.offsetWidth || node.scrollWidth));
  const height = Math.max(1, Math.round(node.scrollHeight || node.offsetHeight));
  const clone = /** @type {HTMLElement} */ (node.cloneNode(true));
  clone.style.transform = "none";
  clone.style.position = "static";
  clone.style.top = "auto";
  clone.style.left = "auto";
  clone.style.willChange = "auto";

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-12000px;top:0;width:${width}px;height:${height}px;overflow:visible;pointer-events:none;`;
  host.append(clone);
  document.body.append(host);

  try {
    inlineComputed(node, clone);
    await inlineImages(clone);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;margin:0;background:#2bb673">` +
      `<style>${collectFontFaces()}</style>${xhtml}</div></foreignObject></svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (isMostlyBlank(canvas)) return null;
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  } finally {
    host.remove();
  }
}
