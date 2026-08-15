import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { lettersAdminPlugin } from "./vite-plugin-letters.js";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Allow kaik.pictures / Cargo (and any other host) to frame this app. */
const embedHeaders = {
  "Content-Security-Policy": "frame-ancestors *",
};

/** Prefix leftover same-origin page links when `base` is not `/` (GitHub Pages). */
function pagesHtmlLinks() {
  let base = "/";
  return {
    name: "pages-html-links",
    configResolved(config) {
      base = config.base || "/";
    },
    transformIndexHtml(html) {
      if (!base || base === "/") return html;
      const prefix = base.endsWith("/") ? base : `${base}/`;
      return html.replace(/href="\/((?:program|admin|catalog|index)\.html)"/g, `href="${prefix}$1"`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), lettersAdminPlugin(), pagesHtmlLinks()],
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
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
        admin: path.resolve(root, "admin.html"),
        program: path.resolve(root, "program.html"),
        catalog: path.resolve(root, "catalog.html"),
      },
    },
  },
});
