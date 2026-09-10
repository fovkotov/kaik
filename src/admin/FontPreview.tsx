import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { shapeFontText } from "@/works/font-display.js";

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
  text,
  caps,
  latin,
  className,
}: {
  url: string;
  id: string;
  /** Specimen text; when empty a word is auto-picked by the font's script. */
  text?: string;
  caps?: boolean;
  latin?: boolean;
  className?: string;
}) {
  const [word, setWord] = useState("");
  const family = familyName(id);
  const flags = { caps: Boolean(caps), latin: Boolean(latin) };
  const custom = shapeFontText((text || "").trim(), flags);

  useEffect(() => {
    let gone = false;
    const face = new FontFace(family, `url(${JSON.stringify(url)})`);
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        if (custom) {
          if (!gone) setWord(custom);
          return;
        }
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          if (!gone) setWord(shapeFontText(pickWord(id, "en"), flags));
          return;
        }
        ctx.font = `48px "${family}", serif`;
        const w = ctx.measureText("W").width;
        const zh = ctx.measureText("Ж").width;
        ctx.font = "48px serif";
        const hasLatin = Math.abs(w - ctx.measureText("W").width) > 0.8;
        const cyr = Math.abs(zh - ctx.measureText("Ж").width) > 0.8;
        let lang: "en" | "ru" = "en";
        if (!flags.latin) {
          if (hasLatin && cyr) lang = id.charCodeAt(0) % 2 ? "ru" : "en";
          else if (cyr && !hasLatin) lang = "ru";
        }
        if (!gone) setWord(shapeFontText(pickWord(id, lang), flags));
      })
      .catch(() => {
        if (!gone) setWord(custom || shapeFontText(pickWord(id, "en"), flags));
      });
    return () => {
      gone = true;
    };
  }, [url, id, family, custom, flags.caps, flags.latin]);

  return (
    <p
      className={cn("flex size-full items-center justify-center truncate px-2 text-2xl", className)}
      style={word ? { fontFamily: `"${family}", sans-serif` } : undefined}
    >
      {word || "…"}
    </p>
  );
}
