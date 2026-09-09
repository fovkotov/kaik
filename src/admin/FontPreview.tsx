import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const EN = ["kaik", "letter", "type", "form", "serif", "stroke"];
const RU = ["каик", "буква", "набор", "слово", "шрифт", "форма"];

function pickWord(id: string, lang: "en" | "ru") {
  const list = lang === "ru" ? RU : EN;
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return list[n % list.length];
}

function familyName(id: string) {
  return `wrk-${id.replace(/[^a-z0-9]/gi, "") || "font"}`;
}

export function FontPreview({
  url,
  id,
  className,
}: {
  url: string;
  id: string;
  className?: string;
}) {
  const [word, setWord] = useState("");
  const family = familyName(id);

  useEffect(() => {
    let gone = false;
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          if (!gone) setWord(pickWord(id, "en"));
          return;
        }
        ctx.font = `48px "${family}", serif`;
        const w = ctx.measureText("W").width;
        const zh = ctx.measureText("Ж").width;
        ctx.font = "48px serif";
        const latin = Math.abs(w - ctx.measureText("W").width) > 0.8;
        const cyr = Math.abs(zh - ctx.measureText("Ж").width) > 0.8;
        let lang: "en" | "ru" = "en";
        if (latin && cyr) lang = id.charCodeAt(0) % 2 ? "ru" : "en";
        else if (cyr && !latin) lang = "ru";
        if (!gone) setWord(pickWord(id, lang));
      })
      .catch(() => {
        if (!gone) setWord(pickWord(id, "en"));
      });
    return () => {
      gone = true;
    };
  }, [url, id, family]);

  return (
    <p
      className={cn("flex size-full items-center justify-center truncate px-2 text-2xl", className)}
      style={word ? { fontFamily: `"${family}", sans-serif` } : undefined}
    >
      {word || "…"}
    </p>
  );
}
