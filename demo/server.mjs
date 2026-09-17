// Little Airways — local dev server.
// Serves the static demo and proxies POST /jev to the TypeSafe API, because
// api.typesafe.ai allows no localhost CORS origins (and keys belong server-side).
// Run:  node server.mjs [port]     (default 8765)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 8765;
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json'
};

async function proxyJev(req, res) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.writeHead(413).end('{"error":"payload too large"}'); return; } chunks.push(chunk); }
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
      body: Buffer.concat(chunks)
    });
    const body = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `proxy: ${e.message}` }));
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/jev') {
    if (req.method === 'POST') return proxyJev(req, res);
    res.writeHead(405).end('{"error":"POST only"}'); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/\\/g, '/');
  if (path.includes('..')) { res.writeHead(403).end(); return; }
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => console.log(`Little Airways on http://localhost:${PORT}  (POST /jev → ${UPSTREAM})`));
