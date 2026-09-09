import { hydrateWorksCatalog } from "./taxonomy.js";
import { mimeFromName, stampCatalog } from "./admin-core.js";

const DEFAULT_REPO = "fovkotov/kaik";
const DEFAULT_BRANCH = "main";

function repoParts() {
  const raw = process.env.WORKS_GITHUB_REPO || DEFAULT_REPO;
  const [owner, repo] = raw.split("/");
  return { owner, repo, branch: process.env.WORKS_GITHUB_BRANCH || DEFAULT_BRANCH };
}

function token() {
  return process.env.WORKS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
}

export function worksWriteConfigured() {
  return Boolean(token());
}

async function gh(pathname, init = {}) {
  const auth = token();
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const error = new Error(data.message || `GitHub ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

// Blob creation is content-addressed (same bytes → same sha), so a retry after
// a transient GitHub 5xx / network hiccup can never duplicate anything.
async function ghBlob(owner, repo, base64) {
  const delays = [500, 1200, 2500];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await gh(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: base64, encoding: "base64" }),
      });
    } catch (error) {
      const status = Number(error?.status) || 0;
      const transient = status === 0 || status >= 500;
      if (!transient || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

function rawUrl(filePath) {
  const { owner, repo, branch } = repoParts();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

export async function readWorksCatalog() {
  const { owner, repo, branch } = repoParts();
  if (token()) {
    const data = await gh(
      `/repos/${owner}/${repo}/contents/public/works/catalog.json?ref=${encodeURIComponent(branch)}`,
    );
    const raw = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf8");
    return hydrateWorksCatalog(JSON.parse(raw));
  }
  const res = await fetch(`${rawUrl("public/works/catalog.json")}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    const error = new Error("Catalog unavailable");
    error.status = 502;
    throw error;
  }
  return hydrateWorksCatalog(await res.json());
}

export async function createGitBlob(buffer) {
  if (!token()) {
    const error = new Error("Saving is not configured");
    error.status = 503;
    throw error;
  }
  const { owner, repo } = repoParts();
  const blob = await ghBlob(owner, repo, Buffer.from(buffer).toString("base64"));
  return blob.sha;
}

export async function readWorksFile(name) {
  const safe = String(name || "").replace(/^.*[/\\]/, "");
  if (!safe) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  const path = `public/works/files/${safe}`;
  if (token()) {
    const { owner, repo, branch } = repoParts();
    const data = await gh(
      `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`,
    );
    if (!data.content) {
      const error = new Error("Not found");
      error.status = 404;
      throw error;
    }
    return {
      buffer: Buffer.from(String(data.content).replace(/\n/g, ""), "base64"),
      mime: mimeFromName(safe),
    };
  }
  const res = await fetch(`${rawUrl(path)}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    const error = new Error("Not found");
    error.status = 404;
    throw error;
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: mimeFromName(safe) };
}

export async function commitWorks({ catalog, upserts = [], removes = [] }) {
  if (!token()) {
    const error = new Error("Saving is not configured");
    error.status = 503;
    throw error;
  }
  const { owner, repo, branch } = repoParts();
  const next = stampCatalog(catalog);
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object?.sha;
  const head = await gh(`/repos/${owner}/${repo}/git/commits/${headSha}`);
  const blobs = [];
  for (const file of upserts) {
    const sha = file.sha || (await ghBlob(owner, repo, Buffer.from(file.buffer).toString("base64"))).sha;
    blobs.push({
      path: `public/works/files/${file.name}`,
      mode: "100644",
      type: "blob",
      sha,
    });
  }
  const catalogBlob = await ghBlob(
    owner,
    repo,
    Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8").toString("base64"),
  );
  blobs.push({
    path: "public/works/catalog.json",
    mode: "100644",
    type: "blob",
    sha: catalogBlob.sha,
  });
  for (const name of removes) {
    blobs.push({
      path: `public/works/files/${name}`,
      mode: "100644",
      type: "blob",
      sha: null,
    });
  }
  const tree = await gh(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: head.tree.sha, tree: blobs }),
  });
  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Update student works catalog.",
      tree: tree.sha,
      parents: [headSha],
    }),
  });
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha }),
  });
  return next;
}
