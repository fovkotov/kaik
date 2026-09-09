import fs from "node:fs/promises";
import path from "node:path";
import { mimeFromName, rememberPendingUpload, stampCatalog, takePendingUpload } from "./src/works/admin-core.js";
import {
  bulkDeleteWorks,
  bulkPatchWorks,
  createWorks,
  deleteWork,
  patchWork,
} from "./src/works/admin-routes.js";
import { emptyWorksCatalog, hydrateWorksCatalog, WORKS_CATALOG_EVENT } from "./src/works/taxonomy.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
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

function envelope(catalog) {
  return {
    ...catalog,
    writable: true,
    fileBase: "/api/works/file/",
  };
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

  async function commit({ catalog, upserts = [], removes = [] }) {
    const { filesDir, catalogPath } = paths();
    await fs.mkdir(filesDir, { recursive: true });
    for (const file of upserts) {
      const buffer = file.buffer || takePendingUpload(file.sha);
      if (!buffer) throw new Error("Missing upload");
      await fs.writeFile(path.join(filesDir, file.name), buffer);
    }
    await Promise.all(
      (removes || []).map((name) => fs.unlink(path.join(filesDir, name)).catch(() => {})),
    );
    const next = stampCatalog(catalog);
    await fs.writeFile(catalogPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    notifyCatalog();
    return next;
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
          const fileMatch = url.match(/^\/api\/works\/file\/([^/]+)$/);
          if (req.method === "GET" && fileMatch) {
            const name = decodeURIComponent(fileMatch[1]);
            const filePath = path.join(paths().filesDir, name);
            const buffer = await fs.readFile(filePath);
            res.statusCode = 200;
            res.setHeader("Content-Type", mimeFromName(name));
            res.end(buffer);
            return;
          }

          if (req.method === "GET" && url === "/api/works") {
            json(res, 200, envelope(await readCatalog()));
            return;
          }

          if (req.method === "POST" && url === "/api/works/upload") {
            const chunks = [];
            await new Promise((resolve, reject) => {
              req.on("data", (chunk) => chunks.push(chunk));
              req.on("end", resolve);
              req.on("error", reject);
            });
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) {
              json(res, 400, { error: "Empty file" });
              return;
            }
            json(res, 200, { sha: rememberPendingUpload(buffer), bytes: buffer.length });
            return;
          }

          if (req.method === "POST" && url === "/api/works") {
            const body = await readBody(req);
            json(res, 200, envelope(await serial(() => createWorks(readCatalog, commit, body))));
            return;
          }

          if (req.method === "PATCH" && url === "/api/works/bulk") {
            const body = await readBody(req);
            json(res, 200, envelope(await serial(() => bulkPatchWorks(readCatalog, commit, body))));
            return;
          }

          if (req.method === "DELETE" && url === "/api/works/bulk") {
            const body = await readBody(req);
            json(res, 200, envelope(await serial(() => bulkDeleteWorks(readCatalog, commit, body))));
            return;
          }

          const match = url.match(/^\/api\/works\/([^/]+)$/);
          if (match && (req.method === "PATCH" || req.method === "DELETE")) {
            const id = decodeURIComponent(match[1]);
            const catalog =
              req.method === "DELETE"
                ? await serial(() => deleteWork(readCatalog, commit, id))
                : await serial(async () => patchWork(readCatalog, commit, id, await readBody(req)));
            json(res, 200, envelope(catalog));
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
