import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sanitizeSvg } from "./src/letters/svg.js";
import { normalizeChar } from "./src/letters/shared.js";
import {
  CONSTRUCTIONS,
  FAMILIES,
  KIND_LETTER,
  KIND_WORD,
  inferTextFromFilename,
  normalizeEntry,
  normalizeKind,
  normalizeTag,
  normalizeText,
} from "./src/letters/taxonomy.js";

const MAX_SVG_BYTES = 1_500_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SVG_BYTES * 8) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
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

function emptyCatalog() {
  return { version: 1, updatedAt: null, letters: [] };
}

function readCatalogData(raw) {
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.letters)) return emptyCatalog();
  return {
    ...data,
    letters: data.letters.map(normalizeEntry).filter(Boolean),
  };
}

function fieldsFromBody(item, previous = {}) {
  const kind = normalizeKind(item.kind ?? previous.kind);
  const construction = normalizeTag(
    item.construction !== undefined ? item.construction : previous.construction,
    CONSTRUCTIONS,
  );
  const family = normalizeTag(
    item.family !== undefined ? item.family : previous.family,
    FAMILIES,
  );
  const text =
    kind === KIND_WORD
      ? normalizeText(item.text !== undefined ? item.text : previous.text) ||
        inferTextFromFilename(item.filename || previous.originalName)
      : "";
  const char =
    kind === KIND_LETTER
      ? normalizeChar(item.char !== undefined ? item.char : previous.char)
      : normalizeChar(item.char !== undefined ? item.char : previous.char) ||
        normalizeChar(text);

  if (kind === KIND_LETTER && !char) throw new Error("Each letter needs a character");
  if (kind === KIND_WORD && !text) throw new Error("Each word needs a text");

  const author = String(
    item.author !== undefined ? item.author : previous.author || "",
  ).trim();
  const stream = String(
    item.stream !== undefined ? item.stream : previous.stream || "",
  ).trim();
  if (!author) throw new Error("Each work needs an author");
  if (!stream) throw new Error("Each work needs a stream");

  return { kind, char, text, construction, family, author, stream };
}

function applyPartial(entry, body) {
  const next = { ...entry };
  const touchingIdentity =
    body.kind !== undefined || body.char !== undefined || body.text !== undefined;

  if (body.construction !== undefined) {
    next.construction = normalizeTag(body.construction, CONSTRUCTIONS);
  }
  if (body.family !== undefined) {
    next.family = normalizeTag(body.family, FAMILIES);
  }
  if (body.author !== undefined) {
    const author = String(body.author).trim();
    if (!author) throw new Error("Author is empty");
    next.author = author;
  }
  if (body.stream !== undefined) {
    const stream = String(body.stream).trim();
    if (!stream) throw new Error("Stream is empty");
    next.stream = stream;
  }

  if (touchingIdentity) {
    Object.assign(
      next,
      fieldsFromBody(
        {
          kind: body.kind !== undefined ? body.kind : next.kind,
          char: body.char !== undefined ? body.char : next.char,
          text: body.text !== undefined ? body.text : next.text,
          author: next.author,
          stream: next.stream,
          construction: next.construction,
          family: next.family,
        },
        next,
      ),
    );
  }

  return next;
}

const LETTERS_CATALOG_EVENT = "letters-catalog";

export function lettersAdminPlugin() {
  let root = process.cwd();
  let viteServer = null;
  let chain = Promise.resolve();

  function notifyCatalog() {
    viteServer?.ws.send({ type: "custom", event: LETTERS_CATALOG_EVENT });
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
    const dir = path.join(root, "public", "letters");
    return { dir, catalogPath: path.join(dir, "catalog.json") };
  };

  async function readCatalog() {
    const { dir, catalogPath } = paths();
    await fs.mkdir(dir, { recursive: true });
    try {
      const raw = await fs.readFile(catalogPath, "utf8");
      return readCatalogData(raw);
    } catch {
      return emptyCatalog();
    }
  }

  async function writeCatalog(catalog) {
    const { catalogPath } = paths();
    catalog.updatedAt = new Date().toISOString();
    await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    notifyCatalog();
    return catalog;
  }

  return {
    name: "letters-admin",
    configResolved(config) {
      root = config.root;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes(`${path.sep}public${path.sep}letters${path.sep}`)) {
        notifyCatalog();
        return [];
      }
    },
    configureServer(server) {
      viteServer = server;
      const lettersDir = path.join(root, "public", "letters");
      const ignoreLetters = (file) => {
        if (file.startsWith(lettersDir)) server.watcher.unwatch(file);
      };
      server.watcher.unwatch(path.join(lettersDir, "**"));
      server.watcher.on("add", ignoreLetters);
      server.watcher.on("change", ignoreLetters);
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] || "";

        if (url === "/admin" || url === "/admin/") {
          req.url = "/admin.html";
          next();
          return;
        }

        if (url === "/catalog" || url === "/catalog/") {
          req.url = "/catalog.html";
          next();
          return;
        }

        if (!url.startsWith("/api/letters")) {
          next();
          return;
        }

        try {
          if (req.method === "GET" && url === "/api/letters") {
            json(res, 200, await readCatalog());
            return;
          }

          if (req.method === "POST" && url === "/api/letters") {
            const body = await readBody(req);
            const items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) {
              json(res, 400, { error: "Nothing to save" });
              return;
            }

            const catalog = await serial(async () => {
              const current = await readCatalog();
              const { dir } = paths();
              await fs.mkdir(dir, { recursive: true });

              for (const item of items) {
                const fields = fieldsFromBody(item);
                const svg = sanitizeSvg(item.svg);
                const id = `${fields.kind === KIND_WORD ? "wrd" : "ltr"}_${shortId()}`;
                const file = `${id}.svg`;
                await fs.writeFile(path.join(dir, file), svg, "utf8");

                current.letters.push({
                  id,
                  ...fields,
                  file,
                  originalName: String(item.filename || file),
                  createdAt: new Date().toISOString(),
                });
              }

              return writeCatalog(current);
            });

            json(res, 200, catalog);
            return;
          }

          if (req.method === "PATCH" && url === "/api/letters/bulk") {
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
              current.letters = current.letters.map((entry) => {
                if (!wanted.has(entry.id)) return entry;
                found += 1;
                return applyPartial(entry, patch);
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

          const patchMatch = url.match(/^\/api\/letters\/([^/]+)$/);
          if (patchMatch && (req.method === "PATCH" || req.method === "DELETE")) {
            const id = decodeURIComponent(patchMatch[1]);

            const catalog = await serial(async () => {
              const current = await readCatalog();
              const index = current.letters.findIndex((item) => item.id === id);
              if (index === -1) {
                const err = new Error("Not found");
                err.status = 404;
                throw err;
              }

              if (req.method === "DELETE") {
                const [removed] = current.letters.splice(index, 1);
                if (removed?.file) {
                  await fs.unlink(path.join(paths().dir, removed.file)).catch(() => {});
                }
                return writeCatalog(current);
              }

              const body = await readBody(req);
              const entry = current.letters[index];
              Object.assign(entry, fieldsFromBody(body, entry));

              if (typeof body.svg === "string" && body.svg.trim()) {
                const svg = sanitizeSvg(body.svg);
                const { dir } = paths();
                const file = entry.file || `${entry.id}.svg`;
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(path.join(dir, file), svg, "utf8");
                entry.file = file;
                entry.updatedAt = new Date().toISOString();
                if (body.filename) {
                  entry.originalName = String(body.filename);
                }
              }

              return writeCatalog(current);
            });

            json(res, 200, catalog);
            return;
          }

          json(res, 404, { error: "Unknown letters endpoint" });
        } catch (error) {
          json(res, error.status || 400, { error: error.message || "Failed" });
        }
      });
    },
  };
}
