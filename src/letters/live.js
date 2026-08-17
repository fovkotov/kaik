/** Soft-pull catalog.json without a full page reload (Vite used to full-reload on public/letters writes). */
export const LETTERS_CATALOG_EVENT = "letters-catalog";

export function sameCatalog(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.updatedAt && b.updatedAt) {
    return a.updatedAt === b.updatedAt && (a.letters?.length || 0) === (b.letters?.length || 0);
  }
  return (a.letters?.length || 0) === (b.letters?.length || 0);
}

export function subscribeCatalog(onUpdate) {
  const run = () => {
    if (document.visibilityState === "hidden") return;
    onUpdate();
  };

  if (import.meta.hot) {
    import.meta.hot.on(LETTERS_CATALOG_EVENT, run);
  }

  document.addEventListener("visibilitychange", run);
  const timer = window.setInterval(run, 3000);

  return () => {
    document.removeEventListener("visibilitychange", run);
    window.clearInterval(timer);
    import.meta.hot?.off(LETTERS_CATALOG_EVENT, run);
  };
}
