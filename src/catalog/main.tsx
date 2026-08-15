import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initEmbed } from "@/embed.js";
import { applyTranslations, getLocale } from "@/scriptik.js";
import { CatalogApp } from "@/catalog/App";

initEmbed();
applyTranslations(getLocale());

createRoot(document.getElementById("catalog-root")!).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>,
);
