const SCRIPT = /<script[\s\S]*?<\/script>/gi;
const FOREIGN = /<foreignObject[\s\S]*?<\/foreignObject>/gi;
const EVENT_ATTR = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /javascript:/gi;

export function sanitizeSvg(raw) {
  const text = String(raw ?? "").trim();
  if (!/<svg[\s>]/i.test(text)) {
    throw new Error("File is not an SVG");
  }

  let svg = text
    .replace(SCRIPT, "")
    .replace(FOREIGN, "")
    .replace(EVENT_ATTR, "")
    .replace(JS_URL, "");

  if (!/\sxmlns=/.test(svg.match(/<svg\b[^>]*>/i)?.[0] || "")) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  return svg;
}

export function prefixSvgIds(svg, prefix) {
  const ids = [...String(svg).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  let out = String(svg);

  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`id="${safe}"`, "g"), `id="${prefix}-${id}"`);
    out = out.replace(new RegExp(`url\\(#${safe}\\)`, "g"), `url(#${prefix}-${id})`);
    out = out.replace(new RegExp(`href="#${safe}"`, "g"), `href="#${prefix}-${id}"`);
    out = out.replace(
      new RegExp(`xlink:href="#${safe}"`, "g"),
      `xlink:href="#${prefix}-${id}"`,
    );
  }

  return out;
}

export function svgToInline(svg, prefix) {
  const cleaned = sanitizeSvg(svg)
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!DOCTYPE[\s\S]*?>/i, "")
    .trim();
  const prefixed = prefixSvgIds(cleaned, prefix);
  return prefixed.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    const next = String(attrs)
      .replace(/\swidth="[^"]*"/i, "")
      .replace(/\sheight="[^"]*"/i, "");
    return `<svg${next}>`;
  });
}
