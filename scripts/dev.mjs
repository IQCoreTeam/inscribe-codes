// Local dev server: the repo root as static files plus a same-origin proxy
// for the NFT backend. The backend's CORS allowlist holds only the deployed
// origins, so a localhost page reaches it through /__nft/* here.
//   node scripts/dev.mjs [port]      (default 8099)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.argv[2] || 8099);
const BACKEND = "https://nft.iqlabs.dev";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".wasm": "application/wasm",
};

async function proxy(req, res, path) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const upstream = await fetch(BACKEND + path, {
    method: req.method,
    headers: req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : undefined,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveFile(res, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath));
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end("not found: " + rel); }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/__nft/")) await proxy(req, res, url.pathname.slice(6) + url.search);
    else await serveFile(res, url.pathname);
  } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
}).listen(PORT, "127.0.0.1", () => console.log("inscribe.codes dev  http://localhost:" + PORT + "   (nft backend proxied at /__nft)"));
