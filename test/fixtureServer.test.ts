import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { startFixtureServer, type FixtureServer } from '../harness/src/fixtureServer.js';

let server: FixtureServer | undefined;
let root: string | undefined;

afterEach(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
  server = undefined;
  root = undefined;
});

async function setup(renderer?: Parameters<typeof startFixtureServer>[1]) {
  root = await mkdtemp(join(tmpdir(), 'fixture-test-'));
  await mkdir(join(root, 'site'));
  await writeFile(join(root, 'site', 'index.html'), '<h1>hi</h1>');
  await writeFile(join(tmpdir(), 'outside-secret.txt'), 'secret');
  server = await startFixtureServer(join(root, 'site'), renderer);
  return server;
}

// Raw request so path segments like %2e%2e reach the server unnormalised.
function get(port: number, path: string, method = 'GET', body?: Buffer): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('fixture server', () => {
  it('binds to loopback and serves files with an index fallback', async () => {
    const s = await setup();
    expect(s.url).toMatch(/^http:\/\/localhost:\d+$/);
    const r = await get(s.port, '/');
    expect(r).toEqual({ status: 200, text: '<h1>hi</h1>' });
  });

  it('refuses path traversal', async () => {
    const s = await setup();
    expect((await get(s.port, '/%2e%2e/%2e%2e/outside-secret.txt')).status).toBe(403);
    expect((await get(s.port, '/..%2f..%2foutside-secret.txt')).status).toBe(403);
  });

  it('returns 404 for missing files and 405 for unhandled methods', async () => {
    const s = await setup();
    expect((await get(s.port, '/nope.html')).status).toBe(404);
    expect((await get(s.port, '/index.html', 'POST', Buffer.from('x'))).status).toBe(405);
  });

  it('rejects oversized bodies', async () => {
    const s = await setup(() => false);
    expect((await get(s.port, '/', 'POST', Buffer.alloc(1_100_000))).status).toBe(413);
  });

  it('lets the renderer handle requests first and reports renderer errors as 500', async () => {
    const s = await setup((req, res, body) => {
      if (req.url === '/boom') throw new Error('kaboom');
      if (req.url !== '/dynamic') return false;
      res.writeHead(200);
      res.end(`got ${body.length}`);
      return true;
    });
    expect(await get(s.port, '/dynamic', 'POST', Buffer.from('abc'))).toEqual({ status: 200, text: 'got 3' });
    expect((await get(s.port, '/boom')).status).toBe(500);
    expect((await get(s.port, '/index.html')).status).toBe(200);
  });
});
