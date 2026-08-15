/** Public-folder URL that respects Vite `base` (Vercel `/`, GitHub Pages `/kaik/`). */
export function publicUrl(path = "") {
  const base = import.meta.env.BASE_URL || "/";
  const clean = String(path).replace(/^\/+/, "");
  return `${base}${clean}`;
}
