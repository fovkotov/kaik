import { fieldsFromBody, shortId, uploadsToFiles } from "./admin-core.js";
import { normalizeWorkType } from "./taxonomy.js";

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
    removes: removed.flatMap((entry) => entry.files || []),
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
    if (!uploads.length) throw new Error("Each work needs a file");
    const id = `wrk_${shortId()}`;
    const written = uploadsToFiles(id, uploads);
    upserts.push(...written.blobs);
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
  if (uploads.length) {
    const previous = entry.files || [];
    const written = uploadsToFiles(entry.id, uploads, previous);
    // Only drop files that are neither kept nor overwritten by a new upload.
    removes.push(...previous.filter((name) => !written.files.includes(name)));
    upserts.push(...written.blobs);
    entry.files = written.files;
    entry.width = entry.width || written.width;
    entry.height = entry.height || written.height;
    if (!uploads[0]?.keep) entry.originalName = String(uploads[0]?.filename || written.files[0]);
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
  return commit({ catalog: current, upserts: [], removes: removed?.files || [] });
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
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  return commit({ catalog: current, upserts: [], removes: [] });
}
