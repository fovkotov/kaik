import { coverFromUpload, fieldsFromBody, layoutFromBody, shortId, uploadsToFiles } from "./admin-core.js";
import { normalizeFlag, normalizeGridSpan, normalizeWorkType, TYPE_DAILY, TYPE_FINAL } from "./taxonomy.js";

function ownedFiles(entry) {
  return [...new Set([...(entry?.files || []), entry?.cover].filter(Boolean))];
}

const RETRY_DELAYS_MS = [600, 1500, 3000];

/**
 * GitHub's Git Data API is eventually consistent: right after a commit the
 * next `git/ref` read may still return the old head, so the following ref
 * update fails with 422 "not a fast forward"; blob/tree creation also throws
 * sporadic 5xx. Those are safe to retry from scratch — the whole operation
 * re-reads the catalog, so nothing stale is written back.
 */
function retryable(error) {
  const status = Number(error?.status) || 0;
  return status === 409 || status === 422 || status >= 500;
}

export async function withRetry(op) {
  let attempt = 0;
  for (;;) {
    try {
      return await op();
    } catch (error) {
      if (!retryable(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      attempt += 1;
    }
  }
}

export function createWorks(readCatalog, commit, body) {
  return withRetry(() => createWorksOnce(readCatalog, commit, body));
}

export function patchWork(readCatalog, commit, id, body) {
  return withRetry(() => patchWorkOnce(readCatalog, commit, id, body));
}

export function deleteWork(readCatalog, commit, id) {
  return withRetry(() => deleteWorkOnce(readCatalog, commit, id));
}

export function bulkPatchWorks(readCatalog, commit, body) {
  return withRetry(() => bulkPatchWorksOnce(readCatalog, commit, body));
}

export function bulkDeleteWorks(readCatalog, commit, body) {
  return withRetry(() => bulkDeleteWorksOnce(readCatalog, commit, body));
}

export function patchWorksLayout(readCatalog, commit, body) {
  return withRetry(async () => {
    const current = await readCatalog();
    current.layout = layoutFromBody(body?.layout ?? body);
    return commit({ catalog: current, upserts: [], removes: [] });
  });
}

async function bulkDeleteWorksOnce(readCatalog, commit, body) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) {
    const error = new Error("Nothing to delete");
    error.status = 400;
    throw error;
  }
  const current = await readCatalog();
  const wanted = new Set(ids);
  const removed = current.items.filter((entry) => wanted.has(entry.id));
  if (!removed.length) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  current.items = current.items.filter((entry) => !wanted.has(entry.id));
  return commit({
    catalog: current,
    upserts: [],
    removes: [...new Set(removed.flatMap((entry) => ownedFiles(entry)))],
  });
}

async function createWorksOnce(readCatalog, commit, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    const error = new Error("Nothing to save");
    error.status = 400;
    throw error;
  }
  const current = await readCatalog();
  const upserts = [];
  for (const item of items) {
    const fields = fieldsFromBody(item);
    const uploads = Array.isArray(item.files) ? item.files : [];
    if (fields.type === TYPE_FINAL && !item.cover) {
      const error = new Error("Final project needs a cover");
      error.status = 400;
      throw error;
    }
    if (!uploads.length) throw new Error("Each work needs a file");
    const id = `wrk_${shortId()}`;
    const written = uploadsToFiles(id, uploads);
    upserts.push(...written.blobs);
    let cover;
    if (fields.type === TYPE_FINAL) {
      const stored = coverFromUpload(id, item.cover, written.files);
      cover = stored.name;
      if (stored.blob) upserts.push(stored.blob);
    }
    current.items.push({
      id,
      ...fields,
      ...(cover ? { cover } : {}),
      files: written.files,
      width: fields.width || written.width,
      height: fields.height || written.height,
      originalName: String(item.cover?.filename || uploads[0]?.filename || written.files[0]),
      createdAt: new Date().toISOString(),
    });
  }
  return commit({ catalog: current, upserts, removes: [] });
}

async function patchWorkOnce(readCatalog, commit, id, body) {
  const current = await readCatalog();
  const index = current.items.findIndex((item) => item.id === id);
  if (index === -1) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  const entry = current.items[index];
  Object.assign(entry, fieldsFromBody(body, entry));
  const uploads = Array.isArray(body.files) ? body.files : [];
  const upserts = [];
  const removes = [];
  const previousFiles = entry.files || [];
  const previousCover = entry.cover || "";
  // The new cover may be a slide this same save is pulling out of `files`.
  const keptCover = body.cover?.keep ? String(body.cover.keep) : "";
  if (uploads.length) {
    const written = uploadsToFiles(entry.id, uploads, previousFiles);
    removes.push(
      ...previousFiles.filter(
        (name) => !written.files.includes(name) && name !== previousCover && name !== keptCover,
      ),
    );
    upserts.push(...written.blobs);
    entry.files = written.files;
    entry.width = entry.width || written.width;
    entry.height = entry.height || written.height;
    if (!uploads[0]?.keep) entry.originalName = String(uploads[0]?.filename || written.files[0]);
    entry.updatedAt = new Date().toISOString();
  }
  if (entry.type !== TYPE_FINAL) {
    if (previousCover && !(entry.files || []).includes(previousCover)) removes.push(previousCover);
    delete entry.cover;
  } else if (body.cover) {
    const owned = [...new Set([...previousFiles, ...(entry.files || []), previousCover].filter(Boolean))];
    const stored = coverFromUpload(entry.id, body.cover, owned);
    if (stored.blob) upserts.push(stored.blob);
    entry.cover = stored.name;
    if (previousCover && previousCover !== stored.name && !(entry.files || []).includes(previousCover)) {
      removes.push(previousCover);
    }
    if (!body.cover.keep && body.cover.filename) entry.originalName = String(body.cover.filename);
    entry.updatedAt = new Date().toISOString();
  }
  return commit({ catalog: current, upserts, removes });
}

async function deleteWorkOnce(readCatalog, commit, id) {
  const current = await readCatalog();
  const index = current.items.findIndex((item) => item.id === id);
  if (index === -1) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  const [removed] = current.items.splice(index, 1);
  return commit({ catalog: current, upserts: [], removes: ownedFiles(removed) });
}

async function bulkPatchWorksOnce(readCatalog, commit, body) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
  if (!ids.length) {
    const error = new Error("Nothing to update");
    error.status = 400;
    throw error;
  }
  const current = await readCatalog();
  const wanted = new Set(ids);
  const removes = [];
  let found = 0;
  current.items = current.items.map((entry) => {
    if (!wanted.has(entry.id)) return entry;
    found += 1;
    let next = entry;
    if (patch.type !== undefined) {
      const type = normalizeWorkType(patch.type);
      next = { ...next, type };
      if (type === TYPE_DAILY) next = { ...next, author: "", nick: "" };
      if (type !== TYPE_FINAL && next.cover) {
        if (!(next.files || []).includes(next.cover)) removes.push(next.cover);
        next = { ...next, cover: undefined };
      }
    }
    if (patch.gridSpan !== undefined) {
      next = { ...next, gridSpan: normalizeGridSpan(patch.gridSpan) };
    }
    if (patch.hidden !== undefined) {
      next = { ...next, hidden: normalizeFlag(patch.hidden) ? true : undefined };
    }
    return next;
  });
  if (!found) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  return commit({ catalog: current, upserts: [], removes });
}
