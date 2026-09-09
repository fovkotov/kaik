import { WORKS_CATALOG_EVENT } from "./taxonomy.js";

export { WORKS_CATALOG_EVENT };

export function sameWorksCatalog(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.updatedAt && b.updatedAt) {
    return a.updatedAt === b.updatedAt && (a.items?.length || 0) === (b.items?.length || 0);
  }
  return (a.items?.length || 0) === (b.items?.length || 0);
}

export function subscribeWorksCatalog(onUpdate) {
  const run = () => {
    if (document.visibilityState === "hidden") return;
    onUpdate();
  };

  if (import.meta.hot) {
    import.meta.hot.on(WORKS_CATALOG_EVENT, run);
  }

  if (import.meta.env.DEV) {
    document.addEventListener("visibilitychange", run);
  }

  return () => {
    document.removeEventListener("visibilitychange", run);
    import.meta.hot?.off(WORKS_CATALOG_EVENT, run);
  };
}
