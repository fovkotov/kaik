import {
  bulkDeleteWorks,
  bulkPatchWorks,
  createWorks,
  deleteWork,
  patchWorksLayout,
  patchWork,
} from "../../src/works/admin-routes.js";
import {
  commitWorks,
  createGitBlob,
  readWorksCatalog,
  readWorksFile,
  worksWriteConfigured,
} from "../../src/works/github-store.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

let chain = Promise.resolve();

function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function partsOf(req) {
  const url = new URL(req.url || "/api/works", "http://localhost");
  const fromPath = url.pathname.replace(/^\/api\/works\/?/, "").split("/").filter(Boolean);
  if (fromPath.length) return fromPath;
  if (req.query?.name) return ["file", String(req.query.name)];
  if (req.query?.id) return [String(req.query.id)];
  return [];
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function envelope(catalog) {
  return {
    ...catalog,
    writable: worksWriteConfigured(),
    fileBase: "/api/works/file/",
  };
}

async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = (await readRaw(req)).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  const parts = partsOf(req);
  const method = req.method || "GET";

  try {
    if (method === "GET" && parts[0] === "file" && parts[1]) {
      const file = await readWorksFile(parts.slice(1).join("/"));
      res.statusCode = 200;
      res.setHeader("Content-Type", file.mime);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.end(file.buffer);
      return;
    }

    if (method === "GET" && parts.length === 0) {
      send(res, 200, envelope(await readWorksCatalog()));
      return;
    }

    if (!worksWriteConfigured() && method !== "GET") {
      send(res, 503, { error: "Saving is not configured" });
      return;
    }

    if (method === "POST" && parts[0] === "upload" && parts.length === 1) {
      const buffer = await readRaw(req);
      if (!buffer.length) {
        send(res, 400, { error: "Empty file" });
        return;
      }
      if (buffer.length > 4_000_000) {
        send(res, 413, { error: "File is too large" });
        return;
      }
      const sha = await createGitBlob(buffer);
      send(res, 200, { sha, bytes: buffer.length });
      return;
    }

    if (method === "POST" && parts.length === 0) {
      const body = await readJson(req);
      const catalog = await serial(() => createWorks(readWorksCatalog, commitWorks, body));
      send(res, 200, envelope(catalog));
      return;
    }

    if (method === "PATCH" && parts[0] === "bulk" && parts.length === 1) {
      const body = await readJson(req);
      const catalog = await serial(() => bulkPatchWorks(readWorksCatalog, commitWorks, body));
      send(res, 200, envelope(catalog));
      return;
    }

    if (method === "PATCH" && parts[0] === "layout" && parts.length === 1) {
      const body = await readJson(req);
      const catalog = await serial(() => patchWorksLayout(readWorksCatalog, commitWorks, body));
      send(res, 200, envelope(catalog));
      return;
    }

    if (method === "DELETE" && parts[0] === "bulk" && parts.length === 1) {
      const body = await readJson(req);
      const catalog = await serial(() => bulkDeleteWorks(readWorksCatalog, commitWorks, body));
      send(res, 200, envelope(catalog));
      return;
    }

    if (parts.length === 1 && !["file", "bulk", "layout"].includes(parts[0])) {
      const id = decodeURIComponent(parts[0]);
      if (method === "DELETE") {
        const catalog = await serial(() => deleteWork(readWorksCatalog, commitWorks, id));
        send(res, 200, envelope(catalog));
        return;
      }
      if (method === "PATCH") {
        const body = await readJson(req);
        const catalog = await serial(() => patchWork(readWorksCatalog, commitWorks, id, body));
        send(res, 200, envelope(catalog));
        return;
      }
    }

    send(res, 404, { error: "Unknown works endpoint" });
  } catch (error) {
    send(res, error.status || 400, { error: error.message || "Failed" });
  }
}
