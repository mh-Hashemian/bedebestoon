// Demo single-origin proxy: serves the built web app and forwards
// /api/* to the NestJS API on :3000 (prefix stripped). Zero deps.
// Purpose: one public HTTPS tunnel URL for the whole Mini App.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const WEB_DIST = new URL('./apps/web/dist/', import.meta.url).pathname;
const API_HOST = '127.0.0.1';
const API_PORT = 3000;
const PORT = Number(process.env.PROXY_PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');

  if (url.pathname.startsWith('/api/')) {
    const targetPath = url.pathname.slice(4) + url.search;
    const upstream = http.request(
      { host: API_HOST, port: API_PORT, path: targetPath, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api unreachable' }));
    });
    req.pipe(upstream);
    return;
  }

  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(WEB_DIST, safePath === '/' ? 'index.html' : safePath);
  readFile(filePath)
    .then((data) => {
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(data);
    })
    .catch(async () => {
      // SPA fallback
      try {
        const index = await readFile(join(WEB_DIST, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(index);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`demo proxy on http://127.0.0.1:${PORT} (web: ${WEB_DIST}, api: ${API_HOST}:${API_PORT})`);
});
