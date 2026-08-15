import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { toast } from "sonner";
import { FileUpIcon, Trash2Icon, TypeIcon, UploadIcon } from "lucide-react";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
import { inferCharFromFilename, normalizeChar } from "@/letters/shared.js";
import { sanitizeSvg, svgToInline } from "@/letters/svg.js";
import {
  CONSTRUCTIONS,
  FAMILIES,
  KIND_LETTER,
  KIND_WORD,
  inferTextFromFilename,
} from "@/letters/taxonomy.js";
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

type Tagged = {
  kind: Kind;
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

function CatalogGlyph({ item }: { item: Work }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/letters/${item.file}`)
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
  }, [item]);

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

function sharedField<K extends keyof Tagged>(items: Tagged[], key: K): Tagged[K] | undefined {
  if (!items.length) return undefined;
  const first = items[0][key];
  return items.every((item) => item[key] === first) ? first : undefined;
}

function nextSelection(current: Set<string>, id: string, ordered: string[], range: boolean) {
  if (range) {
    const from = ordered.indexOf(id);
    const anchors = [...current].map((item) => ordered.indexOf(item)).filter((index) => index >= 0);
    const start = anchors.length ? Math.min(...anchors) : from;
    if (from >= 0 && start >= 0) {
      const next = new Set(current);
      const [a, b] = start < from ? [start, from] : [from, start];
      for (let i = a; i <= b; i++) next.add(ordered[i]);
      return next;
    }
  }
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function FilterChips({
  label,
  value,
  options,
  prefix,
  copy,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  prefix: string;
  copy: (key: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Button
        type="button"
        size="sm"
        variant={value === "" ? "default" : "outline"}
        onClick={() => onChange("")}
      >
        {copy("admin.none")}
      </Button>
      {options.map((id) => (
        <Button
          key={id}
          type="button"
          size="sm"
          variant={value === id ? "default" : "outline"}
          onClick={() => onChange(id)}
        >
          {copy(`${prefix}${id}`)}
        </Button>
      ))}
    </div>
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
  const [selectedInbox, setSelectedInbox] = useState<Set<string>>(() => new Set());
  const [selectedCatalog, setSelectedCatalog] = useState<Set<string>>(() => new Set());
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const copy = (key: string) => t(key, locale);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await lettersApi("");
        if (!alive) return;
        setCatalog(data);
        setWritable(true);
      } catch {
        const data = (await loadCatalog()) as Catalog;
        if (!alive) return;
        setCatalog(data);
        setWritable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    fetch(`/letters/${editing.file}`)
      .then((res) => res.text())
      .then((svg) => {
        if (alive) setEditGlyph(svgToInline(svg, editing.id));
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

  const selectedInboxItems = useMemo(
    () => inbox.filter((item) => selectedInbox.has(item.key)),
    [inbox, selectedInbox],
  );
  const selectedCatalogItems = useMemo(
    () => catalog.letters.filter((item) => selectedCatalog.has(item.id)) as Work[],
    [catalog, selectedCatalog],
  );
  const selectedTagged: Tagged[] = useMemo(
    () => [...selectedInboxItems, ...selectedCatalogItems],
    [selectedInboxItems, selectedCatalogItems],
  );
  const selectedCount = selectedTagged.length;
  const sharedKind = sharedField(selectedTagged, "kind");
  const sharedConstruction = sharedField(selectedTagged, "construction");
  const sharedFamily = sharedField(selectedTagged, "family");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedInbox(new Set());
        setSelectedCatalog(new Set());
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        const target = event.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        event.preventDefault();
        setSelectedInbox(new Set(inbox.map((item) => item.key)));
        setSelectedCatalog(new Set(visualCatalogIds));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inbox, visualCatalogIds]);

  function changeLocale(next: string) {
    if (next !== "en" && next !== "ru") return;
    persistLocale(next);
    setLocaleState(next);
  }

  function pickInbox(event: MouseEvent, key: string) {
    setSelectedInbox((current) =>
      nextSelection(
        current,
        key,
        inbox.map((item) => item.key),
        event.shiftKey,
      ),
    );
  }

  function pickCatalog(event: MouseEvent, id: string) {
    if (event.detail > 1) return;
    setSelectedCatalog((current) => nextSelection(current, id, visualCatalogIds, event.shiftKey));
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
  }

  function toggleGroup(items: Work[]) {
    const ids = items.map((item) => item.id);
    setSelectedCatalog((current) => {
      const allOn = ids.every((id) => current.has(id));
      const next = new Set(current);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function patchInbox(keys: Set<string>, patch: Partial<InboxItem>) {
    setInbox((current) =>
      current.map((item) => {
        if (!keys.has(item.key)) return item;
        const next = { ...item, ...patch };
        if (patch.kind === KIND_WORD && !next.text.trim()) {
          next.text = inferTextFromFilename(item.filename);
        }
        return next;
      }),
    );
  }

  async function patchCatalog(ids: string[], patch: Record<string, string>) {
    if (!ids.length) return;
    if (!writable) {
      toast.error(copy("admin.devOnly"));
      return;
    }
    try {
      const data = await lettersApi("/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids, patch }),
      });
      setCatalog(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy("admin.error"));
    }
  }

  async function applyTag(patch: { kind?: Kind; construction?: string; family?: string }) {
    if (selectedInbox.size) patchInbox(selectedInbox, patch);
    if (selectedCatalog.size) await patchCatalog([...selectedCatalog], patch);
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
    const keys: string[] = [];
    for (const file of files) {
      const raw = await file.text();
      try {
        const preview = svgToInline(sanitizeSvg(raw), `tmp_${crypto.randomUUID()}`);
        const text = inferTextFromFilename(file.name);
        const key = crypto.randomUUID();
        keys.push(key);
        next.push({
          key,
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
    setSelectedInbox(new Set(keys));
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
      setSelectedInbox(new Set());
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
        }),
      });
      setCatalog(data);
      setEditing(null);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy("admin.error"));
    }
  }

  async function deleteEditing() {
    if (!editing) return;
    try {
      const data = await lettersApi(`/${editing.id}`, { method: "DELETE" });
      setCatalog(data);
      setSelectedCatalog((current) => {
        const next = new Set(current);
        next.delete(editing.id);
        return next;
      });
      setConfirmDelete(false);
      setEditing(null);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy("admin.error"));
    }
  }

  const countKey = catalogKind === KIND_WORD ? "admin.countWords" : "admin.count";
  const emptyKey = catalogKind === KIND_WORD ? "admin.emptyWords" : "admin.empty";
  const oneCatalog =
    selectedCatalog.size === 1 && selectedInbox.size === 0
      ? selectedCatalogItems[0]
      : undefined;

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <a href="/" className="flex items-center gap-2.5 text-sm font-medium">
            <img src="/assets/logo.svg" alt="" width={22} height={28} className="h-7 w-auto" />
            {copy("admin.brand")}
          </a>
          <div className="flex items-center gap-2">
            <Badge variant={writable ? "secondary" : "outline"}>
              {writable ? copy("admin.writable") : copy("admin.readOnly")}
            </Badge>
            <Button variant="ghost" size="sm" asChild>
              <a href="/catalog.html">{copy("admin.openCatalog")}</a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/">{copy("admin.site")}</a>
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

      <main className={cn("mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8", selectedCount ? "pb-36" : "")}>
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
                    className={cn(
                      "grid items-center gap-3 rounded-xl border p-2 sm:grid-cols-[72px_minmax(4.5rem,1fr)_1fr_1fr_auto]",
                      selectedInbox.has(item.key) && "ring-2 ring-primary",
                    )}
                  >
                    <button
                      type="button"
                      className="size-[72px] overflow-hidden rounded-lg bg-muted"
                      onClick={(event) => pickInbox(event, item.key)}
                    >
                      <Glyph html={item.preview} className="size-full p-2" />
                    </button>
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
                        setSelectedInbox((current) => {
                          const next = new Set(current);
                          next.delete(item.key);
                          return next;
                        });
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
                onClick={() => {
                  setInbox([]);
                  setSelectedInbox(new Set());
                }}
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
              <p className="max-w-2xl text-sm text-muted-foreground">{copy("admin.selectHint")}</p>
              <KindToggle
                value={catalogKind}
                onChange={(kind) => {
                  setCatalogKind(kind);
                  setSelectedCatalog(new Set());
                }}
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
                    className={cn(
                      "h-[92px] min-w-[148px] overflow-hidden rounded-xl bg-card px-3 ring-1 ring-foreground/10 transition hover:ring-foreground/40",
                      selectedCatalog.has(item.id) && "ring-2 ring-primary",
                    )}
                    onClick={(event) => pickCatalog(event, item.id)}
                    onDoubleClick={() => openEditor(item)}
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
                  <button
                    type="button"
                    className="w-fit font-heading text-4xl leading-none"
                    title={copy("admin.selectAll")}
                    onClick={() => toggleGroup(items)}
                  >
                    {char}
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        title={`${item.author} · ${item.stream}`}
                        className={cn(
                          "size-[92px] overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition hover:ring-foreground/40",
                          selectedCatalog.has(item.id) && "ring-2 ring-primary",
                        )}
                        onClick={(event) => pickCatalog(event, item.id)}
                        onDoubleClick={() => openEditor(item)}
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

      {selectedCount > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {copy("admin.selected").replace("{n}", String(selectedCount))}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedInbox(new Set(inbox.map((item) => item.key)));
                    setSelectedCatalog(new Set(visualCatalogIds));
                  }}
                >
                  {copy("admin.selectAll")}
                </Button>
                {oneCatalog ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => openEditor(oneCatalog)}>
                    {copy("admin.editOne")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedInbox(new Set());
                    setSelectedCatalog(new Set());
                  }}
                >
                  {copy("admin.clearSelection")}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{copy("admin.kind")}</span>
              <Button
                type="button"
                size="sm"
                variant={sharedKind === KIND_LETTER ? "default" : "outline"}
                onClick={() => applyTag({ kind: KIND_LETTER })}
              >
                {copy("admin.kind.letter")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={sharedKind === KIND_WORD ? "default" : "outline"}
                onClick={() => applyTag({ kind: KIND_WORD })}
              >
                {copy("admin.kind.word")}
              </Button>
            </div>
            <FilterChips
              label={copy("admin.construction")}
              value={sharedConstruction}
              options={CONSTRUCTIONS}
              prefix="tax.construction."
              copy={copy}
              onChange={(construction) => applyTag({ construction })}
            />
            <FilterChips
              label={copy("admin.family")}
              value={sharedFamily}
              options={FAMILIES}
              prefix="tax.family."
              copy={copy}
              onChange={(family) => applyTag({ family })}
            />
          </div>
        </div>
      ) : null}

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

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={saveEdit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {editDraft.kind === KIND_WORD ? copy("admin.kind.word") : copy("admin.letter")}
              </DialogTitle>
              <DialogDescription>
                {editDraft.kind === KIND_WORD ? copy("admin.kind.word") : copy("admin.preview")}
              </DialogDescription>
            </DialogHeader>
            <KindToggle
              value={editDraft.kind}
              onChange={(kind) => setEditDraft((current) => ({ ...current, kind }))}
              copy={copy}
            />
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div className="flex min-h-48 items-center justify-center rounded-xl bg-muted p-6">
                {editGlyph ? (
                  <Glyph html={editGlyph} className="h-40 w-full" />
                ) : (
                  <span className="text-5xl">{editDraft.char || editDraft.text}</span>
                )}
              </div>
              <div className="grid gap-3">
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
            <DialogFooter className="sm:justify-between">
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
