import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

export interface FixtureServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * Optional dynamic-render hook. Called before the static-file fallback. If it
 * returns true the request was handled (response written). If false, the
 * server tries to serve a matching file under `rootDir`.
 */
export type FixtureRenderer = (
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
) => Promise<boolean> | boolean;

const MAX_BODY_BYTES = 1_000_000;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  if (req.method === 'GET' || req.method === 'HEAD') return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Starts a tiny HTTP server rooted at `rootDir`. The point: fixtures are
 * reachable via http:// (which the agent's Read tool cannot access) instead
 * of file:// (which Read CAN access). With an optional `renderer`, per-trial
 * dynamic content can be served from process memory without ever writing it
 * to disk — closing the filesystem-side cheat path for baseline.
 */
export async function startFixtureServer(
  rootDir: string,
  renderer?: FixtureRenderer,
): Promise<FixtureServer> {
  const normalizedRoot = normalize(rootDir);

  const server: Server = createServer(async (req, res) => {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end(String(err));
      return;
    }

    if (renderer) {
      try {
        const handled = await renderer(req, res, body);
        if (handled) return;
      } catch (err) {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(String(err));
        }
        return;
      }
    }

    // Static-file fallback. Only GET/HEAD reach here; other methods 405.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('method not allowed');
      return;
    }

    try {
      const rawUrl = req.url ?? '/';
      const queryStart = rawUrl.indexOf('?');
      let urlPath = decodeURIComponent(queryStart >= 0 ? rawUrl.slice(0, queryStart) : rawUrl);
      if (urlPath.endsWith('/')) urlPath += 'index.html';

      const filePath = normalize(join(normalizedRoot, urlPath));
      if (filePath !== normalizedRoot && !filePath.startsWith(normalizedRoot + sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden');
        return;
      }

      const data = await readFile(filePath);
      const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(err));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) {
    throw new Error('fixture server failed to bind');
  }

  return {
    port: addr.port,
    url: `http://localhost:${addr.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    }),
  };
}
