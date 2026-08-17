import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileUpIcon,
  Trash2Icon,
  TypeIcon,
  UploadIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  emptyCatalog,
  entriesOfKind,
  groupByChar,
  loadCatalog,
  uniqueValues,
} from "@/letters/catalog.js";
import { sameCatalog, subscribeCatalog } from "@/letters/live.js";
import { inferCharFromFilename, normalizeChar } from "@/letters/shared.js";
import { sanitizeSvg, svgToInline } from "@/letters/svg.js";
import {
  CONSTRUCTIONS,
  FAMILIES,
  KIND_LETTER,
  KIND_WORD,
  inferTextFromFilename,
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
  originalName: string;
  createdAt: string;
  updatedAt?: string;
};

type Catalog = {
  version: number;
  updatedAt: string | null;
  letters: Work[];
};

type InboxItem = {
  key: string;
  filename: string;
  svg: string;
  preview: string;
  kind: Kind;
  char: string;
  text: string;
  author: string;
  stream: string;
  construction: string;
  family: string;
};

const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function sampleWord(char: string) {
  const ru: Record<string, string> = {
    А: "рхив",
    Б: "уквица",
    В: "ектор",
    Е: "tter",
    К: "äik",
    Л: "еттеринг",
    Н: "абор",
    С: "лово",
    Т: "ипографика",
    Ш: "рифт",
    Э: "tter",
  };
  const en: Record<string, string> = {
    A: "rchive",
    B: "ukvitsa",
    E: "tter",
    K: "äik",
    L: "ettering",
    S: "troke",
    T: "ype",
  };
  return ru[char] || en[char] || t("admin.wordRest");
}

async function lettersApi(path: string, options?: RequestInit): Promise<Catalog> {
  const res = await fetch(`/api/letters${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || t("admin.error"));
  }
  return data as Catalog;
}

function Glyph({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden [&_svg]:h-full [&_svg]:max-w-full [&_svg]:w-auto",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function glyphStamp(item: { updatedAt?: string; createdAt?: string }) {
  return item.updatedAt || item.createdAt || "";
}

function CatalogGlyph({ item }: { item: Work }) {
  const [html, setHtml] = useState("");
  const stamp = glyphStamp(item);

  useEffect(() => {
    let alive = true;
    fetch(`${publicUrl(`letters/${item.file}`)}?t=${encodeURIComponent(stamp)}`)
      .then((res) => res.text())
      .then((svg) => {
        if (alive) setHtml(svgToInline(svg, item.id));
      })
      .catch(() => {
        if (alive) setHtml("");
      });
    return () => {
      alive = false;
    };
  }, [item.id, item.file, stamp]);

  if (!html) {
    return <span className="text-2xl font-medium">{item.char || item.text}</span>;
  }
  return <Glyph html={html} className="size-full p-3" />;
}

function KindToggle({
  value,
  onChange,
  copy,
}: {
  value: Kind;
  onChange: (value: Kind) => void;
  copy: (key: string) => string;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(next) => {
        if (next === KIND_LETTER || next === KIND_WORD) onChange(next);
      }}
      aria-label={copy("admin.kind")}
    >
      <ToggleGroupItem value={KIND_LETTER}>{copy("admin.kind.letter")}</ToggleGroupItem>
      <ToggleGroupItem value={KIND_WORD}>{copy("admin.kind.word")}</ToggleGroupItem>
    </ToggleGroup>
  );
}

function TagSelect({
  id,
  value,
  onChange,
  blank,
  options,
  prefix,
  copy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  blank: string;
  options: readonly string[];
  prefix: string;
  copy: (key: string) => string;
}) {
  return (
    <select
      id={id}
      className={selectClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{blank}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {copy(`${prefix}${option}`)}
        </option>
      ))}
    </select>
  );
}

function inboxReady(item: InboxItem) {
  if (!item.author.trim() || !item.stream.trim()) return false;
  if (item.kind === KIND_WORD) return Boolean(item.text.trim());
  return Boolean(item.char);
}

export function AdminApp() {
  const [locale, setLocaleState] = useState(() => getLocale() as "en" | "ru");
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog());
  const [writable, setWritable] = useState(true);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [bulkAuthor, setBulkAuthor] = useState("");
  const [bulkStream, setBulkStream] = useState("");
  const [bulkKind, setBulkKind] = useState<Kind>(KIND_LETTER);
  const [catalogKind, setCatalogKind] = useState<Kind>(KIND_LETTER);
  const [hot, setHot] = useState(false);
  const [editing, setEditing] = useState<Work | null>(null);
  const [editDraft, setEditDraft] = useState({
    kind: KIND_LETTER as Kind,
    char: "",
    text: "",
    author: "",
    stream: "",
    construction: "",
    family: "",
  });
  const [editGlyph, setEditGlyph] = useState("");
  const [editSvg, setEditSvg] = useState<string | null>(null);
  const [editSvgName, setEditSvgName] = useState("");
  const [editHot, setEditHot] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const editSvgRef = useRef<string | null>(null);
  const dragDepth = useRef(0);
  editSvgRef.current = editSvg;

  const copy = (key: string) => t(key, locale);

  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const data = await lettersApi("");
        if (!alive) return;
        setCatalog((current) => (sameCatalog(current, data) ? current : data));
        setWritable(true);
      } catch {
        const data = (await loadCatalog()) as Catalog;
        if (!alive) return;
        setCatalog((current) => (sameCatalog(current, data) ? current : data));
        setWritable(false);
      }
    }
    pull();
    const stop = subscribeCatalog(pull);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    const stamp = glyphStamp(editing);
    fetch(`${publicUrl(`letters/${editing.file}`)}?t=${encodeURIComponent(stamp)}`)
      .then((res) => res.text())
      .then((svg) => {
        if (alive && !editSvgRef.current) setEditGlyph(svgToInline(svg, editing.id));
      })
      .catch(() => {
        if (alive) setEditGlyph("");
      });
    return () => {
      alive = false;
    };
  }, [editing]);

  const authors = useMemo(() => uniqueValues(catalog, "author"), [catalog]);
  const streams = useMemo(() => uniqueValues(catalog, "stream"), [catalog]);
  const letters = useMemo(
    () => entriesOfKind(catalog, KIND_LETTER) as Work[],
    [catalog],
  );
  const words = useMemo(() => entriesOfKind(catalog, KIND_WORD) as Work[], [catalog]);
  const groups = useMemo(() => groupByChar(letters) as [string, Work[]][], [letters]);
  const visibleWorks = catalogKind === KIND_WORD ? words : letters;
  const visibleCount = visibleWorks.length;
  const visualCatalogIds = useMemo(
    () =>
      catalogKind === KIND_WORD
        ? words.map((item) => item.id)
        : groups.flatMap(([, items]) => items.map((item) => item.id)),
    [catalogKind, words, groups],
  );

  function changeLocale(next: string) {
    if (next !== "en" && next !== "ru") return;
    persistLocale(next);
    setLocaleState(next);
  }

  function openEditor(item: Work) {
    setEditing(item);
    setEditDraft({
      kind: item.kind || KIND_LETTER,
      char: item.char,
      text: item.text || "",
      author: item.author,
      stream: item.stream,
      construction: item.construction || "",
      family: item.family || "",
    });
    setEditGlyph("");
    setEditSvg(null);
    setEditSvgName("");
    setEditHot(false);
  }

  function goEdit(delta: number) {
    if (!editing) return;
    const ids = visualCatalogIds;
    if (ids.length < 2) return;
    const index = ids.indexOf(editing.id);
    if (index < 0) return;
    const nextId = ids[(index + delta + ids.length) % ids.length];
    const next = catalog.letters.find((item) => item.id === nextId) as Work | undefined;
    if (next) openEditor(next);
  }

  useEffect(() => {
    if (!editing) return;
    function onKey(event: KeyboardEvent) {
      if (confirmDelete) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goEdit(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goEdit(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, confirmDelete, catalog, visualCatalogIds]);

  async function applyReplaceFile(fileList: FileList | File[]) {
    if (!editing) return;
    const file = [...fileList].find(
      (item) => item.name.toLowerCase().endsWith(".svg") || item.type === "image/svg+xml",
    );
    if (!file) {
      toast.error(copy("admin.needSvg"));
      return;
    }
    const raw = await file.text();
    try {
      setEditGlyph(svgToInline(sanitizeSvg(raw), editing.id));
      setEditSvg(raw);
      setEditSvgName(file.name);
    } catch {
      toast.error(`${file.name}: ${copy("admin.badSvg")}`);
    }
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter(
      (file) => file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml",
    );
    if (!files.length) {
      toast.error(copy("admin.needSvg"));
      return;
    }

    const next: InboxItem[] = [];
    for (const file of files) {
      const raw = await file.text();
      try {
        const preview = svgToInline(sanitizeSvg(raw), `tmp_${crypto.randomUUID()}`);
        const text = inferTextFromFilename(file.name);
        next.push({
          key: crypto.randomUUID(),
          filename: file.name,
          svg: raw,
          preview,
          kind: bulkKind,
          char: inferCharFromFilename(file.name),
          text,
          author: bulkAuthor.trim(),
          stream: bulkStream.trim(),
          construction: "",
          family: "",
        });
      } catch {
        toast.error(`${file.name}: ${copy("admin.badSvg")}`);
      }
    }
    setInbox((current) => [...current, ...next]);
  }

  async function saveInbox() {
    if (!writable) {
      toast.error(copy("admin.devOnly"));
      return;
    }
    if (inbox.some((item) => !inboxReady(item))) {
      toast.error(
        inbox.some((item) => item.kind === KIND_WORD && !item.text.trim())
          ? copy("admin.fillWord")
          : copy("admin.fillAll"),
      );
      return;
    }
    try {
      const data = await lettersApi("", {
        method: "POST",
        body: JSON.stringify({
          items: inbox.map((item) => ({
            kind: item.kind,
            char: item.char,
            text: item.text.trim(),
            author: item.author.trim(),
            stream: item.stream.trim(),
            construction: item.construction,
            family: item.family,
            filename: item.filename,
            svg: item.svg,
          })),
        }),
      });
      setCatalog(data);
      setInbox([]);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy("admin.error"));
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      const data = await lettersApi(`/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          kind: editDraft.kind,
          char: editDraft.char,
          text: editDraft.text,
          author: editDraft.author,
          stream: editDraft.stream,
          construction: editDraft.construction,
          family: editDraft.family,
          ...(editSvg
            ? { svg: editSvg, filename: editSvgName || editing.originalName }
            : {}),
        }),
      });
      const updated = data.letters.find((item) => item.id === editing.id) as Work | undefined;
      setCatalog(data);
      setEditSvg(null);
      setEditSvgName("");
      if (updated) setEditing(updated);
      toast.success(editSvg ? copy("admin.replaced") : copy("admin.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy("admin.error"));
    }
  }

  async function deleteEditing() {
    if (!editing) return;
    const ids = visualCatalogIds;
    const index = ids.indexOf(editing.id);
    const fallbackId = (index >= 0 && ids[index + 1]) || (index > 0 ? ids[index - 1] : null);
    try {
      const data = await lettersApi(`/${editing.id}`, { method: "DELETE" });
      setCatalog(data);
      setConfirmDelete(false);
      const nextItem = fallbackId
        ? (data.letters.find((item) => item.id === fallbackId) as Work | undefined)
        : undefined;
      if (nextItem) openEditor(nextItem);
      else setEditing(null);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy("admin.error"));
    }
  }

  const countKey = catalogKind === KIND_WORD ? "admin.countWords" : "admin.count";
  const emptyKey = catalogKind === KIND_WORD ? "admin.emptyWords" : "admin.empty";
  const editIndex = editing ? visualCatalogIds.indexOf(editing.id) : -1;
  const canCycle = visualCatalogIds.length > 1;

  return (
    <div className="min-h-[var(--frame-h)] bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <a href={publicUrl()} className="flex items-center gap-2.5 text-sm font-medium">
            <img src={publicUrl("assets/logo.svg")} alt="" width={22} height={28} className="h-7 w-auto" />
            {copy("admin.brand")}
          </a>
          <div className="flex items-center gap-2">
            <Badge variant={writable ? "secondary" : "outline"}>
              {writable ? copy("admin.writable") : copy("admin.readOnly")}
            </Badge>
            <Button variant="ghost" size="sm" asChild>
              <a href={publicUrl("catalog.html")}>{copy("admin.openCatalog")}</a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href={publicUrl()}>{copy("admin.site")}</a>
            </Button>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              value={locale}
              onValueChange={changeLocale}
              aria-label={copy("lang.label")}
            >
              <ToggleGroupItem value="en">en</ToggleGroupItem>
              <ToggleGroupItem value="ru">ru</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8">
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <Card
          className={cn(
            "cursor-pointer border-dashed py-12 shadow-none",
            hot && "bg-primary/5 ring-2 ring-primary",
          )}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current += 1;
            setHot(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setHot(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setHot(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
              <UploadIcon className="size-4" />
            </div>
            <CardTitle>{copy("admin.dropTitle")}</CardTitle>
            <CardDescription>{copy("admin.dropHint")}</CardDescription>
            <div
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <KindToggle value={bulkKind} onChange={setBulkKind} copy={copy} />
            </div>
          </CardContent>
        </Card>

        {inbox.length > 0 ? (
          <Card>
            <CardHeader className="border-b">
              <CardTitle>{copy("admin.inbox")}</CardTitle>
              <CardDescription>{inbox.length} SVG</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="bulk-author">{copy("admin.author")}</Label>
                  <Input
                    id="bulk-author"
                    list="author-list"
                    value={bulkAuthor}
                    onChange={(event) => setBulkAuthor(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bulk-stream">{copy("admin.stream")}</Label>
                  <Input
                    id="bulk-stream"
                    list="stream-list"
                    value={bulkStream}
                    onChange={(event) => setBulkStream(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setInbox((current) =>
                      current.map((item) => ({
                        ...item,
                        author: bulkAuthor.trim() || item.author,
                        stream: bulkStream.trim() || item.stream,
                      })),
                    );
                  }}
                >
                  {copy("admin.applyAll")}
                </Button>
              </div>
              <ul className="grid gap-2">
                {inbox.map((item) => (
                  <li
                    key={item.key}
                    className="grid items-center gap-3 rounded-xl border p-2 sm:grid-cols-[72px_minmax(4.5rem,1fr)_1fr_1fr_auto]"
                  >
                    <div className="size-[72px] overflow-hidden rounded-lg bg-muted">
                      <Glyph html={item.preview} className="size-full p-2" />
                    </div>
                    {item.kind === KIND_WORD ? (
                      <Input
                        aria-label={copy("admin.text")}
                        placeholder={copy("admin.text")}
                        aria-invalid={!item.text}
                        value={item.text}
                        onChange={(event) => {
                          const text = event.target.value;
                          setInbox((current) =>
                            current.map((entry) =>
                              entry.key === item.key ? { ...entry, text } : entry,
                            ),
                          );
                        }}
                      />
                    ) : (
                      <Input
                        aria-label={copy("admin.letter")}
                        maxLength={2}
                        className="text-center text-base"
                        aria-invalid={!item.char}
                        value={item.char}
                        onChange={(event) => {
                          const char = normalizeChar(event.target.value);
                          setInbox((current) =>
                            current.map((entry) =>
                              entry.key === item.key ? { ...entry, char } : entry,
                            ),
                          );
                        }}
                      />
                    )}
                    <Input
                      placeholder={copy("admin.author")}
                      list="author-list"
                      value={item.author}
                      onChange={(event) => {
                        const author = event.target.value;
                        setInbox((current) =>
                          current.map((entry) =>
                            entry.key === item.key ? { ...entry, author } : entry,
                          ),
                        );
                      }}
                    />
                    <Input
                      placeholder={copy("admin.stream")}
                      list="stream-list"
                      value={item.stream}
                      onChange={(event) => {
                        const stream = event.target.value;
                        setInbox((current) =>
                          current.map((entry) =>
                            entry.key === item.key ? { ...entry, stream } : entry,
                          ),
                        );
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setInbox((current) => current.filter((entry) => entry.key !== item.key));
                      }}
                    >
                      {copy("admin.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInbox([])}
              >
                {copy("admin.clear")}
              </Button>
              <Button type="button" onClick={saveInbox}>
                <FileUpIcon data-icon="inline-start" />
                {copy("admin.save")}
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="grid gap-2">
              <h2 className="font-heading text-base font-medium">{copy("admin.catalog")}</h2>
              <KindToggle
                value={catalogKind}
                onChange={setCatalogKind}
                copy={copy}
              />
            </div>
            {visibleCount ? (
              <Badge variant="outline">
                {copy(countKey).replace("{n}", String(visibleCount))}
              </Badge>
            ) : null}
          </div>

          {catalogKind === KIND_WORD ? (
            words.length ? (
              <div className="flex flex-wrap gap-2">
                {words.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={`${item.text || item.char} · ${item.author} · ${item.stream}`}
                    className="h-[92px] min-w-[148px] overflow-hidden rounded-xl bg-card px-3 ring-1 ring-foreground/10 transition hover:ring-foreground/40"
                    onClick={() => openEditor(item)}
                  >
                    <CatalogGlyph item={item} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TypeIcon />
                  </EmptyMedia>
                  <EmptyTitle>{copy(emptyKey)}</EmptyTitle>
                  <EmptyDescription>{copy("admin.dropHint")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : groups.length ? (
            <div className="grid gap-8">
              {groups.map(([char, items]) => (
                <section key={char} className="grid gap-3">
                  <h3 className="w-fit font-heading text-4xl leading-none">{char}</h3>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        title={`${item.author} · ${item.stream}`}
                        className="size-[92px] overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition hover:ring-foreground/40"
                        onClick={() => openEditor(item)}
                      >
                        <CatalogGlyph item={item} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TypeIcon />
                </EmptyMedia>
                <EmptyTitle>{copy(emptyKey)}</EmptyTitle>
                <EmptyDescription>{copy("admin.dropHint")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </main>

      <datalist id="author-list">
        {authors.map((value: string) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="stream-list">
        {streams.map((value: string) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditSvg(null);
            setEditSvgName("");
            setEditHot(false);
          }
        }}
      >
        <DialogContent
          className="top-0 left-0 flex h-[var(--frame-h)] w-[var(--frame-w)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto overscroll-contain rounded-none p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">
            {editDraft.char || editDraft.text || copy("admin.letter")}
          </DialogTitle>
          <form onSubmit={saveEdit} className="flex min-h-full flex-col">
            <div className="flex items-center gap-2 border-b px-4 py-3 pr-14">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canCycle}
                aria-label={copy("admin.prev")}
                onClick={() => goEdit(-1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canCycle}
                aria-label={copy("admin.next")}
                onClick={() => goEdit(1)}
              >
                <ChevronRightIcon />
              </Button>
              {editIndex >= 0 ? (
                <span className="text-sm text-muted-foreground">
                  {editIndex + 1} / {visualCatalogIds.length}
                </span>
              ) : null}
            </div>
            <div className="mx-auto grid w-full max-w-5xl flex-1 gap-6 p-6 sm:grid-cols-[minmax(0,1.2fr)_minmax(16rem,20rem)]">
              <div className="grid gap-2">
                <input
                  ref={replaceRef}
                  type="file"
                  accept=".svg,image/svg+xml"
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files) applyReplaceFile(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  title={copy("admin.replaceFile")}
                  className={cn(
                    "flex min-h-[min(28rem,calc(var(--frame-h)*0.55))] w-full cursor-pointer flex-col items-center justify-center rounded-xl bg-muted p-6",
                    editHot && "ring-2 ring-primary",
                  )}
                  onClick={() => replaceRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setEditHot(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setEditHot(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setEditHot(false);
                    applyReplaceFile(event.dataTransfer.files);
                  }}
                >
                  {editGlyph ? (
                    <Glyph html={editGlyph} className="h-full max-h-[min(24rem,calc(var(--frame-h)*0.45))] w-full" />
                  ) : (
                    <span className="text-5xl">{editDraft.char || editDraft.text}</span>
                  )}
                  <span className="mt-4 text-xs text-muted-foreground">
                    {copy("admin.replaceHint")}
                  </span>
                </button>
              </div>
              <div className="grid gap-3 content-start">
                {editDraft.kind === KIND_WORD ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-text">{copy("admin.text")}</Label>
                    <Input
                      id="edit-text"
                      required
                      value={editDraft.text}
                      onChange={(event) =>
                        setEditDraft((current) => ({ ...current, text: event.target.value }))
                      }
                    />
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-char">{copy("admin.letter")}</Label>
                    <Input
                      id="edit-char"
                      maxLength={2}
                      required
                      value={editDraft.char}
                      onChange={(event) =>
                        setEditDraft((current) => ({
                          ...current,
                          char: normalizeChar(event.target.value),
                        }))
                      }
                    />
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-author">{copy("admin.author")}</Label>
                  <Input
                    id="edit-author"
                    required
                    list="author-list"
                    value={editDraft.author}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, author: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-stream">{copy("admin.stream")}</Label>
                  <Input
                    id="edit-stream"
                    required
                    list="stream-list"
                    value={editDraft.stream}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, stream: event.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-construction">{copy("admin.construction")}</Label>
                    <TagSelect
                      id="edit-construction"
                      value={editDraft.construction}
                      onChange={(construction) =>
                        setEditDraft((current) => ({ ...current, construction }))
                      }
                      blank={copy("admin.construction")}
                      options={CONSTRUCTIONS}
                      prefix="tax.construction."
                      copy={copy}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-family">{copy("admin.family")}</Label>
                    <TagSelect
                      id="edit-family"
                      value={editDraft.family}
                      onChange={(family) => setEditDraft((current) => ({ ...current, family }))}
                      blank={copy("admin.family")}
                      options={FAMILIES}
                      prefix="tax.family."
                      copy={copy}
                    />
                  </div>
                </div>
                {editDraft.kind === KIND_LETTER ? (
                  <p className="flex items-end text-4xl leading-none">
                    {editGlyph ? (
                      <span
                        className="mr-0.5 inline-flex h-[1em] items-end [&_svg]:h-full [&_svg]:w-auto"
                        dangerouslySetInnerHTML={{ __html: editGlyph }}
                      />
                    ) : (
                      editDraft.char
                    )}
                    {sampleWord(editDraft.char)}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter className="mx-0 mb-0 mt-auto rounded-none sm:justify-between">
              <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon data-icon="inline-start" />
                {copy("admin.delete")}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {copy("admin.close")}
                </Button>
                <Button type="submit">{copy("admin.save")}</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy("admin.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{copy("admin.confirmDelete")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy("admin.close")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteEditing}>
              {copy("admin.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
