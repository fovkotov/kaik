import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { initEmbed } from "@/embed.js";
import { applyTranslations, getLocale } from "@/scriptik.js";
import { AdminApp } from "@/admin/App";
import "@/admin.css";

initEmbed();
applyTranslations(getLocale());

createRoot(document.getElementById("admin-root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <TooltipProvider>
        <AdminApp />
        {/* Toasts stack above the bottom-right loader pill. */}
        <Toaster position="bottom-right" offset={{ bottom: 56, right: 16 }} mobileOffset={{ bottom: 56 }} />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
