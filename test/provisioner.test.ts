import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteOnFailure, provisionRepo } from '../experiments/github/provisioner.js';

const cfg = { controllerToken: 'fake-controller', sandboxOwner: 'lab', host: 'api.github.test' };

afterEach(() => vi.unstubAllGlobals());

function fakeGitHub(failOn: (method: string, path: string) => boolean) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname;
      calls.push(`${method} ${path}`);
      if (failOn(method, path)) return new Response('boom', { status: 500 });
      if (method === 'GET' && path === '/users/lab') return Response.json({ type: 'Organization' });
      if (method === 'POST' && path === '/orgs/lab/repos') return Response.json({}, { status: 201 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ number: 1 }, { status: 200 });
    }),
  );
  return calls;
}

describe('deleteOnFailure', () => {
  it('returns the result and leaves the repo alone on success', async () => {
    const cleanupHandle = vi.fn(async () => undefined);
    await expect(deleteOnFailure({ cleanupHandle }, async () => 42)).resolves.toBe(42);
    expect(cleanupHandle).not.toHaveBeenCalled();
  });

  it('deletes the repo and rethrows the original error on failure', async () => {
    const cleanupHandle = vi.fn(async () => {
      throw new Error('delete also failed');
    });
    await expect(
      deleteOnFailure({ cleanupHandle }, async () => {
        throw new Error('setup failed');
      }),
    ).rejects.toThrow('setup failed');
    expect(cleanupHandle).toHaveBeenCalledOnce();
  });
});

describe('provisionRepo', () => {
  it('creates and seeds a private repo', async () => {
    const calls = fakeGitHub(() => false);
    const repo = await provisionRepo(cfg, 'clivsmcp-x', { files: [{ path: 'README.md', content: 'hi' }] });
    expect(repo.fullName).toBe('lab/clivsmcp-x');
    expect(calls).toContain('POST /orgs/lab/repos');
    expect(calls).toContain('PUT /repos/lab/clivsmcp-x/contents/README.md');
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });

  it('deletes the repo when seeding fails after creation', async () => {
    const calls = fakeGitHub((method, path) => method === 'PUT' && path.endsWith('/contents/README.md'));
    await expect(provisionRepo(cfg, 'clivsmcp-x', { files: [{ path: 'README.md', content: 'hi' }] })).rejects.toThrow(
      /500/,
    );
    expect(calls.at(-1)).toBe('DELETE /repos/lab/clivsmcp-x');
  });
});
