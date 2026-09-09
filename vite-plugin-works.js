import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sanitizeSvg } from "./src/letters/svg.js";
import {
  emptyWorksCatalog,
  hydrateWorksCatalog,
  normalizeName,
  normalizeNick,
  normalizeWorkType,
  WORKS_CATALOG_EVENT,
} from "./src/works/taxonomy.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function shortId() {
  return randomBytes(4).toString("hex");
}

function extFrom(name, mime) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  if (String(mime).includes("svg")) return ".svg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg") return ".jpg";
  if (String(mime).includes("woff2")) return ".woff2";
  if (String(mime).includes("woff")) return ".woff";
  if (String(mime).includes("font") || String(mime).includes("otf")) return ".otf";
  if (String(mime).includes("ttf")) return ".ttf";
  return ".bin";
}

function decodeUpload(file) {
  const mime = String(file?.mime || "");
  const data = String(file?.data || "");
  const filename = String(file?.filename || "file");
  if (mime.includes("svg") || data.trim().startsWith("<")) {
    const svg = sanitizeSvg(data);
    return { buffer: Buffer.from(svg, "utf8"), ext: ".svg" };
  }
  const raw = data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("Empty file");
  return { buffer, ext: extFrom(filename, mime) };
}

function sizeFromSvg(svg) {
  const view = String(svg).match(/viewBox=["']([\d.\s,-]+)["']/i);
  if (view) {
    const parts = view[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  const w = Number(String(svg).match(/\bwidth=["']([\d.]+)/i)?.[1]);
  const h = Number(String(svg).match(/\bheight=["']([\d.]+)/i)?.[1]);
  if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  return { width: 0, height: 0 };
}

function fieldsFromBody(item, previous = {}) {
  const type = normalizeWorkType(item.type ?? previous.type);
  const author = normalizeName(item.author !== undefined ? item.author : previous.author);
  const nick = normalizeNick(item.nick !== undefined ? item.nick : previous.nick);
  const stream = String(
    item.stream !== undefined ? item.stream : previous.stream || "",
  ).trim();
  if (!stream) throw new Error("Each work needs a stream");
  const width = Number(item.width ?? previous.width) || 0;
  const height = Number(item.height ?? previous.height) || 0;
  return { type, author, nick, stream, width, height };
}

export function worksAdminPlugin() {
  let root = process.cwd();
  let viteServer = null;
  let chain = Promise.resolve();

  function notifyCatalog() {
    viteServer?.ws.send({ type: "custom", event: WORKS_CATALOG_EVENT });
  }

  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const paths = () => {
    const dir = path.join(root, "public", "works");
    return {
      dir,
      filesDir: path.join(dir, "files"),
      catalogPath: path.join(dir, "catalog.json"),
    };
  };

  async function readCatalog() {
    const { dir, filesDir, catalogPath } = paths();
    await fs.mkdir(filesDir, { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    try {
      const raw = await fs.readFile(catalogPath, "utf8");
      return hydrateWorksCatalog(JSON.parse(raw));
    } catch {
      return emptyWorksCatalog();
    }
  }

  async function writeCatalog(catalog) {
    const { catalogPath } = paths();
    catalog.updatedAt = new Date().toISOString();
    await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    notifyCatalog();
    return catalog;
  }

  async function writeUploads(id, uploads) {
    const { filesDir } = paths();
    await fs.mkdir(filesDir, { recursive: true });
    const files = [];
    let width = 0;
    let height = 0;
    for (const [index, upload] of uploads.entries()) {
      const decoded = decodeUpload(upload);
      const file = `${id}_${index}${decoded.ext}`;
      await fs.writeFile(path.join(filesDir, file), decoded.buffer);
      files.push(file);
      if (!width && decoded.ext === ".svg") {
        const size = sizeFromSvg(decoded.buffer.toString("utf8"));
        width = size.width;
        height = size.height;
      }
    }
    return { files, width, height };
  }

  async function removeFiles(names) {
    const { filesDir } = paths();
    await Promise.all(
      (names || []).map((name) => fs.unlink(path.join(filesDir, name)).catch(() => {})),
    );
  }

  return {
    name: "works-admin",
    configResolved(config) {
      root = config.root;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes(`${path.sep}public${path.sep}works${path.sep}`)) {
        notifyCatalog();
        return [];
      }
    },
    configureServer(server) {
      viteServer = server;
      const worksDir = path.join(root, "public", "works");
      const ignoreWorks = (file) => {
        if (file.startsWith(worksDir)) server.watcher.unwatch(file);
      };
      server.watcher.unwatch(path.join(worksDir, "**"));
      server.watcher.on("add", ignoreWorks);
      server.watcher.on("change", ignoreWorks);
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] || "";
        if (!url.startsWith("/api/works")) {
          next();
          return;
        }

        try {
          if (req.method === "GET" && url === "/api/works") {
            json(res, 200, await readCatalog());
            return;
          }

          if (req.method === "POST" && url === "/api/works") {
            const body = await readBody(req);
            const items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) {
              json(res, 400, { error: "Nothing to save" });
              return;
            }

            const catalog = await serial(async () => {
              const current = await readCatalog();
              for (const item of items) {
                const fields = fieldsFromBody(item);
                const uploads = Array.isArray(item.files) ? item.files : [];
                if (!uploads.length) throw new Error("Each work needs a file");
                const id = `wrk_${shortId()}`;
                const written = await writeUploads(id, uploads);
                current.items.push({
                  id,
                  ...fields,
                  files: written.files,
                  width: fields.width || written.width,
                  height: fields.height || written.height,
                  originalName: String(uploads[0]?.filename || written.files[0]),
                  createdAt: new Date().toISOString(),
                });
              }
              return writeCatalog(current);
            });

            json(res, 200, catalog);
            return;
          }

          if (req.method === "PATCH" && url === "/api/works/bulk") {
            const body = await readBody(req);
            const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
            const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
            if (!ids.length) {
              json(res, 400, { error: "Nothing to update" });
              return;
            }
            const catalog = await serial(async () => {
              const current = await readCatalog();
              const wanted = new Set(ids);
              let found = 0;
              current.items = current.items.map((entry) => {
                if (!wanted.has(entry.id)) return entry;
                found += 1;
                if (patch.type !== undefined) {
                  return { ...entry, type: normalizeWorkType(patch.type) };
                }
                return entry;
              });
              if (!found) {
                const err = new Error("Not found");
                err.status = 404;
                throw err;
              }
              return writeCatalog(current);
            });
            json(res, 200, catalog);
            return;
          }

          const match = url.match(/^\/api\/works\/([^/]+)$/);
          if (match && (req.method === "PATCH" || req.method === "DELETE")) {
            const id = decodeURIComponent(match[1]);
            const catalog = await serial(async () => {
              const current = await readCatalog();
              const index = current.items.findIndex((item) => item.id === id);
              if (index === -1) {
                const err = new Error("Not found");
                err.status = 404;
                throw err;
              }

              if (req.method === "DELETE") {
                const [removed] = current.items.splice(index, 1);
                await removeFiles(removed?.files);
                return writeCatalog(current);
              }

              const body = await readBody(req);
              const entry = current.items[index];
              Object.assign(entry, fieldsFromBody(body, entry));
              const uploads = Array.isArray(body.files) ? body.files : [];
              if (uploads.length) {
                await removeFiles(entry.files);
                const written = await writeUploads(entry.id, uploads);
                entry.files = written.files;
                entry.width = entry.width || written.width;
                entry.height = entry.height || written.height;
                entry.originalName = String(uploads[0]?.filename || written.files[0]);
                entry.updatedAt = new Date().toISOString();
              }
              return writeCatalog(current);
            });

            json(res, 200, catalog);
            return;
          }

          json(res, 404, { error: "Unknown works endpoint" });
        } catch (error) {
          json(res, error.status || 400, { error: error.message || "Failed" });
        }
      });
    },
  };
}
