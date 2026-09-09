import { createGitBlob, worksWriteConfigured } from "../../src/works/github-store.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
  api: { bodyParser: false },
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    send(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!worksWriteConfigured()) {
    send(res, 503, { error: "Saving is not configured" });
    return;
  }
  try {
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
  } catch (error) {
    send(res, error.status || 400, { error: error.message || "Failed" });
  }
}
