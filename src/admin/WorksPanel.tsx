import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, FileUpIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { emptyWorksCatalog, loadWorksCatalog, uniqueWorkValues, workFileUrl } from "@/works/catalog.js";
import { sameWorksCatalog, subscribeWorksCatalog } from "@/works/live.js";
import {
  TYPE_DAILY,
  TYPE_FINAL,
  TYPE_FONT,
  TYPE_LETTERING,
  WORK_TYPES,
  normalizeGridSpan,
  normalizeName,
  normalizeNick,
  normalizeWorkType,
  sortWorksByDate,
} from "@/works/taxonomy.js";
import { FontPreview } from "./FontPreview";
import { pdfToWebpSlides } from "./pdf-slides";

type WorkType = (typeof WORK_TYPES)[number];

type WorkItem = {
  id: string;
  type: string;
  author: string;
  nick: string;
  stream: string;
  sample?: string;
  /** Daily practice only: which letter this is. */
  glyph?: string;
  caps?: boolean;
  latin?: boolean;
  files: string[];
  width?: number;
  height?: number;
  originalName?: string;
  createdAt: string;
  updatedAt?: string;
  gridSpan?: "auto" | 1 | 3;
};

type WorksCatalog = {
  version: number;
  updatedAt: string | null;
  items: WorkItem[];
  writable?: boolean;
  fileBase?: string;
};

type UploadFile = {
  filename: string;
  mime: string;
  data?: string;
  blob?: Blob;
  preview: string;
  width?: number;
  height?: number;
};

type InboxItem = {
  key: string;
  type: WorkType;
  author: string;
  nick: string;
  stream: string;
  glyph?: string;
  files: UploadFile[];
};

type GridSpan = "auto" | 1 | 3;

// One slide of a final project in the editor: either an existing catalog file
// or a freshly picked upload that will replace / extend the set on save.
type Slide = { key: string; file?: string; upload?: UploadFile };

type Lasso = { x0: number; y0: number; x1: number; y1: number };

const DRAG_PX = 6;

function kindOf(file: File): "font" | "raster" | "svg" | "pdf" | "other" {
  const name = file.name.toLowerCase();
  if (/\.(ttf|otf|woff2?)$/.test(name) || file.type.includes("font")) return "font";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".svg") || file.type.includes("svg")) return "svg";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "raster";
  return "other";
}

function isFontPath(name: string) {
  return /\.(ttf|otf|woff2?)$/i.test(name);
}

let pasteCounter = 0;

function looksLikeSvg(text: string) {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  return (head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg")) && /<svg[\s>]/i.test(text);
}

// Figma "Copy as SVG" puts markup in text/plain; name the file after the
// root <svg id> or <title> when there is one so the inbox reads naturally.
function svgFileName(markup: string, ordinal: number) {
  const root = markup.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const id = root.match(/\sid=["']([^"']+)["']/i)?.[1];
  const title = markup.match(/<title[^>]*>([^<]{1,80})<\/title>/i)?.[1];
  const raw = (id || title || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return `${raw || `pasted-${ordinal}`}.svg`;
}

// Turn a paste into File objects the same way a drop would deliver them.
// Files win (PNG copied from Figma, SVG/PDF from Finder); otherwise inline
// SVG markup in text becomes a synthetic .svg file. Anything else → nothing.
function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<File>();
  const push = (file: File | null) => {
    if (file && !seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  };
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") push(item.getAsFile());
  }
  for (const file of Array.from(data.files ?? [])) push(file);
  if (files.length) {
    return files.map((file) => {
      // Clipboard bitmaps arrive as "image.png" — give each its own name so
      // several pastes do not collide in the inbox or on disk.
      if (!/^image\.\w+$/i.test(file.name) && file.name) return file;
      pasteCounter += 1;
      const ext = file.type.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "png";
      return new File([file], `pasted-${pasteCounter}.${ext}`, { type: file.type, lastModified: Date.now() });
    });
  }
  const text = data.getData("text/plain") || "";
  const markup = looksLikeSvg(text) ? text : "";
  if (!markup) {
    const html = data.getData("text/html") || "";
    const start = html.search(/<svg[\s>]/i);
    const end = html.toLowerCase().lastIndexOf("</svg>");
    if (start >= 0 && end > start) {
      const inline = html.slice(start, end + "</svg>".length);
      pasteCounter += 1;
      return [new File([inline], svgFileName(inline, pasteCounter), { type: "image/svg+xml" })];
    }
    return [];
  }
  pasteCounter += 1;
  return [new File([markup.trim()], svgFileName(markup, pasteCounter), { type: "image/svg+xml" })];
}

const RASTER_LONG_SIDE = 1600;
const RASTER_WEBP_QUALITY = 0.82;
const UPLOAD_CONCURRENCY = 3;
/** Works per catalog commit; keeps one POST well inside the 60 s function budget. */
const BATCH_ITEMS = 12;
/** Inline SVG payload per POST (Vercel body limit is 4.5 MB). */
const BATCH_BYTES = 2_500_000;

function revokeUpload(file: UploadFile) {
  if (file.preview?.startsWith("blob:")) URL.revokeObjectURL(file.preview);
}

function revokeUploads(files: UploadFile[]) {
  for (const file of files) revokeUpload(file);
}

function yieldUi() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return out;
}

function encodeCanvas(canvas: HTMLCanvasElement): Promise<{ blob: Blob; mime: string }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        if (webp) {
          resolve({ blob: webp, mime: "image/webp" });
          return;
        }
        canvas.toBlob(
          (jpg) => {
            if (jpg) resolve({ blob: jpg, mime: "image/jpeg" });
            else reject(new Error("encode"));
          },
          "image/jpeg",
          0.85,
        );
      },
      "image/webp",
      RASTER_WEBP_QUALITY,
    );
  });
}

async function rasterToWebp(file: File): Promise<UploadFile> {
  const probe = await createImageBitmap(file);
  const scale = Math.min(1, RASTER_LONG_SIDE / Math.max(probe.width, probe.height, 1));
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  probe.close();
  let bitmap: ImageBitmap;
  try {
    bitmap =
      scale < 1
        ? await createImageBitmap(file, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: "medium",
          })
        : await createImageBitmap(file);
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encoded = await encodeCanvas(canvas);
  const ext = encoded.mime === "image/jpeg" ? ".jpg" : ".webp";
  return {
    filename: file.name.replace(/\.[^.]+$/, "") + ext,
    mime: encoded.mime,
    blob: encoded.blob,
    preview: URL.createObjectURL(encoded.blob),
    width,
    height,
  };
}

function dataUrlToBytes(data: string): Uint8Array {
  if (data.trim().startsWith("<")) return new TextEncoder().encode(data);
  const raw = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// Network activity counter shared by every works request; drives the
// bottom-right loading toast so any pending call (not only bulk saves) is visible.
const INFLIGHT_TOAST_ID = "kaik-inflight";
const INFLIGHT_TOAST_GRACE_MS = 200;
let inflightCount = 0;
const inflightListeners = new Set<(n: number) => void>();

function trackInflight<T>(promise: Promise<T>): Promise<T> {
  inflightCount += 1;
  for (const fn of inflightListeners) fn(inflightCount);
  return promise.finally(() => {
    inflightCount -= 1;
    for (const fn of inflightListeners) fn(inflightCount);
  });
}

function useInflight() {
  const [n, setN] = useState(inflightCount);
  useEffect(() => {
    inflightListeners.add(setN);
    return () => {
      inflightListeners.delete(setN);
    };
  }, []);
  return n;
}

function apiFail(status: number, message?: string) {
  if (status === 413) return "TOO_LARGE";
  return message || `Request failed (${status})`;
}

function toastApiError(error: unknown, copy: (key: string) => string) {
  const message = error instanceof Error ? error.message : "";
  toast.error(message === "TOO_LARGE" ? copy("admin.tooLarge") : message || copy("admin.error"));
}

type PackedFile = {
  filename?: string;
  mime?: string;
  data?: string;
  sha?: string;
  keep?: string;
};

function packSlide(slide: Slide): Promise<PackedFile> {
  if (slide.upload) return packFile(slide.upload);
  return Promise.resolve({ keep: slide.file || "" });
}

function toSlide(upload: UploadFile): Slide {
  return { key: `up-${Date.now()}-${Math.random()}`, upload };
}

function slidesFrom(item: WorkItem | null): Slide[] {
  return (item?.files || []).map((file) => ({ key: file, file }));
}

function revokeSlides(slides: Slide[]) {
  for (const slide of slides) if (slide.upload) revokeUpload(slide.upload);
}

async function packFile(file: UploadFile): Promise<PackedFile> {
  const svg =
    file.mime.includes("svg") ||
    Boolean(file.data && !file.data.startsWith("data:") && file.data.trim().startsWith("<"));
  if (svg && file.data) {
    return { filename: file.filename, mime: file.mime, data: file.data };
  }
  const body =
    file.blob ||
    (file.data ? new Blob([dataUrlToBytes(file.data)], { type: file.mime || "application/octet-stream" }) : null);
  if (!body) throw new Error("Empty file");
  const res = await trackInflight(
    fetch("/api/works/upload", {
      method: "POST",
      headers: {
        "Content-Type": file.mime || body.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.filename),
      },
      body,
    }),
  );
  const text = await res.text();
  let data: { error?: string; sha?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(apiFail(res.status, data.error));
  if (!data.sha) throw new Error(apiFail(res.status, "Upload failed"));
  return { filename: file.filename, mime: file.mime, sha: data.sha };
}

async function fileToUpload(file: File, asFinal = false): Promise<UploadFile> {
  const svg = file.type.includes("svg") || file.name.toLowerCase().endsWith(".svg");
  if (svg) {
    const data = await file.text();
    return { filename: file.name, mime: "image/svg+xml", data, preview: URL.createObjectURL(file) };
  }
  const raster = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (asFinal && raster) return rasterToWebp(file);
  return {
    filename: file.name,
    mime: file.type || "application/octet-stream",
    blob: file,
    preview: URL.createObjectURL(file),
  };
}

async function worksApi(path: string, options?: RequestInit): Promise<WorksCatalog> {
  const res = await trackInflight(
    fetch(`/api/works${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    }),
  );
  const text = await res.text();
  let data: { error?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(apiFail(res.status, data.error));
  return data as WorksCatalog;
}

function typeKey(type: string) {
  if (type === TYPE_FINAL) return "admin.type.final";
  if (type === TYPE_FONT) return "admin.type.font";
  if (type === TYPE_DAILY) return "admin.type.daily";
  return "admin.type.lettering";
}

function acceptFor(type: WorkType) {
  if (type === TYPE_FINAL) return "image/*,.svg,.png,.jpg,.jpeg,.webp,.pdf,application/pdf";
  if (type === TYPE_FONT) return ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
  if (type === TYPE_DAILY) return ".svg,image/svg+xml,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
  return ".svg,image/svg+xml";
}

/** Rasters get squeezed to webp for slide decks and daily letters; workshop SVGs stay as-is. */
function compressRasters(type: WorkType) {
  return type === TYPE_FINAL || type === TYPE_DAILY;
}

async function filesForType(files: File[], type: WorkType): Promise<UploadFile[]> {
  const list =
    type === TYPE_FINAL
      ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
      : [...files];
  const out: UploadFile[] = [];
  for (const file of list) {
    if (type === TYPE_FINAL && kindOf(file) === "pdf") {
      out.push(...(await pdfToWebpSlides(file)));
      continue;
    }
    out.push(await fileToUpload(file, compressRasters(type)));
  }
  return out;
}

function TypeTabs({
  value,
  onChange,
  copy,
}: {
  value: WorkType;
  onChange: (value: WorkType) => void;
  copy: (key: string) => string;
}) {
  return (
    <div role="tablist" aria-label={copy("admin.kind")} className="inline-flex">
      {WORK_TYPES.map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "-ml-px border border-foreground px-2.5 py-1 text-sm first:ml-0 first:rounded-l-md last:rounded-r-md",
              active ? "bg-foreground text-background" : "bg-background text-foreground",
            )}
            onClick={() => onChange(type)}
          >
            {copy(typeKey(type))}
          </button>
        );
      })}
    </div>
  );
}

function TypeSelect({
  value,
  onChange,
  copy,
}: {
  value: WorkType;
  onChange: (value: WorkType) => void;
  copy: (key: string) => string;
}) {
  return (
    <select
      value={value}
      aria-label={copy("admin.kind")}
      onChange={(event) => {
        const next = event.target.value as WorkType;
        if (WORK_TYPES.includes(next)) onChange(next);
      }}
    >
      {WORK_TYPES.map((type) => (
        <option key={type} value={type}>
          {copy(typeKey(type))}
        </option>
      ))}
    </select>
  );
}

function GridSpanSelect({
  value,
  onChange,
  copy,
  ariaLabel,
  placeholder,
}: {
  value: GridSpan | "";
  onChange: (value: GridSpan) => void;
  copy: (key: string) => string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel || copy("admin.gridSpan")}
      onChange={(event) => {
        if (event.target.value) onChange(normalizeGridSpan(event.target.value) as GridSpan);
      }}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      <option value="auto">{copy("admin.gridSpan.auto")}</option>
      <option value="1">{copy("admin.gridSpan.one")}</option>
      <option value="3">{copy("admin.gridSpan.three")}</option>
    </select>
  );
}

// Author and nick are typed into one field: "Андрей @iamprpl". The first "@"
// splits it — text before is the name, text after is the handle. No "@" →
// name only; leading "@" → handle only.
function splitAuthorNick(value: string): { author: string; nick: string } {
  const at = value.indexOf("@");
  if (at < 0) return { author: normalizeName(value), nick: "" };
  return {
    author: normalizeName(value.slice(0, at)),
    nick: normalizeNick(value.slice(at + 1).replace(/[@\s]+/g, "")),
  };
}

function joinAuthorNick(author: string, nick: string) {
  return nick ? `${author} @${nick}`.trim() : author;
}

// One controlled input over two state fields. The raw text is kept locally
// so a trailing "@" (nick not typed yet) survives the round trip; when the
// fields change from outside (e.g. "apply to all") the text is re-derived.
function AuthorNickInput({
  author,
  nick,
  onChange,
  ...rest
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "list"> & {
  author: string;
  nick: string;
  onChange: (next: { author: string; nick: string }) => void;
}) {
  const [text, setText] = useState(() => joinAuthorNick(author, nick));
  const parsed = splitAuthorNick(text);
  const value = parsed.author === author && parsed.nick === nick ? text : joinAuthorNick(author, nick);
  return (
    <Input
      {...rest}
      list="works-author-nick-list"
      value={value}
      onChange={(event) => {
        setText(event.target.value);
        onChange(splitAuthorNick(event.target.value));
      }}
    />
  );
}

function fileSrc(item: WorkItem, file: string) {
  return `${workFileUrl(file)}?t=${encodeURIComponent(item.updatedAt || item.createdAt || "")}`;
}

function thumbSrc(item: WorkItem) {
  const file = item.files?.[0];
  if (!file || isFontPath(file)) return "";
  return fileSrc(item, file);
}

function fontUrl(item: WorkItem) {
  const file = item.files?.find((name) => isFontPath(name)) || item.files?.[0];
  return file ? workFileUrl(file) : "";
}

function lassoBox(lasso: Lasso) {
  const left = Math.min(lasso.x0, lasso.x1);
  const top = Math.min(lasso.y0, lasso.y1);
  return { left, top, width: Math.abs(lasso.x1 - lasso.x0), height: Math.abs(lasso.y1 - lasso.y0) };
}

function intersects(el: Element, box: { left: number; top: number; width: number; height: number }) {
  const r = el.getBoundingClientRect();
  return r.left < box.left + box.width && r.right > box.left && r.top < box.top + box.height && r.bottom > box.top;
}

// Radix focuses "cancel" first, so a bare Enter would dismiss; make Enter
// confirm instead (Esc still cancels).
function confirmOnEnter(action: () => void) {
  return (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
}

function itemDims(files: UploadFile[]) {
  const sized = files.find((file) => file.width && file.height);
  return sized ? { width: sized.width, height: sized.height } : {};
}

export function WorksPanel({
  copy,
  writable,
}: {
  copy: (key: string) => string;
  writable: boolean;
}) {
  const [canWrite, setCanWrite] = useState(writable);
  const [catalog, setCatalog] = useState<WorksCatalog>(emptyWorksCatalog());
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [bulkAuthor, setBulkAuthor] = useState("");
  const [bulkNick, setBulkNick] = useState("");
  const [bulkStream, setBulkStream] = useState("");
  const [catalogType, setCatalogType] = useState<WorkType>(TYPE_LETTERING);
  const [hot, setHot] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [editDraft, setEditDraft] = useState({
    type: TYPE_LETTERING as WorkType,
    author: "",
    nick: "",
    stream: "",
    sample: "",
    glyph: "",
    caps: false,
    latin: false,
    gridSpan: "auto" as GridSpan,
  });
  const [editFiles, setEditFiles] = useState<UploadFile[] | null>(null);
  const [editSlides, setEditSlides] = useState<Slide[]>([]);
  const [editDrop, setEditDrop] = useState(false);
  const [editDropSlide, setEditDropSlide] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const inflight = useInflight();
  const [selected, setSelected] = useState<string[]>([]);
  const [lasso, setLasso] = useState<Lasso | null>(null);
  const [progress, setProgress] = useState<{ kind: "import" | "save"; n: number; total: number } | null>(null);
  // Network activity / import progress lives in the same toast stack as
  // errors and "saved", so every status message shares one look and position.
  // One toast id → the text updates in place; a short grace before dismiss
  // keeps back-to-back requests from flickering the toast in and out.
  useEffect(() => {
    const busy = progress !== null || inflight > 0;
    if (!busy) {
      const timer = window.setTimeout(() => toast.dismiss(INFLIGHT_TOAST_ID), INFLIGHT_TOAST_GRACE_MS);
      return () => window.clearTimeout(timer);
    }
    const text = progress
      ? copy(progress.kind === "import" ? "admin.preparing" : "admin.sending")
          .replace("{n}", String(progress.n))
          .replace("{total}", String(progress.total))
      : copy("admin.loading");
    toast.loading(text, { id: INFLIGHT_TOAST_ID, duration: Infinity, dismissible: false });
    return undefined;
  }, [progress, inflight, copy]);
  useEffect(() => () => toast.dismiss(INFLIGHT_TOAST_ID), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const slideInputRef = useRef<HTMLInputElement>(null);
  // Index of the slide being replaced; null = append picked files to the end.
  const slideTarget = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const lassoOrigin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragged = useRef(false);
  const captured = useRef(false);
  const addFilesRef = useRef<(list: FileList | File[]) => Promise<void>>(async () => undefined);
  const applyEditUploadsRef = useRef<
    (list: FileList | File[], target?: number | "all" | "append") => Promise<void>
  >(async () => undefined);
  const editTypeRef = useRef(editDraft.type);
  editTypeRef.current = editDraft.type;
  const lassoRef = useRef<Lasso | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const data = await worksApi("");
        if (!alive) return;
        setCanWrite(Boolean(data.writable));
        setCatalog((current) => (sameWorksCatalog(current, data) ? current : data));
      } catch {
        const data = (await loadWorksCatalog({ bust: true })) as WorksCatalog;
        if (!alive) return;
        setCanWrite(false);
        setCatalog((current) => (sameWorksCatalog(current, data) ? current : data));
      }
    }
    pull();
    return subscribeWorksCatalog(pull);
  }, []);

  const items = useMemo(() => sortWorksByDate(catalog.items) as WorkItem[], [catalog]);
  const visible = useMemo(
    () => items.filter((item) => normalizeWorkType(item.type) === catalogType),
    [items, catalogType],
  );
  const authorNicks = useMemo(
    () => [...new Set(items.map((item) => joinAuthorNick(item.author || "", item.nick || "")).filter(Boolean))],
    [items],
  );
  const streams = useMemo(() => uniqueWorkValues(items, "stream"), [items]);
  const visualIds = useMemo(() => visible.map((item) => item.id), [visible]);
  const editIndex = editing ? visualIds.indexOf(editing.id) : -1;
  const canCycle = visualIds.length > 1;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const confirmRef = useRef(false);
  confirmRef.current = confirmDelete || confirmBulk;

  useEffect(() => {
    setSelected([]);
  }, [catalogType]);

  useEffect(() => {
    if (!editing) return;
    const typing = "input, textarea, select, [contenteditable='true']";
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest(typing)) return;
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
  });

  async function addFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    // On the daily-practice tab every picture is its own letter, so rasters
    // become singles instead of being stacked into one slide deck.
    const dailyMode = catalogType === TYPE_DAILY;
    const fonts = files.filter((file) => kindOf(file) === "font");
    const rasters = dailyMode ? [] : files.filter((file) => kindOf(file) === "raster");
    const pdfs = files.filter((file) => kindOf(file) === "pdf");
    const singles = files.filter((file) => {
      const kind = kindOf(file);
      return kind === "svg" || kind === "other" || (dailyMode && kind === "raster");
    });
    const singleType: WorkType = dailyMode ? TYPE_DAILY : TYPE_LETTERING;
    const total = fonts.length + rasters.length + pdfs.length + singles.length;
    let done = 0;
    setProgress({ kind: "import", n: 0, total });
    const tick = async () => {
      done += 1;
      setProgress({ kind: "import", n: done, total });
      await yieldUi();
    };
    try {
      const next: InboxItem[] = [];
      if (fonts.length) {
        const uploaded: UploadFile[] = [];
        for (const file of fonts) {
          uploaded.push(await fileToUpload(file));
          await tick();
        }
        next.push({
          key: `font-${Date.now()}-${Math.random()}`,
          type: TYPE_FONT,
          author: bulkAuthor,
          nick: normalizeNick(bulkNick),
          stream: bulkStream,
          files: uploaded,
        });
      }
      rasters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      if (rasters.length) {
        const uploaded: UploadFile[] = [];
        for (const file of rasters) {
          uploaded.push(await fileToUpload(file, true));
          await tick();
        }
        next.push({
          key: `final-${Date.now()}-${Math.random()}`,
          type: TYPE_FINAL,
          author: bulkAuthor,
          nick: normalizeNick(bulkNick),
          stream: bulkStream,
          files: uploaded,
        });
      }
      for (const file of pdfs) {
        try {
          next.push({
            key: `pdf-${file.name}-${Math.random()}`,
            type: TYPE_FINAL,
            author: bulkAuthor,
            nick: normalizeNick(bulkNick),
            stream: bulkStream,
            files: await pdfToWebpSlides(file),
          });
        } catch {
          toast.error(copy("admin.badPdf"));
        }
        await tick();
      }
      for (const file of singles) {
        next.push({
          key: `${file.name}-${Math.random()}`,
          type: singleType,
          author: dailyMode ? "" : bulkAuthor,
          nick: dailyMode ? "" : normalizeNick(bulkNick),
          stream: bulkStream,
          files: [await fileToUpload(file, dailyMode)],
        });
        await tick();
      }
      setInbox((current) => [...current, ...next]);
    } catch {
      toast.error(copy("admin.error"));
    } finally {
      busyRef.current = false;
      setProgress(null);
    }
  }

  addFilesRef.current = addFiles;

  useEffect(() => {
    function isFileDrag(event: DragEvent) {
      return Boolean(event.dataTransfer?.types?.includes("Files"));
    }
    function onEnter(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (editingRef.current) return;
      dragDepth.current += 1;
      setHot(true);
    }
    function onOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    function onLeave(event: DragEvent) {
      if (!isFileDrag(event)) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setHot(false);
      }
    }
    function onDrop(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setHot(false);
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      // Open editor: a drop on the left pane replaces that work's file.
      // Anywhere else in the dialog is ignored so it does not land in the inbox.
      if (editingRef.current) {
        const node = event.target instanceof Element ? event.target : null;
        const slide = node?.closest("[data-edit-slide]");
        const surface = node?.closest("[data-edit-surface]");
        if (slide) {
          applyEditUploadsRef.current(files, Number(slide.getAttribute("data-edit-slide")));
        } else if (surface) {
          applyEditUploadsRef.current(files, "all");
        }
        return;
      }
      addFilesRef.current(files);
    }
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  // ⌘V anywhere on the page feeds the inbox like a drop: a PNG copied in
  // Figma, SVG markup from "Copy as SVG", or files copied in Finder. Typing
  // into fields and open dialogs keep the native paste.
  useEffect(() => {
    const typing = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
    function onPaste(event: ClipboardEvent) {
      if (event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(typing)) return;
      if (confirmRef.current) return;
      const files = filesFromClipboard(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      if (editingRef.current) {
        applyEditUploadsRef.current(files, "all");
        return;
      }
      addFilesRef.current(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Author, nick and stream are optional — only the files are required.
  function inboxReady(item: InboxItem) {
    return item.files.length > 0;
  }

  async function saveInbox() {
    if (!canWrite) {
      toast.error(copy("admin.devOnly"));
      return;
    }
    if (inbox.some((item) => !inboxReady(item))) {
      toast.error(copy("admin.fillWorks"));
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    let leftover = [...inbox];
    const totalFiles = leftover.reduce((sum, item) => sum + item.files.length, 0);
    let saved = 0;
    let uploading = 0;
    const report = () => {
      setProgress({ kind: "save", n: Math.min(totalFiles, saved + uploading), total: totalFiles });
    };
    report();
    try {
      // Works are committed in batches: one GitHub commit per batch instead of
      // one per work, which is what made 150 SVGs at once fall over.
      let batch: { item: InboxItem; files: PackedFile[] }[] = [];
      let batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const data = await worksApi("", {
          method: "POST",
          body: JSON.stringify({
            items: batch.map(({ item, files }) => ({
              type: item.type,
              author: item.author,
              nick: item.nick,
              stream: item.stream,
              glyph: item.glyph || "",
              ...itemDims(item.files),
              files,
            })),
          }),
        });
        const done = new Set(batch.map(({ item }) => item.key));
        for (const { item } of batch) {
          revokeUploads(item.files);
          saved += item.files.length;
        }
        uploading = 0;
        batch = [];
        batchBytes = 0;
        leftover = leftover.filter((item) => !done.has(item.key));
        setInbox([...leftover]);
        setCatalog(data);
        report();
      };
      for (const item of [...leftover]) {
        const files = await mapPool(item.files, UPLOAD_CONCURRENCY, async (file) => {
          const packed = await packFile(file);
          if (packed.sha) {
            uploading += 1;
            report();
          }
          return packed;
        });
        const bytes = JSON.stringify(files).length;
        if (batch.length && (batch.length >= BATCH_ITEMS || batchBytes + bytes > BATCH_BYTES)) {
          await flush();
        }
        batch.push({ item, files });
        batchBytes += bytes;
      }
      await flush();
      setInbox([]);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toastApiError(error, copy);
    } finally {
      busyRef.current = false;
      setProgress(null);
    }
  }

  function discardEditUploads() {
    if (editFiles) revokeUploads(editFiles);
    revokeSlides(editSlides);
  }

  function openEditor(item: WorkItem) {
    discardEditUploads();
    setEditing(item);
    setEditDraft({
      type: normalizeWorkType(item.type),
      author: item.author,
      nick: item.nick,
      stream: item.stream,
      sample: item.sample || "",
      glyph: item.glyph || "",
      caps: Boolean(item.caps),
      latin: Boolean(item.latin),
      gridSpan: normalizeGridSpan(item.gridSpan) as GridSpan,
    });
    setEditFiles(null);
    setEditSlides(slidesFrom(item));
  }

  function closeEditor() {
    discardEditUploads();
    setEditing(null);
    setEditFiles(null);
    setEditSlides([]);
    setEditDrop(false);
    setEditDropSlide(null);
  }

  function pickSlides(target: number | null) {
    slideTarget.current = target;
    slideInputRef.current?.click();
  }

  function removeSlide(index: number) {
    setEditSlides((current) => {
      if (current.length < 2) return current;
      const next = [...current];
      const [gone] = next.splice(index, 1);
      if (gone?.upload) revokeUpload(gone.upload);
      return next;
    });
  }

  async function applyEditUploads(list: FileList | File[], target: number | "all" | "append" = "all") {
    const type = editTypeRef.current;
    const incoming = [...list];
    if (!incoming.length) return;
    let files: UploadFile[];
    try {
      files = await filesForType(incoming, type);
    } catch {
      toast.error(type === TYPE_FINAL ? copy("admin.badPdf") : copy("admin.badSvg"));
      return;
    }
    if (!files.length) return;
    if (type === TYPE_FINAL) {
      setEditSlides((current) => {
        const fresh = files.map(toSlide);
        if (target === "append") return [...current, ...fresh];
        if (typeof target === "number" && target >= 0 && target < current.length) {
          const next = [...current];
          const [old] = next.splice(target, 1, ...fresh);
          if (old?.upload) revokeUpload(old.upload);
          return next;
        }
        revokeSlides(current);
        return fresh;
      });
      return;
    }
    setEditFiles((current) => {
      if (current) revokeUploads(current);
      return files;
    });
  }

  applyEditUploadsRef.current = applyEditUploads;

  async function onSlidesPicked(list: FileList) {
    const target = slideTarget.current;
    slideTarget.current = null;
    await applyEditUploads(list, target === null ? "append" : target);
  }

  function isFileDragOver(event: ReactDragEvent) {
    return Boolean(event.dataTransfer?.types?.includes("Files"));
  }

  function onEditSurfaceDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!isFileDragOver(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    const slide = event.target instanceof Element ? event.target.closest("[data-edit-slide]") : null;
    setEditDrop(true);
    setEditDropSlide(slide ? Number(slide.getAttribute("data-edit-slide")) : null);
  }

  function onEditSurfaceDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setEditDrop(false);
    setEditDropSlide(null);
  }

  function onEditSurfaceDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!isFileDragOver(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setEditDrop(false);
    setEditDropSlide(null);
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    const slide = event.target instanceof Element ? event.target.closest("[data-edit-slide]") : null;
    applyEditUploads(files, slide ? Number(slide.getAttribute("data-edit-slide")) : "all");
  }

  function goEdit(dir: number) {
    if (!editing || visualIds.length < 2) return;
    const index = visualIds.indexOf(editing.id);
    const nextId = visualIds[(index + dir + visualIds.length) % visualIds.length];
    const next = visible.find((item) => item.id === nextId);
    if (next) openEditor(next);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (!canWrite) {
      toast.error(copy("admin.devOnly"));
      return;
    }
    const finalMode = editDraft.type === TYPE_FINAL;
    if (finalMode && slidesDirty && !editSlides.length) {
      toast.error(copy("admin.minSlide"));
      return;
    }
    try {
      let filesPatch: Record<string, unknown> = {};
      if (finalMode && slidesDirty) {
        const first = editSlides[0]?.upload;
        filesPatch = {
          ...(first ? itemDims([first]) : {}),
          files: await mapPool(editSlides, UPLOAD_CONCURRENCY, (slide) => packSlide(slide)),
        };
      } else if (!finalMode && editFiles) {
        filesPatch = {
          ...itemDims(editFiles),
          files: await mapPool(editFiles, UPLOAD_CONCURRENCY, (file) => packFile(file)),
        };
      }
      const data = await worksApi(`/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: editDraft.type,
          author: editDraft.author,
          nick: editDraft.nick,
          stream: editDraft.stream,
          sample: editDraft.sample,
          glyph: editDraft.glyph,
          caps: editDraft.caps,
          latin: editDraft.latin,
          gridSpan: editDraft.gridSpan,
          ...filesPatch,
        }),
      });
      setCatalog(data);
      const updated = data.items.find((item) => item.id === editing.id) || null;
      discardEditUploads();
      setEditing(updated);
      setEditFiles(null);
      setEditSlides(slidesFrom(updated));
      toast.success(copy("admin.saved"));
    } catch (error) {
      toastApiError(error, copy);
    }
  }

  async function deleteEditing() {
    if (!editing) return;
    const ids = visualIds;
    const index = ids.indexOf(editing.id);
    const fallbackId = (index >= 0 && ids[index + 1]) || (index > 0 ? ids[index - 1] : null);
    try {
      const data = await worksApi(`/${editing.id}`, { method: "DELETE" });
      setCatalog(data);
      setConfirmDelete(false);
      const next = fallbackId ? data.items.find((item) => item.id === fallbackId) : undefined;
      if (next) openEditor(next);
      else closeEditor();
      toast.success(copy("admin.saved"));
    } catch (error) {
      toastApiError(error, copy);
    }
  }

  async function applyBulkType(type: WorkType) {
    if (!selected.length || !canWrite) return;
    try {
      const data = await worksApi("/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids: selected, patch: { type } }),
      });
      setCatalog(data);
      setSelected([]);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toastApiError(error, copy);
    }
  }

  async function applyBulkGridSpan(gridSpan: GridSpan) {
    if (!selected.length || !canWrite) return;
    try {
      const data = await worksApi("/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids: selected, patch: { gridSpan } }),
      });
      setCatalog(data);
      setSelected([]);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toastApiError(error, copy);
    }
  }

  function endLasso() {
    lassoOrigin.current = null;
    dragged.current = false;
    captured.current = false;
    lassoRef.current = null;
    setLasso(null);
  }

  // Lasso starts anywhere on the admin surface (not only inside the grid);
  // interactive controls, the inbox, the selection bar and dialogs opt out.
  function onSurfacePointerDown(event: globalThis.PointerEvent) {
    if (event.button !== 0) return;
    if (editingRef.current || confirmRef.current) return;
    const target = event.target as Element | null;
    if (!target) return;
    if (
      target.closest(
        "input, textarea, select, a, button, label, [data-no-lasso], [role='dialog'], [role='alertdialog'], [data-slot='dialog-overlay']",
      )
    ) {
      return;
    }
    dragged.current = false;
    captured.current = false;
    lassoOrigin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    const seed = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
    lassoRef.current = seed;
    setLasso(seed);

    const onMove = (move: globalThis.PointerEvent) => {
      const origin = lassoOrigin.current;
      if (!origin || origin.pointerId !== move.pointerId) return;
      if (Math.hypot(move.clientX - origin.x, move.clientY - origin.y) <= DRAG_PX) return;
      if (!dragged.current) {
        dragged.current = true;
        document.body.style.userSelect = "none";
        captured.current = true;
      }
      const next = { x0: origin.x, y0: origin.y, x1: move.clientX, y1: move.clientY };
      lassoRef.current = next;
      setLasso(next);
    };

    const onUp = (up: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const origin = lassoOrigin.current;
      const current = lassoRef.current;
      const wasDrag = dragged.current;
      if (captured.current) document.body.style.userSelect = "";
      endLasso();
      if (!origin) return;
      if (wasDrag && current) {
        const box = lassoBox(current);
        if (box.width < 2 && box.height < 2) return;
        const hits = [...(gridRef.current?.querySelectorAll("[data-work-id]") || [])]
          .filter((el) => intersects(el, box))
          .map((el) => (el as HTMLElement).dataset.workId || "")
          .filter(Boolean);
        setSelected((prev) => {
          if (up.shiftKey) {
            const next = new Set(prev);
            for (const id of hits) {
              if (next.has(id)) next.delete(id);
              else next.add(id);
            }
            return [...next];
          }
          return hits;
        });
        return;
      }
      const card = (up.target as Element | null)?.closest?.("[data-work-id]");
      if (!(card instanceof HTMLElement)) {
        // Plain click on empty surface drops the selection.
        if (!up.shiftKey) setSelected([]);
        return;
      }
      const item = visibleRef.current.find((entry) => entry.id === card.dataset.workId);
      if (!item) return;
      if (up.shiftKey) {
        setSelected((prev) =>
          prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
        );
        return;
      }
      openEditor(item);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const surfaceDownRef = useRef(onSurfacePointerDown);
  surfaceDownRef.current = onSurfacePointerDown;
  useEffect(() => {
    const handler = (event: globalThis.PointerEvent) => surfaceDownRef.current(event);
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  // Esc drops the selection when no dialog is open.
  useEffect(() => {
    if (!selected.length || editing || confirmDelete || confirmBulk) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
      setSelected([]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.length, editing, confirmDelete, confirmBulk]);

  async function deleteSelected() {
    if (!selected.length || !canWrite) return;
    try {
      const data = await worksApi("/bulk", {
        method: "DELETE",
        body: JSON.stringify({ ids: selected }),
      });
      setCatalog(data);
      setSelected([]);
      setConfirmBulk(false);
      toast.success(copy("admin.saved"));
    } catch (error) {
      toastApiError(error, copy);
    }
  }

  const preview = editFiles?.[0]?.preview || (editing ? thumbSrc(editing) : "");
  // Every font file of the work (each weight / style) gets its own specimen line.
  const fontFaces: { key: string; name: string; url: string }[] = editFiles
    ? editFiles
        .filter((file) => isFontPath(file.filename))
        .map((file) => ({ key: file.preview, name: file.filename, url: file.preview }))
    : (editing?.files || [])
        .filter((file) => isFontPath(file))
        .map((file) => ({ key: file, name: file.split("/").pop() || file, url: workFileUrl(file) }));
  const rubber = lasso && dragged.current ? lassoBox(lasso) : null;
  const showingFont = editDraft.type === TYPE_FONT;
  const showingSlides = editDraft.type === TYPE_FINAL;
  const slidesDirty =
    editSlides.some((slide) => slide.upload) ||
    editSlides.length !== (editing?.files?.length ?? 0) ||
    editSlides.some((slide, index) => slide.file !== editing?.files?.[index]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp,.gif,.pdf,.ttf,.otf,.woff,.woff2,image/*,application/pdf,font/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {inbox.length > 0 ? (
        <Card
          data-no-lasso
          onKeyDown={(event) => {
            // Enter in any inbox field saves the whole inbox.
            if (event.key !== "Enter" || event.repeat) return;
            if (!(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            if (!progress) saveInbox();
          }}
        >
          <CardHeader className="border-b">
            <CardTitle>{copy("admin.inbox")}</CardTitle>
            <CardDescription>{inbox.length}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              {inbox.some((item) => item.type !== TYPE_DAILY) ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="works-bulk-author">{copy("admin.author")}</Label>
                  <AuthorNickInput
                    id="works-bulk-author"
                    placeholder={copy("admin.authorNick")}
                    author={bulkAuthor}
                    nick={bulkNick}
                    onChange={({ author, nick }) => {
                      setBulkAuthor(author);
                      setBulkNick(nick);
                    }}
                  />
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="works-bulk-stream">{copy("admin.stream")}</Label>
                <Input
                  id="works-bulk-stream"
                  list="works-stream-list"
                  value={bulkStream}
                  onChange={(event) => setBulkStream(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setInbox((current) =>
                    current.map((item) =>
                      item.type === TYPE_DAILY
                        ? { ...item, stream: bulkStream.trim() || item.stream }
                        : {
                            ...item,
                            author: bulkAuthor.trim() || item.author,
                            nick: normalizeNick(bulkNick) || item.nick,
                            stream: bulkStream.trim() || item.stream,
                          },
                    ),
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
                    "grid items-center gap-3 rounded-xl border p-2",
                    item.type === TYPE_DAILY
                      ? "sm:grid-cols-[72px_auto_5rem_1fr_auto]"
                      : "sm:grid-cols-[72px_auto_1fr_1fr_auto]",
                  )}
                >
                  <div className="relative size-[72px] overflow-hidden rounded-lg bg-muted">
                    {item.type === TYPE_FONT && item.files[0]?.preview ? (
                      <FontPreview url={item.files[0].preview} id={item.key} className="text-lg" />
                    ) : item.files[0]?.preview ? (
                      <img src={item.files[0].preview} alt="" className="size-full object-contain" />
                    ) : null}
                    {item.type === TYPE_FINAL && item.files.length > 1 ? (
                      <span className="absolute inset-x-0 bottom-0 bg-background/80 px-1 text-center text-[10px] leading-4">
                        {copy("admin.slides").replace("{n}", String(item.files.length))}
                      </span>
                    ) : null}
                  </div>
                  <TypeSelect
                    value={item.type}
                    onChange={(type) => {
                      setInbox((current) =>
                        current.map((entry) =>
                          entry.key === item.key
                            ? {
                                ...entry,
                                type,
                                ...(type === TYPE_DAILY ? { author: "", nick: "" } : {}),
                              }
                            : entry,
                        ),
                      );
                    }}
                    copy={copy}
                  />
                  {item.type === TYPE_DAILY ? (
                    <Input
                      placeholder={copy("admin.glyph")}
                      aria-label={copy("admin.glyph")}
                      maxLength={8}
                      className="text-center"
                      value={item.glyph || ""}
                      onChange={(event) => {
                        const glyph = event.target.value;
                        setInbox((current) =>
                          current.map((entry) => (entry.key === item.key ? { ...entry, glyph } : entry)),
                        );
                      }}
                    />
                  ) : (
                    <AuthorNickInput
                      placeholder={copy("admin.authorNick")}
                      aria-label={copy("admin.author")}
                      author={item.author}
                      nick={item.nick}
                      onChange={({ author, nick }) => {
                        setInbox((current) =>
                          current.map((entry) => (entry.key === item.key ? { ...entry, author, nick } : entry)),
                        );
                      }}
                    />
                  )}
                  <Input
                    placeholder={copy("admin.stream")}
                    list="works-stream-list"
                    value={item.stream}
                    onChange={(event) => {
                      const stream = event.target.value;
                      setInbox((current) =>
                        current.map((entry) => (entry.key === item.key ? { ...entry, stream } : entry)),
                      );
                    }}
                  />
                  <div className="grid gap-1">
                    {item.type === TYPE_FONT ? (
                      <ul className="max-w-[10rem] truncate text-[11px] leading-tight text-muted-foreground">
                        {item.files.map((file) => (
                          <li key={file.filename} className="truncate">
                            {file.filename}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        revokeUploads(item.files);
                        setInbox((current) => current.filter((entry) => entry.key !== item.key));
                      }}
                    >
                      {copy("admin.remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={Boolean(progress)}
              onClick={() => {
                inbox.forEach((item) => revokeUploads(item.files));
                setInbox([]);
              }}
            >
              {copy("admin.clear")}
            </Button>
            <Button type="button" disabled={Boolean(progress)} onClick={saveInbox}>
              <FileUpIcon data-icon="inline-start" />
              {progress?.kind === "save"
                ? copy("admin.sending")
                    .replace("{n}", String(progress.n))
                    .replace("{total}", String(progress.total))
                : copy("admin.save")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-base font-medium">{copy("admin.worksCatalog")}</h2>
            <TypeTabs value={catalogType} onChange={setCatalogType} copy={copy} />
            <button
              type="button"
              className="text-sm underline underline-offset-2"
              disabled={Boolean(progress)}
              onClick={() => inputRef.current?.click()}
            >
              {copy("admin.upload")}
            </button>
          </div>
          <Badge variant="outline">{copy("admin.countWorks").replace("{n}", String(visible.length))}</Badge>
        </div>
        {visible.length ? (
          <div
            ref={gridRef}
            className="relative grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 select-none"
          >
            {visible.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                data-work-id={item.id}
                title={
                  item.type === TYPE_DAILY
                    ? [item.glyph, item.stream].filter(Boolean).join(" · ")
                    : [item.author, item.nick && `@${item.nick}`, item.stream].filter(Boolean).join(" · ")
                }
                className={cn(
                  "grid cursor-pointer gap-2 overflow-hidden rounded-xl bg-card p-2 text-left ring-1 ring-foreground/10 transition hover:ring-foreground/40",
                  selected.includes(item.id) && "ring-2 ring-primary",
                )}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEditor(item);
                  }
                }}
              >
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                  {normalizeWorkType(item.type) === TYPE_FONT && fontUrl(item) ? (
                    <FontPreview
                      url={fontUrl(item)}
                      id={item.id}
                      text={item.sample}
                      caps={item.caps}
                      latin={item.latin}
                    />
                  ) : thumbSrc(item) ? (
                    <img src={thumbSrc(item)} alt="" className="pointer-events-none size-full object-contain" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                      {copy(typeKey(item.type))}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  {item.type === TYPE_DAILY ? (
                    <p className="truncate text-sm font-medium">{item.glyph || copy(typeKey(item.type))}</p>
                  ) : (
                    <p className="truncate text-sm font-medium">
                      {item.author || "—"}
                      {item.nick ? ` @${item.nick}` : ""}
                    </p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {copy(typeKey(item.type))}
                    {item.stream ? ` · ${item.stream}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileUpIcon />
              </EmptyMedia>
              <EmptyTitle>{copy("admin.emptyWorks")}</EmptyTitle>
              <EmptyDescription>{copy("admin.worksHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      {hot ? (
        <div className="pointer-events-none fixed inset-0 z-40 bg-primary/10 ring-4 ring-inset ring-primary/50" />
      ) : null}

      {rubber ? (
        <div
          className="works-lasso pointer-events-none fixed z-40 border border-primary bg-primary/15"
          style={{
            left: rubber.left,
            top: rubber.top,
            width: rubber.width,
            height: rubber.height,
          }}
        />
      ) : null}

      {selected.length > 0 ? (
        <div
          data-no-lasso
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-6"
        >
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {copy("admin.selected").replace("{n}", String(selected.length))}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                {copy("admin.deselect")}
                <kbd className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">esc</kbd>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TypeTabs value={catalogType} onChange={applyBulkType} copy={copy} />
              <GridSpanSelect
                value=""
                onChange={applyBulkGridSpan}
                copy={copy}
                ariaLabel={copy("admin.bulkGridSpan")}
                placeholder={copy("admin.bulkGridSpan")}
              />
              <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmBulk(true)}>
                <Trash2Icon data-icon="inline-start" />
                {copy("admin.delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <datalist id="works-author-nick-list">
        {authorNicks.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="works-stream-list">
        {streams.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 flex h-[var(--frame-h)] w-[var(--frame-w)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto overscroll-contain rounded-none p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">
            {editDraft.type === TYPE_DAILY
              ? editDraft.glyph || copy("admin.type.daily")
              : editDraft.author || copy("admin.works")}
          </DialogTitle>
          <form onSubmit={saveEdit} className="flex min-h-full flex-col">
            <div className="grid w-full flex-1 gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_20rem]">
              <div
                data-edit-surface
                className={cn(
                  "grid gap-2 rounded-xl transition-[box-shadow]",
                  editDrop && editDropSlide === null ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "",
                )}
                onDragOver={onEditSurfaceDragOver}
                onDragLeave={onEditSurfaceDragLeave}
                onDrop={onEditSurfaceDrop}
              >
                <input
                  ref={replaceRef}
                  type="file"
                  accept={acceptFor(editDraft.type)}
                  multiple={editDraft.type === TYPE_FINAL || editDraft.type === TYPE_FONT}
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files) applyEditUploads(event.target.files, "all");
                    event.target.value = "";
                  }}
                />
                <input
                  ref={slideInputRef}
                  type="file"
                  accept={acceptFor(TYPE_FINAL)}
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files) onSlidesPicked(event.target.files);
                    event.target.value = "";
                  }}
                />
                {showingSlides ? (
                  <div className="grid gap-3">
                    {editSlides.length ? (
                      <ol className="grid gap-3">
                        {editSlides.map((slide, index) => {
                          const src =
                            slide.upload?.preview || (editing && slide.file ? fileSrc(editing, slide.file) : "");
                          return (
                            <li
                              key={slide.key}
                              data-edit-slide={index}
                              className={cn(
                                "group relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10 transition-[box-shadow]",
                                editDropSlide === index ? "ring-2 ring-primary" : "",
                              )}
                            >
                              <button
                                type="button"
                                title={copy("admin.replaceSlide")}
                                className="block w-full cursor-pointer"
                                onClick={() => pickSlides(index)}
                              >
                                {src ? (
                                  <img src={src} alt="" className="block h-auto w-full" />
                                ) : (
                                  <span className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">
                                    {copy("admin.slide").replace("{n}", String(index + 1))}
                                  </span>
                                )}
                              </button>
                              <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-background/85 px-1.5 py-0.5 text-xs tabular-nums backdrop-blur">
                                {index + 1}
                                {slide.upload ? " •" : ""}
                              </span>
                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="shadow-sm"
                                  onClick={() => pickSlides(index)}
                                >
                                  {copy("admin.replaceSlide")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="shadow-sm"
                                  disabled={editSlides.length < 2}
                                  onClick={() => removeSlide(index)}
                                >
                                  {copy("admin.remove")}
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <button
                        type="button"
                        className="flex min-h-[min(20rem,calc(var(--frame-h)*0.4))] w-full cursor-pointer items-center justify-center rounded-xl bg-muted p-6 text-sm text-muted-foreground"
                        onClick={() => pickSlides(null)}
                      >
                        {copy("admin.replaceHint")}
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    title={copy("admin.replaceHint")}
                    className="flex min-h-[calc(var(--frame-h)-3rem)] w-full cursor-pointer flex-col items-center justify-center self-start rounded-xl bg-muted p-6"
                    onClick={() => replaceRef.current?.click()}
                  >
                    {showingFont && fontFaces.length ? (
                      <ul className="grid w-full gap-8">
                        {fontFaces.map((face, index) => (
                          <li key={face.key} className="grid gap-2">
                            <FontPreview
                              url={face.url}
                              id={`${editing?.id || "edit-font"}-${index}`}
                              text={editDraft.sample}
                              caps={editDraft.caps}
                              latin={editDraft.latin}
                              className="min-h-24 w-full overflow-visible text-clip whitespace-normal text-[clamp(2.5rem,9vw,10rem)] leading-none"
                            />
                            <span className="text-center text-xs text-muted-foreground">{face.name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : preview ? (
                      <img src={preview} alt="" className="block h-auto w-full object-contain" />
                    ) : (
                      <span className="text-sm text-muted-foreground">{copy(typeKey(editDraft.type))}</span>
                    )}
                  </button>
                )}
              </div>
              <div className="grid gap-3 content-start sm:sticky sm:top-6 sm:self-start">
                <div className="flex items-center gap-1">
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
                  <span className="ml-1 text-sm text-muted-foreground tabular-nums">
                    {editIndex >= 0 ? `${editIndex + 1} / ${visualIds.length}` : ""}
                    {showingSlides && editSlides.length > 1
                      ? ` · ${copy("admin.slides").replace("{n}", String(editSlides.length))}`
                      : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={copy("admin.close")}
                    onClick={closeEditor}
                  >
                    <XIcon />
                  </Button>
                </div>
                <TypeTabs
                  value={editDraft.type}
                  onChange={(type) =>
                    setEditDraft((current) => ({
                      ...current,
                      type,
                      ...(type === TYPE_DAILY ? { author: "", nick: "" } : {}),
                    }))
                  }
                  copy={copy}
                />
                {editDraft.type === TYPE_DAILY ? null : (
                <div className="grid gap-1.5">
                  <Label htmlFor="work-edit-author">{copy("admin.author")}</Label>
                  <AuthorNickInput
                    id="work-edit-author"
                    placeholder={copy("admin.authorNick")}
                    author={editDraft.author}
                    nick={editDraft.nick}
                    onChange={({ author, nick }) =>
                      setEditDraft((current) => ({ ...current, author, nick }))
                    }
                  />
                </div>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="work-edit-stream">{copy("admin.stream")}</Label>
                  <Input
                    id="work-edit-stream"
                    list="works-stream-list"
                    value={editDraft.stream}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, stream: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="work-edit-grid-span">{copy("admin.gridSpan")}</Label>
                  <GridSpanSelect
                    value={editDraft.gridSpan}
                    onChange={(gridSpan) =>
                      setEditDraft((current) => ({ ...current, gridSpan }))
                    }
                    copy={copy}
                    ariaLabel={copy("admin.gridSpan")}
                  />
                </div>
                {editDraft.type === TYPE_DAILY ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="work-edit-glyph">{copy("admin.glyph")}</Label>
                    <Input
                      id="work-edit-glyph"
                      maxLength={8}
                      placeholder={copy("admin.glyphHint")}
                      value={editDraft.glyph}
                      onChange={(event) =>
                        setEditDraft((current) => ({ ...current, glyph: event.target.value }))
                      }
                    />
                  </div>
                ) : null}
                {showingFont ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="work-edit-sample">{copy("admin.sample")}</Label>
                    <Input
                      id="work-edit-sample"
                      maxLength={120}
                      placeholder={copy("admin.sampleHint")}
                      value={editDraft.sample}
                      onChange={(event) =>
                        setEditDraft((current) => ({ ...current, sample: event.target.value }))
                      }
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editDraft.caps}
                        onChange={(event) =>
                          setEditDraft((current) => ({ ...current, caps: event.target.checked }))
                        }
                      />
                      {copy("admin.fontCaps")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editDraft.latin}
                        onChange={(event) =>
                          setEditDraft((current) => ({ ...current, latin: event.target.checked }))
                        }
                      />
                      {copy("admin.fontLatin")}
                    </label>
                  </div>
                ) : null}
                <div className="grid gap-2 border-t pt-3">
                  {showingSlides ? (
                    <Button type="button" variant="outline" onClick={() => pickSlides(null)}>
                      <FileUpIcon data-icon="inline-start" />
                      {copy("admin.addSlides")}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => replaceRef.current?.click()}>
                      <FileUpIcon data-icon="inline-start" />
                      {copy("admin.replaceFile")}
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 border-t pt-3">
                  <Button type="submit">{copy("admin.save")}</Button>
                  <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2Icon data-icon="inline-start" />
                    {copy("admin.delete")}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent onKeyDown={confirmOnEnter(deleteSelected)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy("admin.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy("admin.confirmDeleteMany").replace("{n}", String(selected.length))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy("admin.close")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteSelected}>
              {copy("admin.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onKeyDown={confirmOnEnter(deleteEditing)}>
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
    </>
  );
}
