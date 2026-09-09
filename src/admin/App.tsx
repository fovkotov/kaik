import { useEffect, useState } from "react";
import { getLocale, t } from "@/scriptik.js";
import { WorksPanel } from "./WorksPanel";

export function AdminApp() {
  const locale = getLocale() as "en" | "ru";
  const [writable, setWritable] = useState(true);
  const copy = (key: string) => t(key, locale);

  useEffect(() => {
    let alive = true;
    fetch("/api/works")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (alive) setWritable(Boolean(res.ok && data.writable));
      })
      .catch(() => {
        if (alive) setWritable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-[var(--frame-h)] bg-background">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 pb-24">
        <WorksPanel copy={copy} writable={writable} />
      </main>
    </div>
  );
}
