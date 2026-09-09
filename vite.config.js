import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { lettersAdminPlugin } from "./vite-plugin-letters.js";
import { worksAdminPlugin } from "./vite-plugin-works.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const isCargo = process.env.KAIK_CARGO === "1";

/** Allow kaik.pictures / Cargo (and any other host) to frame this app. */
const embedHeaders = {
  "Content-Security-Policy": "frame-ancestors *",
};

/**
 * Prefix public-folder URLs when Vite `base` is not `/` (GitHub Pages `/kaik/`).
 * HTML keeps `/assets/...` in source; this rewrite makes `/kaik/assets/...` at build.
 */
function publicBaseUrls() {
  let prefix = "";

  function withBaseHtml(html) {
    if (!prefix) return html;
    return html.replace(
      /(\b(?:src|href|poster)\s*=\s*["'])\/(?!\/)((?:(?:assets|fonts|letters|works)\/|(?:program|admin|catalog|list|index)\.html)[^"']*)/gi,
      `$1${prefix}/$2`,
    );
  }

  function withBaseCss(css) {
    if (!prefix) return css;
    return css.replace(
      /url\(\s*(['"]?)\/((?:assets|fonts|letters|works)[^'")]+)\1\s*\)/gi,
      `url($1${prefix}/$2$1)`,
    );
  }

  return {
    name: "public-base-urls",
    configResolved(config) {
      const base = config.base || "/";
      prefix = !base || base === "/" || base === "./" ? "" : base.replace(/\/$/, "");
    },
    transformIndexHtml(html) {
      return withBaseHtml(html);
    },
    transform(code, id) {
      if (!prefix) return null;
      const file = id.split("?")[0];
      if (!file.endsWith(".css")) return null;
      const next = withBaseCss(code);
      return next === code ? null : next;
    },
    generateBundle(_opts, bundle) {
      if (!prefix) return;
      for (const item of Object.values(bundle)) {
        if (item.type === "asset" && typeof item.source === "string" && item.fileName.endsWith(".css")) {
          item.source = withBaseCss(item.source);
        }
      }
    },
  };
}

/** `/list` → `list/index.html` so GitHub Pages pretty paths work without the 404 SPA. */
function prettyHtmlDirs() {
  return {
    name: "pretty-html-dirs",
    writeBundle(options) {
      const outDir = options.dir || path.resolve(root, "dist");
      for (const name of ["list"]) {
        const src = path.join(outDir, `${name}.html`);
        if (!fs.existsSync(src)) continue;
        const dir = path.join(outDir, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(src, path.join(dir, "index.html"));
      }
    },
  };
}

export default defineConfig({
  base: isCargo ? "./" : "/",
  plugins: [react(), tailwindcss(), lettersAdminPlugin(), worksAdminPlugin(), publicBaseUrls(), prettyHtmlDirs()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
    cors: true,
    headers: embedHeaders,
    // Saving letters writes public/letters/* — don't full-reload catalog/admin (scroll jumps).
    watch: {
      ignored: ["**/public/letters/**", "**/public/works/**"],
    },
  },
  preview: {
    cors: true,
    headers: embedHeaders,
  },
  build: {
    ...(isCargo ? { cssCodeSplit: false } : {}),
    rollupOptions: {
      input: isCargo
        ? { main: path.resolve(root, "index.html") }
        : {
            main: path.resolve(root, "index.html"),
            admin: path.resolve(root, "admin.html"),
            program: path.resolve(root, "program.html"),
            catalog: path.resolve(root, "catalog.html"),
            experiment: path.resolve(root, "experiment.html"),
            list: path.resolve(root, "list.html"),
          },
    },
  },
});
