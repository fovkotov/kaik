import "./map-polyfill";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const LONG_SIDE = 1600;
const WEBP_QUALITY = 0.92;

export type PdfSlide = {
  filename: string;
  mime: string;
  data: string;
  preview: string;
  width: number;
  height: number;
};

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "") || "final";
}

export async function pdfToWebpSlides(file: File): Promise<PdfSlide[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  if (!doc.numPages) throw new Error("empty pdf");

  const base = stem(file.name);
  const slides: PdfSlide[] = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const unit = page.getViewport({ scale: 1 });
    const long = Math.max(unit.width, unit.height) || 1;
    const viewport = page.getViewport({ scale: LONG_SIDE / long });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY);
    });
    if (!blob) throw new Error("webp");
    const data = await blobToDataUrl(blob);
    slides.push({
      filename: `${base}-${String(i).padStart(2, "0")}.webp`,
      mime: "image/webp",
      data,
      preview: data,
      width: canvas.width,
      height: canvas.height,
    });
  }

  return slides;
}
