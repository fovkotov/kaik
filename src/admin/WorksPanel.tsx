import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
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
  TYPE_FINAL,
  TYPE_FONT,
  TYPE_LETTERING,
  WORK_TYPES,
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
  files: string[];
  width?: number;
  height?: number;
  originalName?: string;
  createdAt: string;
  updatedAt?: string;
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
  files: UploadFile[];
};

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

const RASTER_LONG_SIDE = 1600;
const RASTER_WEBP_QUALITY = 0.82;
const UPLOAD_CONCURRENCY = 3;

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
  const res = await fetch("/api/works/upload", {
    method: "POST",
    headers: {
      "Content-Type": file.mime || body.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.filename),
    },
    body,
  });
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
  const res = await fetch(`/api/works${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
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
  return "admin.type.lettering";
}

function acceptFor(type: WorkType) {
  if (type === TYPE_FINAL) return "image/*,.svg,.png,.jpg,.jpeg,.webp,.pdf,application/pdf";
  if (type === TYPE_FONT) return ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
  return ".svg,image/svg+xml";
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
    out.push(await fileToUpload(file, type === TYPE_FINAL));
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
        const next = event.target.value;
        if (next === TYPE_LETTERING || next === TYPE_FINAL || next === TYPE_FONT) onChange(next);
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
  });
  const [editFiles, setEditFiles] = useState<UploadFile[] | null>(null);
  const [editSlides, setEditSlides] = useState<Slide[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [lasso, setLasso] = useState<Lasso | null>(null);
  const [progress, setProgress] = useState<{ kind: "import" | "save"; n: number; total: number } | null>(null);
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
  const authors = useMemo(() => uniqueWorkValues(items, "author"), [items]);
  const nicks = useMemo(() => uniqueWorkValues(items, "nick"), [items]);
  const streams = useMemo(() => uniqueWorkValues(items, "stream"), [items]);
  const visualIds = useMemo(() => visible.map((item) => item.id), [visible]);
  const editIndex = editing ? visualIds.indexOf(editing.id) : -1;
  const canCycle = visualIds.length > 1;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

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
    const fonts = files.filter((file) => kindOf(file) === "font");
    const rasters = files.filter((file) => kindOf(file) === "raster");
    const pdfs = files.filter((file) => kindOf(file) === "pdf");
    const singles = files.filter((file) => {
      const kind = kindOf(file);
      return kind === "svg" || kind === "other";
    });
    const total = fonts.length + rasters.length + pdfs.length + singles.length;
    let done = 0;
    setProgress({ kind: "import", n: 0, total });
    const toastId = toast.loading(
      copy("admin.preparing").replace("{n}", "0").replace("{total}", String(total)),
    );
    const tick = async () => {
      done += 1;
      setProgress({ kind: "import", n: done, total });
      toast.loading(
        copy("admin.preparing").replace("{n}", String(done)).replace("{total}", String(total)),
        { id: toastId },
      );
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
          type: TYPE_LETTERING,
          author: bulkAuthor,
          nick: normalizeNick(bulkNick),
          stream: bulkStream,
          files: [await fileToUpload(file)],
        });
        await tick();
      }
      setInbox((current) => [...current, ...next]);
      toast.dismiss(toastId);
    } catch {
      toast.error(copy("admin.error"), { id: toastId });
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
      if (event.dataTransfer?.files?.length) addFilesRef.current(event.dataTransfer.files);
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

  function inboxReady(item: InboxItem) {
    return Boolean(item.author.trim() && item.stream.trim() && item.files.length);
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
    const leftover = [...inbox];
    const totalFiles = leftover.reduce((sum, item) => sum + item.files.length, 0);
    let uploaded = 0;
    setProgress({ kind: "save", n: 0, total: totalFiles });
    const toastId = toast.loading(
      copy("admin.sending").replace("{n}", "0").replace("{total}", String(totalFiles)),
    );
    try {
      let data: WorksCatalog | null = null;
      while (leftover.length) {
        const item = leftover[0];
        const files = await mapPool(item.files, UPLOAD_CONCURRENCY, async (file) => {
          const packed = await packFile(file);
          uploaded += 1;
          setProgress({ kind: "save", n: uploaded, total: totalFiles });
          toast.loading(
            copy("admin.sending").replace("{n}", String(uploaded)).replace("{total}", String(totalFiles)),
            { id: toastId },
          );
          return packed;
        });
        data = await worksApi("", {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                type: item.type,
                author: item.author,
                nick: item.nick,
                stream: item.stream,
                ...itemDims(item.files),
                files,
              },
            ],
          }),
        });
        revokeUploads(item.files);
        leftover.shift();
        setInbox([...leftover]);
        setCatalog(data);
      }
      setInbox([]);
      toast.success(copy("admin.saved"), { id: toastId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message === "TOO_LARGE" ? copy("admin.tooLarge") : message || copy("admin.error"), {
        id: toastId,
      });
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
    });
    setEditFiles(null);
    setEditSlides(slidesFrom(item));
  }

  function closeEditor() {
    discardEditUploads();
    setEditing(null);
    setEditFiles(null);
    setEditSlides([]);
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

  async function onSlidesPicked(list: FileList) {
    let files: UploadFile[];
    try {
      files = await filesForType([...list], TYPE_FINAL);
    } catch {
      toast.error(copy("admin.badPdf"));
      return;
    }
    if (!files.length) return;
    const target = slideTarget.current;
    slideTarget.current = null;
    setEditSlides((current) => {
      const next = [...current];
      const fresh = files.map(toSlide);
      if (target === null || target < 0 || target >= next.length) return [...next, ...fresh];
      const [old] = next.splice(target, 1, ...fresh);
      if (old?.upload) revokeUpload(old.upload);
      return next;
    });
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

  function endLasso() {
    lassoOrigin.current = null;
    dragged.current = false;
    captured.current = false;
    lassoRef.current = null;
    setLasso(null);
  }

  function onGridPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as Element).closest("input, textarea, select, a")) return;
    const grid = event.currentTarget;
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
        grid.setPointerCapture(move.pointerId);
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
      if (captured.current) {
        try {
          grid.releasePointerCapture(up.pointerId);
        } catch {
          /* already released */
        }
      }
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
      if (!(card instanceof HTMLElement)) return;
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

  const preview = editFiles?.[0]?.preview || (editing ? thumbSrc(editing) : "");
  const editFontUrl = editFiles?.[0]?.preview || (editing ? fontUrl(editing) : "");
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
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{copy("admin.inbox")}</CardTitle>
            <CardDescription>{inbox.length}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="works-bulk-author">{copy("admin.author")}</Label>
                <Input
                  id="works-bulk-author"
                  list="works-author-list"
                  value={bulkAuthor}
                  onChange={(event) => setBulkAuthor(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="works-bulk-nick">{copy("admin.nick")}</Label>
                <Input
                  id="works-bulk-nick"
                  list="works-nick-list"
                  value={bulkNick}
                  onChange={(event) => setBulkNick(event.target.value)}
                />
              </div>
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
                    current.map((item) => ({
                      ...item,
                      author: bulkAuthor.trim() || item.author,
                      nick: normalizeNick(bulkNick) || item.nick,
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
                  className="grid items-center gap-3 rounded-xl border p-2 sm:grid-cols-[72px_auto_1fr_1fr_1fr_auto]"
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
                        current.map((entry) => (entry.key === item.key ? { ...entry, type } : entry)),
                      );
                    }}
                    copy={copy}
                  />
                  <Input
                    placeholder={copy("admin.author")}
                    list="works-author-list"
                    value={item.author}
                    onChange={(event) => {
                      const author = event.target.value;
                      setInbox((current) =>
                        current.map((entry) => (entry.key === item.key ? { ...entry, author } : entry)),
                      );
                    }}
                  />
                  <Input
                    placeholder={copy("admin.nick")}
                    list="works-nick-list"
                    value={item.nick}
                    onChange={(event) => {
                      const nick = normalizeNick(event.target.value);
                      setInbox((current) =>
                        current.map((entry) => (entry.key === item.key ? { ...entry, nick } : entry)),
                      );
                    }}
                  />
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
            className="relative grid grid-cols-2 gap-2 select-none sm:grid-cols-3 md:grid-cols-4"
            onPointerDown={onGridPointerDown}
          >
            {visible.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                data-work-id={item.id}
                title={`${item.author} @${item.nick} · ${item.stream}`}
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
                    <FontPreview url={fontUrl(item)} id={item.id} />
                  ) : thumbSrc(item) ? (
                    <img src={thumbSrc(item)} alt="" className="pointer-events-none size-full object-contain" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                      {copy(typeKey(item.type))}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {item.author || "—"}
                    {item.nick ? ` @${item.nick}` : ""}
                  </p>
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

      {progress ? (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
          <div className="rounded-full border bg-background px-4 py-2 text-sm shadow-sm">
            {copy(progress.kind === "import" ? "admin.preparing" : "admin.sending")
              .replace("{n}", String(progress.n))
              .replace("{total}", String(progress.total))}
          </div>
        </div>
      ) : null}

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
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {copy("admin.selected").replace("{n}", String(selected.length))}
            </p>
            <TypeTabs value={catalogType} onChange={applyBulkType} copy={copy} />
          </div>
        </div>
      ) : null}

      <datalist id="works-author-list">
        {authors.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="works-nick-list">
        {nicks.map((value) => (
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
          <DialogTitle className="sr-only">{editDraft.author || copy("admin.works")}</DialogTitle>
          <form onSubmit={saveEdit} className="flex min-h-full flex-col">
            <div
              className={cn(
                "mx-auto grid w-full flex-1 gap-6 p-6 sm:grid-cols-[minmax(0,1.2fr)_minmax(16rem,20rem)]",
                showingSlides ? "max-w-none" : "max-w-5xl",
              )}
            >
              <div className="grid gap-2">
                <input
                  ref={replaceRef}
                  type="file"
                  accept={acceptFor(editDraft.type)}
                  multiple={editDraft.type === TYPE_FINAL || editDraft.type === TYPE_FONT}
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files) {
                      const type = editDraft.type;
                      filesForType([...event.target.files], type)
                        .then((files) => {
                          if (type === TYPE_FINAL) {
                            revokeSlides(editSlides);
                            setEditSlides(files.map(toSlide));
                            return;
                          }
                          if (editFiles) revokeUploads(editFiles);
                          setEditFiles(files);
                        })
                        .catch(() =>
                          toast.error(type === TYPE_FINAL ? copy("admin.badPdf") : copy("admin.badSvg")),
                        );
                    }
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
                              className="group relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10"
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
                    title={copy("admin.replaceFile")}
                    className="flex min-h-[min(28rem,calc(var(--frame-h)*0.55))] w-full cursor-pointer flex-col items-center justify-center rounded-xl bg-muted p-6"
                    onClick={() => replaceRef.current?.click()}
                  >
                    {showingFont && editFontUrl ? (
                      <FontPreview
                        url={editFontUrl}
                        id={editing?.id || "edit-font"}
                        className="min-h-40 text-5xl"
                      />
                    ) : preview ? (
                      <img
                        src={preview}
                        alt=""
                        className="max-h-[min(24rem,calc(var(--frame-h)*0.45))] w-full object-contain"
                      />
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
                  onChange={(type) => setEditDraft((current) => ({ ...current, type }))}
                  copy={copy}
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="work-edit-author">{copy("admin.author")}</Label>
                  <Input
                    id="work-edit-author"
                    required
                    list="works-author-list"
                    value={editDraft.author}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, author: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="work-edit-nick">{copy("admin.nick")}</Label>
                  <Input
                    id="work-edit-nick"
                    list="works-nick-list"
                    value={editDraft.nick}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, nick: normalizeNick(event.target.value) }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="work-edit-stream">{copy("admin.stream")}</Label>
                  <Input
                    id="work-edit-stream"
                    required
                    list="works-stream-list"
                    value={editDraft.stream}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, stream: event.target.value }))
                    }
                  />
                </div>
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
                  {showingFont ? (
                    <ul className="text-xs text-muted-foreground">
                      {(editFiles || editing?.files || []).map((file) => {
                        const name = typeof file === "string" ? file : file.filename;
                        return (
                          <li key={name} className="truncate">
                            {name.split("/").pop()}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
                <div className="grid gap-2 border-t pt-3">
                  <Button type="submit">{copy("admin.save")}</Button>
                  <Button type="button" variant="outline" onClick={closeEditor}>
                    {copy("admin.close")}
                  </Button>
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
    </>
  );
}
