import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { lettersAdminPlugin } from "./vite-plugin-letters.js";

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
      /(\b(?:src|href|poster)\s*=\s*["'])\/(?!\/)((?:(?:assets|fonts|letters)\/|(?:program|admin|catalog|index)\.html)[^"']*)/gi,
      `$1${prefix}/$2`,
    );
  }

  function withBaseCss(css) {
    if (!prefix) return css;
    return css.replace(
      /url\(\s*(['"]?)\/((?:assets|fonts|letters)[^'")]+)\1\s*\)/gi,
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

export default defineConfig({
  base: isCargo ? "./" : "/",
  plugins: [react(), tailwindcss(), lettersAdminPlugin(), publicBaseUrls()],
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
          },
    },
  },
});
