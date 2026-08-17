import { useEffect, useMemo, useState } from "react";
import {
  entriesOfKind,
  filterEntries,
  groupByChar,
  loadCatalog,
  uniqueValues,
} from "@/letters/catalog.js";
import { sameCatalog, subscribeCatalog } from "@/letters/live.js";
import { svgToInline } from "@/letters/svg.js";
import {
  CONSTRUCTIONS,
  FAMILIES,
  KIND_LETTER,
  KIND_WORD,
  entryLabel,
} from "@/letters/taxonomy.js";
import { publicUrl } from "@/public-url.js";
import { getLocale, setLocale as persistLocale, t } from "@/scriptik.js";

type Kind = typeof KIND_LETTER | typeof KIND_WORD;

type Work = {
  id: string;
  kind: Kind;
  char: string;
  text: string;
  file: string;
  author: string;
  stream: string;
  construction: string;
  family: string;
  createdAt?: string;
  updatedAt?: string;
};

type Catalog = {
  letters: Work[];
  updatedAt?: string | null;
};

const glyphCache = new Map<string, string>();

function sampleWord(char: string) {
  const ru: Record<string, string> = {
    А: "рхив",
    Б: "уквица",
    К: "äik",
    Л: "еттеринг",
    Э: "tter",
  };
  const en: Record<string, string> = {
    A: "rchive",
    K: "äik",
    L: "ettering",
  };
  return ru[char] || en[char] || t("admin.wordRest");
}

function readFilters() {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("kind") === KIND_WORD ? KIND_WORD : KIND_LETTER;
  return {
    kind,
    construction: params.get("construction") || "",
    family: params.get("family") || "",
    author: params.get("author") || "",
    stream: params.get("stream") || "",
    id: params.get("id") || "",
  };
}

function writeFilters(next: ReturnType<typeof readFilters>) {
  const params = new URLSearchParams();
  if (next.kind === KIND_WORD) params.set("kind", KIND_WORD);
  if (next.construction) params.set("construction", next.construction);
  if (next.family) params.set("family", next.family);
  if (next.author) params.set("author", next.author);
  if (next.stream) params.set("stream", next.stream);
  if (next.id) params.set("id", next.id);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}

function Glyph({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function glyphStamp(item: Work) {
  return item.updatedAt || item.createdAt || "";
}

function WorkGlyph({ item, className }: { item: Work; className?: string }) {
  const stamp = glyphStamp(item);
  const cacheKey = `${item.id}:${stamp}`;
  const [html, setHtml] = useState(() => glyphCache.get(cacheKey) || "");

  useEffect(() => {
    if (glyphCache.has(cacheKey)) {
      setHtml(glyphCache.get(cacheKey) || "");
      return;
    }
    let alive = true;
    fetch(`${publicUrl(`letters/${item.file}`)}?t=${encodeURIComponent(stamp)}`)
      .then((res) => res.text())
      .then((svg) => {
        const inline = svgToInline(svg, item.id);
        glyphCache.set(cacheKey, inline);
        if (alive) setHtml(inline);
      })
      .catch(() => {
        if (alive) setHtml("");
      });
    return () => {
      alive = false;
    };
  }, [cacheKey, item.file, item.id, stamp]);

  if (!html) {
    return <span>{entryLabel(item) || item.char}</span>;
  }
  return <Glyph html={html} className={className} />;
}

function Chip({
  on,
  children,
  onClick,
}: {
  on: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={on ? "archive-chip is-on" : "archive-chip"} onClick={onClick}>
      {children}
    </button>
  );
}

export function CatalogApp() {
  const [locale, setLocaleState] = useState(() => getLocale() as "en" | "ru");
  const [catalog, setCatalog] = useState<Catalog>({ letters: [] });
  const [filters, setFilters] = useState(readFilters);

  const copy = (key: string) => t(key, locale);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      loadCatalog({ bust: true }).then((data) => {
        if (!alive) return;
        setCatalog((current) => (sameCatalog(current, data) ? current : (data as Catalog)));
      });
    };
    pull();
    const stop = subscribeCatalog(pull);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  useEffect(() => {
    writeFilters(filters);
  }, [filters]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilters((current) => ({ ...current, id: "" }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function changeLocale(next: string) {
    if (next !== "en" && next !== "ru") return;
    persistLocale(next);
    setLocaleState(next);
  }

  function patch(partial: Partial<typeof filters>) {
    setFilters((current) => {
      const next = { ...current, ...partial };
      if ("kind" in partial || "construction" in partial || "family" in partial) {
        next.id = partial.id ?? "";
      }
      return next;
    });
  }

  const pool = useMemo(
    () => entriesOfKind(catalog, filters.kind) as Work[],
    [catalog, filters.kind],
  );
  const authors = useMemo(() => uniqueValues(catalog, "author", pool), [catalog, pool]);
  const streams = useMemo(() => uniqueValues(catalog, "stream", pool), [catalog, pool]);
  const items = useMemo(
    () =>
      filterEntries(pool, {
        construction: filters.construction,
        family: filters.family,
        author: filters.author,
        stream: filters.stream,
      }) as Work[],
    [pool, filters.construction, filters.family, filters.author, filters.stream],
  );
  const groups = useMemo(() => groupByChar(items) as [string, Work[]][], [items]);
  const open = items.find((item) => item.id === filters.id) || null;

  return (
    <div className="archive">
      <div className="viewport archive-scroll" data-scroll-root>
        <header className="archive-bar">
          <div className="archive-bar__row">
            <a className="archive-bar__brand" href={publicUrl("catalog.html")}>
              <img src={publicUrl("assets/logo.svg")} alt="" width={22} height={28} />
              {copy("catalog.brand")}
            </a>
            <nav className="archive-tabs" aria-label={copy("catalog.brand")}>
              <button
                type="button"
                className={filters.kind === KIND_LETTER ? "is-on" : ""}
                onClick={() => patch({ kind: KIND_LETTER, id: "" })}
              >
                {copy("catalog.letters")}
              </button>
              <button
                type="button"
                className={filters.kind === KIND_WORD ? "is-on" : ""}
                onClick={() => patch({ kind: KIND_WORD, id: "" })}
              >
                {copy("catalog.words")}
              </button>
            </nav>
            <div className="archive-bar__meta">
              <a href={publicUrl()}>{copy("catalog.site")}</a>
              <div className="archive-lang" role="group" aria-label={copy("lang.label")}>
                <button
                  type="button"
                  className={locale === "en" ? "lang-btn is-active" : "lang-btn"}
                  onClick={() => changeLocale("en")}
                  aria-pressed={locale === "en"}
                >
                  en
                </button>
                <span className="lang-sep" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  className={locale === "ru" ? "lang-btn is-active" : "lang-btn"}
                  onClick={() => changeLocale("ru")}
                  aria-pressed={locale === "ru"}
                >
                  ru
                </button>
              </div>
            </div>
          </div>

          <div className="archive-filters">
            <div className="archive-filter">
              <span className="archive-filter__label">{copy("admin.construction")}</span>
              <Chip
                on={!filters.construction}
                onClick={() => patch({ construction: "", id: "" })}
              >
                {copy("catalog.all")}
              </Chip>
              {CONSTRUCTIONS.map((id) => (
                <Chip
                  key={id}
                  on={filters.construction === id}
                  onClick={() =>
                    patch({
                      construction: filters.construction === id ? "" : id,
                      id: "",
                    })
                  }
                >
                  {copy(`tax.construction.${id}`)}
                </Chip>
              ))}
            </div>
            <div className="archive-filter">
              <span className="archive-filter__label">{copy("admin.family")}</span>
              <Chip on={!filters.family} onClick={() => patch({ family: "", id: "" })}>
                {copy("catalog.all")}
              </Chip>
              {FAMILIES.map((id) => (
                <Chip
                  key={id}
                  on={filters.family === id}
                  onClick={() =>
                    patch({ family: filters.family === id ? "" : id, id: "" })
                  }
                >
                  {copy(`tax.family.${id}`)}
                </Chip>
              ))}
            </div>
            {authors.length > 1 ? (
              <div className="archive-filter">
                <span className="archive-filter__label">{copy("admin.author")}</span>
                <Chip on={!filters.author} onClick={() => patch({ author: "", id: "" })}>
                  {copy("catalog.all")}
                </Chip>
                {authors.map((name) => (
                  <Chip
                    key={name}
                    on={filters.author === name}
                    onClick={() =>
                      patch({ author: filters.author === name ? "" : name, id: "" })
                    }
                  >
                    {name}
                  </Chip>
                ))}
              </div>
            ) : null}
            {streams.length > 1 ? (
              <div className="archive-filter">
                <span className="archive-filter__label">{copy("admin.stream")}</span>
                <Chip on={!filters.stream} onClick={() => patch({ stream: "", id: "" })}>
                  {copy("catalog.all")}
                </Chip>
                {streams.map((name) => (
                  <Chip
                    key={name}
                    on={filters.stream === name}
                    onClick={() =>
                      patch({ stream: filters.stream === name ? "" : name, id: "" })
                    }
                  >
                    {name}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
        </header>

        <main className="archive-main">
          {!items.length ? (
            <p className="archive-empty">
              {copy(filters.kind === KIND_WORD ? "catalog.emptyWords" : "catalog.emptyLetters")}
            </p>
          ) : filters.kind === KIND_WORD ? (
            <div className="archive-grid">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="archive-tile archive-tile--word"
                  onClick={() => patch({ id: item.id })}
                >
                  <WorkGlyph item={item} className="archive-tile__glyph" />
                </button>
              ))}
            </div>
          ) : (
            groups.map(([char, list]) => (
              <section key={char} className="archive-group">
                <h2 className="archive-group__title">{char}</h2>
                <div className="archive-grid">
                  {list.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="archive-tile archive-tile--letter"
                      onClick={() => patch({ id: item.id })}
                    >
                      <WorkGlyph item={item} className="archive-tile__glyph" />
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>

      {open ? (
        <div
          className="archive-sheet"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) patch({ id: "" });
          }}
        >
          <div className="archive-sheet__card">
            <div className="archive-sheet__glyph">
              <WorkGlyph item={open} />
            </div>
            <div className="archive-sheet__meta">
              <p className="archive-sheet__label">{entryLabel(open)}</p>
              <p>
                {open.author} · {copy("admin.stream")} {open.stream}
              </p>
              <p className="archive-sheet__tags">
                {open.construction ? <span>{copy(`tax.construction.${open.construction}`)}</span> : null}
                {open.family ? <span>{copy(`tax.family.${open.family}`)}</span> : null}
              </p>
            </div>
            {open.kind === KIND_LETTER ? (
              <p className="archive-sheet__preview">
                <WorkGlyph item={open} className="archive-sheet__preview-glyph" />
                {sampleWord(open.char)}
              </p>
            ) : null}
            <button type="button" className="archive-sheet__close" onClick={() => patch({ id: "" })}>
              {copy("catalog.close")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
